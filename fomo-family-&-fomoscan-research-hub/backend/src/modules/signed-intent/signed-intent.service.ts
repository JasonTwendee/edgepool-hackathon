import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress, verifyEd25519Signature } from '../../common/auth/solana-verify.js';

export type IntentKind = 'DEPOSIT' | 'WITHDRAW';

const TTL_MS = 5 * 60 * 1000;
const NONCE_RE = 32;

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

/** Canonical message the wallet signs. Any byte difference fails verification. */
export function intentMessage(parts: {
  kind: IntentKind;
  vaultId: number;
  qty: number;
  wallet: string;
  nonce: string;
  exp: number;
}): string {
  const q = parts.kind === 'DEPOSIT' ? `amount=${parts.qty}` : `shares=${parts.qty}`;
  return `edgepool:${parts.kind}:v1:vault=${parts.vaultId}:${q}:wallet=${parts.wallet}:nonce=${parts.nonce}:exp=${parts.exp}`;
}

function parseChallenge(message: string): { wallet: string; nonce: string } {
  const m = /^edgepool:(?:DEPOSIT|WITHDRAW):v1:vault=\d+:(?:amount|shares)=[^:]+:wallet=([^:]+):nonce=([0-9a-f]{32}):exp=\d+$/.exec(
    message,
  );
  if (!m) fail('Message is not a valid signed-intent challenge.');
  return { wallet: m[1], nonce: m[2] };
}

@Injectable()
export class SignedIntentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async challenge(
    userId: number,
    kind: IntentKind,
    vaultId: number,
    qty: number,
    wallet: string,
  ): Promise<{ message: string; nonce: string; expiresAt: string }> {
    decodeWalletAddress(wallet); // throws on invalid address
    if (!(qty > 0)) fail('Amount must be positive.');
    // Canonicalize BEFORE embedding + storing: the DB rounds qty to
    // Decimal(24,12), so a raw float (e.g. computed withdraw shares like
    // 21.92869999…) would make the rebuilt verify message differ by bytes
    // and every such intent would die as "tampered".
    const canonical = Math.round(qty * 1e9) / 1e9;
    if (!(canonical > 0)) fail('Amount must be positive.');
    const nonce = randomBytes(16).toString('hex');
    if (nonce.length !== NONCE_RE) fail('RNG failure.');
    const exp = Date.now() + TTL_MS;
    const clean = wallet.trim();
    const message = intentMessage({ kind, vaultId, qty: canonical, wallet: clean, nonce, exp });
    await this.prisma.signedIntent.create({
      data: {
        userId,
        wallet: clean,
        kind,
        vaultId,
        amountSol: kind === 'DEPOSIT' ? canonical : null,
        shares: kind === 'WITHDRAW' ? canonical : null,
        nonce,
        expiresAt: new Date(exp),
      },
    });
    return { message, nonce, expiresAt: new Date(exp).toISOString() };
  }

  /**
   * Verify a wallet signature and consume the intent (single-use). Returns the
   * verified wallet address to book the paper position against.
   */
  async verifyAndConsume(input: {
    userId: number;
    kind: IntentKind;
    vaultId: number;
    qty: number;
    message: string;
    signature: string;
  }): Promise<string> {
    const { wallet, nonce } = parseChallenge(input.message);
    decodeWalletAddress(wallet); // throws on invalid address
    const row = (await this.prisma.signedIntent.findUnique({ where: { nonce } })) as {
      id: number;
      userId: number;
      wallet: string;
      kind: string;
      vaultId: number;
      amountSol: unknown;
      shares: unknown;
      expiresAt: Date;
      consumedAt: Date | null;
    } | null;
    if (!row || row.consumedAt) fail('Challenge unknown or already used.');
    if (new Date(row.expiresAt).getTime() <= Date.now()) fail('Challenge expired. Request a new one.');
    if (row.userId !== input.userId || row.kind !== input.kind || Number(row.vaultId) !== input.vaultId) {
      fail('Challenge does not match this request.');
    }
    if (row.wallet !== wallet) fail('Challenge wallet mismatch.');
    const expected = intentMessage({
      kind: row.kind as IntentKind,
      vaultId: Number(row.vaultId),
      qty: input.kind === 'DEPOSIT' ? Number(row.amountSol) : Number(row.shares),
      wallet: row.wallet,
      nonce,
      exp: new Date(row.expiresAt).getTime(),
    });
    if (input.message !== expected) fail('Challenge was tampered with.');
    const ok = verifyEd25519Signature(
      Buffer.from(input.message, 'utf8'),
      (input.signature ?? '').trim(),
      row.wallet,
    );
    if (!ok) fail('Invalid signature.');
    await this.prisma.signedIntent.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return row.wallet;
  }
}
