/**
 * Reconcile job (P2, design §7.5B). Periodically compares on-chain vault
 * state with the off-chain mirror for chain-bound vaults. Mismatches warn
 * + append an audit row. Read-only besides the audit row. No-op unless
 * CHAIN_ENABLED.
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { checkReconcile } from './reconcile.js';
import { ChainProgramClient } from './program.client.js';

const RECONCILE_MS = 5 * 60_000;

interface ReconDb {
  vault: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  deposit: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  withdrawal: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  epochCheckpoint: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  chainEvent: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
}

@Injectable()
export class ChainReconcileService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChainProgramClient) private readonly program: ChainProgramClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce().catch((e) => console.warn('[chain-reconcile] failed:', (e as Error).message));
    }, RECONCILE_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get db(): ReconDb {
    return this.prisma as unknown as ReconDb;
  }

  async runOnce(): Promise<{ vaults: number; issues: number }> {
    if (!this.program.enabled()) return { vaults: 0, issues: 0 };
    const program = this.program.program();
    if (!program) return { vaults: 0, issues: 0 };
    const vaults = await this.db.vault.findMany({ where: { chainVault: { not: null } } });
    let issues = 0;
    for (const v of vaults) {
      try {
        issues += await this.checkVault(Number(v.id), String(v.chainVault), program);
      } catch (e) {
        console.warn(`[chain-reconcile] vault ${v.id}:`, (e as Error).message);
      }
    }
    return { vaults: vaults.length, issues };
  }

  private async checkVault(
    vaultId: number,
    chainVault: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
  ): Promise<number> {
    const vaultPk = new PublicKey(chainVault);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onchain: any = await program.account.vault.fetch(vaultPk);
    const treasury = this.program.treasuryOf(vaultPk);
    const connection = this.program.connection();
    const treasuryCash = connection ? await connection.getBalance(treasury) : 0;
    const [rows, deposits, withdrawals, epochs, events] = await Promise.all([
      this.db.vault.findMany({ where: { id: vaultId }, take: 1 }),
      this.db.deposit.findMany({ where: { vaultId, status: 'SETTLED' } }),
      this.db.withdrawal.findMany({ where: { vaultId, status: 'SETTLED' } }),
      this.db.epochCheckpoint.findMany({ where: { vaultId }, orderBy: { id: 'desc' }, take: 1 }),
      this.db.chainEvent.findMany({ where: { vaultId }, select: { signature: true } }),
    ]);
    const supply = Number(onchain.totalShares ?? 0);
    const nav = treasuryCash + Number(onchain.marksLamports ?? 0) - Number(onchain.feeCredit ?? 0);
    const priceScaled = supply > 0 && nav > 0 ? Math.floor((nav * 1_000_000_000) / supply) : 1_000_000_000;
    const minted = deposits.reduce((s, d) => s + Number(d.sharesMinted ?? 0) * 1_000_000_000, 0);
    const burned = withdrawals.reduce((s, w) => {
      const price = Number(w.sharePrice ?? 0);
      const payout = Number(w.payoutSol ?? 0);
      return s + (price > 0 ? (payout / price) * 1_000_000_000 : Number(w.sharesRequested ?? 0) * 1_000_000_000);
    }, 0);
    const last = epochs[0] as unknown as { sharePrice?: unknown; navSol?: unknown } | undefined;
    const offHwm = rows[0] as unknown as { hwmSharePrice?: unknown } | undefined;
    const found = checkReconcile(
      {
        supplyRaw: supply,
        hwmScaled: Number(onchain.hwmPrice ?? 0),
        priceScaled,
        treasuryCash,
        feeCredit: Number(onchain.feeCredit ?? 0),
      },
      {
        supplyRaw: Math.max(0, Math.round(minted - burned)),
        hwmScaled: Math.round(Number(offHwm?.hwmSharePrice ?? 0) * 1_000_000_000),
        lastPriceScaled: Math.round(Number(last?.sharePrice ?? 0) * 1_000_000_000),
        obligations: 0,
        treasuryCash,
        referencedSigs: [],
        storedSigs: events.map((e) => String(e.signature)),
      },
    );
    for (const issue of found) {
      console.warn(`[chain-reconcile] vault ${vaultId} ${issue.check}: ${issue.detail}`);
      await this.audit
        .record({
          actor: 'chain-reconcile',
          action: `chain.reconcile_${issue.check}`,
          target: String(vaultId),
          reason: issue.detail,
        })
        .catch(() => undefined);
    }
    return found.length;
  }
}
