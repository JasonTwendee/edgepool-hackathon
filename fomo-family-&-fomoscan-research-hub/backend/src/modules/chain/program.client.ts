/**
 * Anchor program client (P2). Wraps @coral-xyz/anchor for edgepool-vault:
 * devnet/mainnet connection, keeper keypair, PDA helpers, event decoding.
 * Every method no-ops (null/false) unless CHAIN_ENABLED=true.
 */
import { Injectable } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
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
    return this.cluster() === 'mainnet' ? getConfig().solanaRpcUrl : getConfig().devnetRpcUrl || DEVNET_RPC;
  }

  /**
   * WS endpoint for Anchor confirmations/live logs. FluxRPC does not serve
   * Solana devnet, so devnet defaults to the public WS (HTTP reads can still
   * go through a dedicated/proxied RPC). Mainnet must set SOLANA_WS_URL or
   * CHAIN_WS_URL when the HTTP provider's WS host differs (e.g. FluxRPC).
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
        wsEndpoint: this.wsUrl(),
        // Let our indexer/keeper own backoff instead of web3 resubscribing hot.
        disableRetryOnRateLimit: true,
      });
    }
    return this.connectionCache;
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
    const signature = await program.methods
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
      })
      .rpc();
    return {
      signature,
      programId: this.programId().toBase58(),
      vault: pdas.vault.toBase58(),
      treasury: pdas.treasury.toBase58(),
      shares: pdas.shares.toBase58(),
      authority: pdas.authority.toBase58(),
    };
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
      const parser = new anchor.EventParser(this.programId(), program.coder.events);
      for (const ev of parser.parseLogs(logs)) {
        out.push({ kind: ev.name, payload: jsonSafe(ev.data) as Record<string, unknown> });
      }
    } catch {
      return out;
    }
    return out;
  }
}
