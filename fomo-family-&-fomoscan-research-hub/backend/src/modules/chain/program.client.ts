/**
 * Anchor program client (P2). Wraps @coral-xyz/anchor for edgepool-vault:
 * devnet/mainnet connection, keeper keypair, PDA helpers, event decoding.
 * Every method no-ops (null/false) unless CHAIN_ENABLED=true.
 */
import { Injectable } from '@nestjs/common';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { SystemProgram } from '@solana/web3.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../config/configuration.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anchor: any = require('@coral-xyz/anchor');

export const DEVNET_RPC = 'https://api.devnet.solana.com';

export interface VaultPdas {
  vault: PublicKey;
  treasury: PublicKey;
  shares: PublicKey;
  authority: PublicKey;
}

function loadIdl(): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '..', '..', 'chain', 'idl', 'edgepool_vault.json'), 'utf8');
  return JSON.parse(raw);
}

function keeperFromBase58(secret: string): Keypair {
  const bytes = anchor.utils.bytes.bs58.decode(secret.trim());
  return Keypair.fromSecretKey(bytes);
}

/** Prisma Json cannot persist Anchor BN/PublicKey objects; normalize first. */
function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown> & {
      toNumber?: () => number;
      toBase58?: () => string;
    };
    if (typeof obj.toNumber === 'function') return obj.toNumber();
    if (typeof obj.toBase58 === 'function') return obj.toBase58();
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return String(value);
}

@Injectable()
export class ChainProgramClient {
  private connectionCache: Connection | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private programCache: any = null;

  enabled(): boolean {
    return getConfig().chain.enabled;
  }

  cluster(): string {
    return getConfig().chain.cluster;
  }

  programId(): PublicKey {
    return new PublicKey(getConfig().chain.programId);
  }

  rpcUrl(): string {
    return this.cluster() === 'mainnet'
      ? getConfig().solanaRpcUrl
      : getConfig().chain.publicRpcUrl || getConfig().devnetRpcUrl || DEVNET_RPC;
  }

  fallbackRpcUrl(): string | undefined {
    if (this.cluster() !== 'devnet') return undefined;
    const url = getConfig().chain.fallbackRpcUrl;
    return url && url !== this.rpcUrl() ? url : undefined;
  }

  /**
   * Public-first HTTP transport. web3 retries 429 internally by default; we
   * disable that and send the same JSON-RPC body to the fallback endpoint
   * only for 429/5xx/network failures. The fallback key never reaches FE.
   */
  private failoverFetch(): typeof fetch | undefined {
    const fallback = this.fallbackRpcUrl();
    if (!fallback) return undefined;
    const primary = this.rpcUrl();
    return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let first: Response | null = null;
      let firstError: unknown = null;
      try {
        first = await fetch(primary, init);
        if (first.status !== 429 && first.status < 500) return first;
      } catch (e) {
        firstError = e;
      }
      try {
        return await fetch(fallback, init);
      } catch (e) {
        if (first) return first;
        throw firstError instanceof Error ? firstError : e;
      }
    };
  }

  /**
   * WS endpoint is optional; polling is the primary path. FluxRPC does not
   * serve Solana devnet, so devnet defaults to the public WS only if enabled.
   */
  wsUrl(): string | undefined {
    const cfg = getConfig();
    if (cfg.chain.wsUrl) return cfg.chain.wsUrl;
    if (cfg.solanaWsUrl) return cfg.solanaWsUrl;
    return this.cluster() === 'devnet' ? 'wss://api.devnet.solana.com' : undefined;
  }

  connection(): Connection | null {
    if (!this.enabled()) return null;
    return this.connectionForSetup();
  }

  /** Connection for setup/initialize even while the global chain loop is OFF. */
  connectionForSetup(): Connection {
    if (!this.connectionCache) {
      this.connectionCache = new Connection(this.rpcUrl(), {
        commitment: 'confirmed',
        ...(getConfig().chain.wsEnabled ? { wsEndpoint: this.wsUrl() } : {}),
        // Failover is explicit; do not let web3 hot-retry the public endpoint.
        disableRetryOnRateLimit: true,
        fetch: this.failoverFetch(),
      });
    }
    return this.connectionCache;
  }

  /** Faucet must hit a real faucet RPC; Helius does not implement requestAirdrop. */
  faucetConnection(): Connection {
    return new Connection(this.rpcUrl(), {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
  }

  keeper(): Keypair | null {
    if (!this.enabled()) return null;
    return this.keeperForSetup();
  }

  /** Keeper/manager key for admin setup; does not require CHAIN_ENABLED. */
  keeperForSetup(): Keypair | null {
    const key = getConfig().chain.keeperKey;
    if (!key) return null;
    try {
      return keeperFromBase58(key);
    } catch {
      return null;
    }
  }

  private buildProgram(): any {
    if (!this.programCache) {
      const keeper = this.keeperForSetup();
      const connection = this.connectionForSetup();
      if (!keeper || !connection) return null;
      const wallet = new anchor.Wallet(keeper);
      const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
      this.programCache = new anchor.Program(loadIdl(), provider);
    }
    return this.programCache;
  }

  /** Anchor Program instance (keeper as payer) or null when misconfigured. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program(): any {
    if (!this.enabled()) return null;
    return this.buildProgram();
  }

  /** Setup/initialize path: keeper key required, master CHAIN_ENABLED gate not. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setupProgram(): any {
    if (this.cluster() !== 'devnet') return null;
    return this.buildProgram();
  }

  /**
   * Initialize a new on-chain vault using the keeper wallet as manager/payer.
   * Devnet-only admin/demo flow; requires a funded keeper (+0.01 SOL buffer).
   */
  async initializeVault(
    name: string,
    opts: {
      feeBps: number;
      withdrawFeeBps: number;
      reserveBps: number;
      maxTradeBps: number;
      maxMarksBps: number;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ signature: string; programId: string; vault: string; treasury: string; shares: string; authority: string }> {
    const program = this.setupProgram();
    const keeper = this.keeperForSetup();
    if (!program || !keeper) throw new Error('Chain setup unavailable (devnet keeper key missing).');
    const clean = name.trim().slice(0, 24);
    if (!clean) throw new Error('Vault name is required.');
    const pdas = this.derivePdas(clean);
    const signature = await this.sendAndConfirmPolling(
      program.methods
        .initializeVault(
          clean,
          keeper.publicKey,
          opts.feeBps,
          opts.withdrawFeeBps,
          opts.reserveBps,
          opts.maxTradeBps,
          opts.maxMarksBps,
          0,
        )
        .accounts({
          manager: keeper.publicKey,
          vault: pdas.vault,
          shareMint: pdas.shares,
          treasury: pdas.treasury,
          vaultAuthority: pdas.authority,
          systemProgram: SystemProgram.programId,
          tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        }),
      keeper,
    );
    return {
      signature,
      programId: this.programId().toBase58(),
      vault: pdas.vault.toBase58(),
      treasury: pdas.treasury.toBase58(),
      shares: pdas.shares.toBase58(),
      authority: pdas.authority.toBase58(),
    };
  }

  /**
   * Send an Anchor-built tx and confirm with HTTP polling. This avoids WS
   * confirmation dependencies and works with the public→fallback transport.
   */
  async sendAndConfirmPolling(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builder: { transaction(): Promise<Transaction> },
    keeper: Keypair,
  ): Promise<string> {
    const connection = this.connectionForSetup();
    const tx = await builder.transaction();
    tx.feePayer = keeper.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(keeper);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const deadline = Date.now() + 90_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const status = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const value = status.value[0];
        if (value?.err) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(value.err)}`);
        }
        if (
          value &&
          (value.confirmationStatus === 'confirmed' ||
            value.confirmationStatus === 'finalized' ||
            value.confirmations === null)
        ) {
          return signature;
        }
      } catch (e) {
        lastError = e;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
      `Transaction confirmation timed out: ${signature}${
        lastError instanceof Error ? ` (${lastError.message})` : ''
      }`,
    );
  }

  /** Demo faucet fallback: keeper transfers devnet SOL when public airdrop is unavailable. */
  async transferFromKeeper(to: string, lamports: number): Promise<string> {
    const keeper = this.keeperForSetup();
    if (!keeper) throw new Error('Faucet unavailable: keeper key missing.');
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keeper.publicKey,
        toPubkey: new PublicKey(to),
        lamports,
      }),
    );
    return this.sendAndConfirmPolling({ transaction: async () => tx }, keeper);
  }

  /**
   * Backend-only JSON-RPC proxy used by the browser as a fallback when the
   * public endpoint returns 429/5xx. Keeps the Helius key server-side.
   */
  async proxyRpc(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const method = typeof body.method === 'string' ? body.method : '';
    const allowed = new Set([
      'getAccountInfo',
      'getBalance',
      'getBlockHeight',
      'getEpochInfo',
      'getFeeForMessage',
      'getGenesisHash',
      'getHealth',
      'getLatestBlockhash',
      'getMinimumBalanceForRentExemption',
      'getMultipleAccounts',
      'getRecentPrioritizationFees',
      'getSignatureStatuses',
      'getSignaturesForAddress',
      'getSlot',
      'getTokenAccountBalance',
      'getTokenAccountsByOwner',
      'getTransaction',
      'getVersion',
      'sendTransaction',
      'simulateTransaction',
    ]);
    if (!allowed.has(method)) throw new Error(`RPC method not allowed: ${method || '(missing)'}`);
    const urls = [this.rpcUrl(), this.fallbackRpcUrl()].filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    );
    let last: unknown = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          parsed = { error: { code: res.status, message: text.slice(0, 200) } };
        }
        const error = parsed.error as { code?: number } | undefined;
        const retryable = res.status === 429 || res.status >= 500 || error?.code === 429;
        if (!retryable) return parsed;
        last = new Error(`RPC ${method} HTTP ${res.status}`);
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('RPC proxy failed');
  }

  derivePdas(vaultName: string): VaultPdas {
    const pid = this.programId();
    const name = Buffer.from(vaultName.slice(0, 24));
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), name], pid);
    return { vault, treasury: this.treasuryOf(vault), shares: this.sharesOf(vault), authority: this.authorityOf(vault) };
  }

  treasuryOf(vault: PublicKey): PublicKey {
    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from('treasury'), vault.toBuffer()],
      this.programId(),
    );
    return treasury;
  }

  sharesOf(vault: PublicKey): PublicKey {
    const [shares] = PublicKey.findProgramAddressSync(
      [Buffer.from('shares'), vault.toBuffer()],
      this.programId(),
    );
    return shares;
  }

  authorityOf(vault: PublicKey): PublicKey {
    const [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('authority'), vault.toBuffer()],
      this.programId(),
    );
    return authority;
  }

  /** Decode Anchor event payloads from tx logs via the program coder. */
  decodeLogs(logs: string[]): { kind: string; payload: Record<string, unknown> }[] {
    const program = this.program();
    if (!program) return [];
    const out: { kind: string; payload: Record<string, unknown> }[] = [];
    try {
      // EventParser expects the full coder object (it reads coder.events).
      const parser = new anchor.EventParser(this.programId(), program.coder);
      for (const ev of parser.parseLogs(logs)) {
        out.push({ kind: ev.name, payload: jsonSafe(ev.data) as Record<string, unknown> });
      }
    } catch {
      return out;
    }
    return out;
  }
}
