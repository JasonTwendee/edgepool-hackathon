/**
 * Executable evidence for wallet-signed deposit/withdraw intents.
 * Run: `npx tsx src/modules/signed-intent/assert-signed-intent.ts` (no DB, no network).
 * Signing uses node:crypto Ed25519 with a FIXED test seed — deterministic.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { base58Encode } from '../../common/auth/solana-verify.js';
import { SignedIntentService } from './signed-intent.service.js';

type Row = Record<string, unknown>;

// Fixed 32-byte test seed (never a real wallet).
const SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc444e9a7d0d6f5a3b2e8e8f8a0d1c2b3a4', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function testKey(): { wallet: string; signMsg: (msg: string) => string } {
  const priv = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, SEED]),
    format: 'der',
    type: 'pkcs8',
  });
  const pubDer = createPublicKey(priv).export({ format: 'der', type: 'spki' }) as Buffer;
  const wallet = base58Encode(pubDer.subarray(pubDer.length - 32));
  return {
    wallet,
    signMsg: (msg: string) => base58Encode(sign(null, Buffer.from(msg, 'utf8'), priv)),
  };
}

function makeFake() {
  const rows: Row[] = [];
  let seq = 0;
  const fake = {
    rows,
    signedIntent: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: ++seq, consumedAt: null, ...data };
        rows.push(r);
        return r;
      },
      findUnique: async ({ where }: { where: Row }) =>
        rows.find((r) => r.nonce === where.nonce) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = rows.find((x) => x.id === where.id) as Row;
        Object.assign(r, data);
        return r;
      },
    },
  };
  return { fake: fake as never, rows };
}

async function main(): Promise<void> {
  const { wallet, signMsg } = testKey();

  // 1. Deposit happy path: challenge → sign → verify consumes, returns wallet.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    const ch = await svc.challenge(7, 'DEPOSIT', 1, 0.5, wallet);
    assert.ok(ch.message.includes('edgepool:DEPOSIT:v1:vault=1:amount=0.5'));
    assert.ok(ch.message.includes(`wallet=${wallet}`));
    const got = await svc.verifyAndConsume({
      userId: 7, kind: 'DEPOSIT', vaultId: 1, qty: 0.5,
      message: ch.message, signature: signMsg(ch.message),
    });
    assert.equal(got, wallet);
    assert.ok(fake.rows[0].consumedAt);
  }

  // 2. Replay: same signature twice fails.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    const ch = await svc.challenge(7, 'WITHDRAW', 1, 2, wallet);
    const args = { userId: 7, kind: 'WITHDRAW' as const, vaultId: 1, qty: 2, message: ch.message, signature: signMsg(ch.message) };
    await svc.verifyAndConsume(args);
    await assert.rejects(() => svc.verifyAndConsume(args), /already used/);
  }

  // 3. Wrong signature fails.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    const ch = await svc.challenge(7, 'DEPOSIT', 1, 0.5, wallet);
    await assert.rejects(
      () => svc.verifyAndConsume({ userId: 7, kind: 'DEPOSIT', vaultId: 1, qty: 0.5, message: ch.message, signature: signMsg(ch.message + 'x') }),
      /Invalid signature/,
    );
  }

  // 4. Tampered message (amount changed client-side) fails.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    const ch = await svc.challenge(7, 'DEPOSIT', 1, 0.5, wallet);
    const evil = ch.message.replace('amount=0.5', 'amount=500');
    await assert.rejects(
      () => svc.verifyAndConsume({ userId: 7, kind: 'DEPOSIT', vaultId: 1, qty: 500, message: evil, signature: signMsg(evil) }),
      /tampered|unknown/,
    );
  }

  // 5. Cross-user intent fails.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    const ch = await svc.challenge(7, 'DEPOSIT', 1, 0.5, wallet);
    await assert.rejects(
      () => svc.verifyAndConsume({ userId: 99, kind: 'DEPOSIT', vaultId: 1, qty: 0.5, message: ch.message, signature: signMsg(ch.message) }),
      /does not match/,
    );
  }

  // 6. Expired intent fails.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    const ch = await svc.challenge(7, 'DEPOSIT', 1, 0.5, wallet);
    fake.rows[0].expiresAt = new Date(Date.now() - 1000);
    await assert.rejects(
      () => svc.verifyAndConsume({ userId: 7, kind: 'DEPOSIT', vaultId: 1, qty: 0.5, message: ch.message, signature: signMsg(ch.message) }),
      /expired/,
    );
  }

  // 7. Challenge rejects bad wallet / non-positive qty.
  {
    const fake = makeFake();
    const svc = new SignedIntentService(fake.fake);
    await assert.rejects(() => svc.challenge(7, 'DEPOSIT', 1, 0.5, 'not-a-wallet'), /Invalid base58|Invalid Solana wallet/);
    await assert.rejects(() => svc.challenge(7, 'DEPOSIT', 1, 0, wallet), /positive/);
  }

  console.log('signed-intent asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
