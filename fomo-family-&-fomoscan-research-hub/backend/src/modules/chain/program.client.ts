/**
 * Anchor program client (P2). Wraps @coral-xyz/anchor for edgepool-vault:
 * devnet/mainnet connection, keeper keypair, PDA helpers, event decoding.
 * Every method no-ops (null/false) unless CHAIN_ENABLED=true.
 */
import { Injectable } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
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

  connection(): Connection | null {
    if (!this.enabled()) return null;
    if (!this.connectionCache) {
      this.connectionCache = new Connection(this.rpcUrl(), 'confirmed');
    }
    return this.connectionCache;
  }

  keeper(): Keypair | null {
    if (!this.enabled()) return null;
    const key = getConfig().chain.keeperKey;
    if (!key) return null;
    try {
      return keeperFromBase58(key);
    } catch {
      return null;
    }
  }

  /** Anchor Program instance (keeper as payer) or null when misconfigured. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program(): any {
    if (!this.enabled()) return null;
    if (!this.programCache) {
      const keeper = this.keeper();
      const connection = this.connection();
      if (!keeper || !connection) return null;
      const wallet = new anchor.Wallet(keeper);
      const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
      this.programCache = new anchor.Program(loadIdl(), provider);
    }
    return this.programCache;
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
        out.push({ kind: ev.name, payload: { ...(ev.data as object) } });
      }
    } catch {
      return out;
    }
    return out;
  }
}
