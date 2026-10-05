import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  type Connection,
} from '@solana/web3.js';

/** Solana devnet genesis — anything else is refused (never mainnet). */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export const JUPITER_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';

export const DEFAULT_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface PaperQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}

export interface PaperQuote {
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct?: string;
}

export interface PaperProof {
  signature: string;
  slot: number;
}

function envelope(message: string): { success: false; message: string } {
  return { success: false, message };
}

/**
 * Devnet paper execution primitives. Network-facing methods accept injected
 * `connection`/`fetcher` seams so unit asserts run without network or keys.
 * Vault secret format: solana-keygen JSON array (`[12,34,...]`), read from
 * `VAULT_PRIVATE_KEY` (local-only, never logged).
 */
@Injectable()
export class PaperExecutorService {
  async assertDevnet(
    connection: Pick<Connection, 'getGenesisHash'>,
  ): Promise<void> {
    const hash = await connection.getGenesisHash();
    if (hash !== DEVNET_GENESIS_HASH) {
      throw new BadRequestException(
        envelope(`Refusing non-devnet cluster (genesis ${hash.slice(0, 8)}…). Paper trades run on devnet only.`),
      );
    }
  }

  loadVaultKeypair(secret = process.env.VAULT_PRIVATE_KEY): Keypair {
    const raw = (secret ?? '').trim();
    if (!raw) {
      throw new BadRequestException(
        envelope('VAULT_PRIVATE_KEY is not set. Generate a devnet keypair and set it locally (never commit).'),
      );
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const nums = Array.isArray(parsed) ? parsed : String(raw).split(',').map((s) => Number(s.trim()));
      const bytes = Uint8Array.from(nums as number[]);
      if (bytes.length !== 64 || (nums as number[]).some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        throw new Error('bad-length');
      }
      return Keypair.fromSecretKey(bytes);
    } catch {
      throw new BadRequestException(
        envelope('VAULT_PRIVATE_KEY is invalid. Expected a solana-keygen JSON secret array ([12,34,…64 numbers]).'),
      );
    }
  }

  async fetchQuote(
    params: PaperQuoteParams,
    fetcher: typeof fetch = fetch,
  ): Promise<PaperQuote> {
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: String(params.slippageBps),
    });
    let res: Response;
    try {
      res = await fetcher(`${JUPITER_QUOTE_URL}?${qs.toString()}`, {
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new BadRequestException(envelope('Quote request failed (network/timeout).'));
    }
    if (!res.ok) {
      throw new BadRequestException(envelope(`Quote request failed (HTTP ${res.status}).`));
    }
    const body = (await res.json()) as { outAmount?: unknown; otherAmountThreshold?: unknown; priceImpactPct?: unknown };
    if (typeof body.outAmount !== 'string' || typeof body.otherAmountThreshold !== 'string') {
      throw new BadRequestException(envelope('Quote response malformed (missing outAmount).'));
    }
    return {
      outAmount: body.outAmount,
      otherAmountThreshold: body.otherAmountThreshold,
      priceImpactPct: typeof body.priceImpactPct === 'string' ? body.priceImpactPct : undefined,
    };
  }

  /**
   * Execution proof: dust SOL transfer to self on devnet, confirmed and
   * status-verified. Real signature, negligible value — paper-trade only.
   */
  async executeProof(
    connection: Pick<
      Connection,
      'getAccountInfo' | 'sendTransaction' | 'confirmTransaction' | 'getSignatureStatus'
    >,
    payer: Keypair,
    amountSol: number,
  ): Promise<PaperProof> {
    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      throw new BadRequestException(envelope('paperAmountSol must be a positive SOL amount.'));
    }
    const info = await connection.getAccountInfo(payer.publicKey);
    if (!info || info.lamports < lamports + 5000) {
      throw new BadRequestException(
        envelope('Vault devnet balance too low. Airdrop devnet SOL first (`solana airdrop`).'),
      );
    }
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports }),
    );
    const signature = await connection.sendTransaction(tx, [payer]);
    await connection.confirmTransaction(signature, 'confirmed');
    const status = await connection.getSignatureStatus(signature);
    if (!status?.value) {
      throw new BadRequestException(envelope('Devnet signature not found after broadcast.'));
    }
    if (status.value.err) {
      throw new BadRequestException(envelope(`Devnet transaction failed: ${JSON.stringify(status.value.err)}`));
    }
    return { signature, slot: status.value.slot ?? 0 };
  }
}
