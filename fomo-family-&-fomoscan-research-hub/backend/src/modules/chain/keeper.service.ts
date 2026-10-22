/**
 * Keeper bot (P2). Tick 45s cho vaults đã bind on-chain: đẩy marks từ
 * paper positions (read-only), settle theo cadence, kill-switch pause,
 * ghi sim-trade cho legs mới. Toàn bộ no-op khi CHAIN_ENABLED=false
 * hoặc thiếu keeper key. Mọi lỗi mạng/tx chỉ warn, không crash loop.
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { AuditService } from '../audit/audit.service.js';
import { computeMarksLamports } from './events.js';
import { ChainProgramClient } from './program.client.js';

// @coral-xyz/anchor là CJS — ESM import named export gãy runtime, phải qua createRequire
// (bài học P1c: BN.eqn cũng hỏng với number > 2^26).
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { BN }: { BN: new (n: number | string) => any } = require('@coral-xyz/anchor');

const TICK_MS = 45_000;
const SETTLE_EVERY_TICKS = 10;
const KILL_DROP = 0.05;
const WSOL = 'So11111111111111111111111111111111111111112';

interface KeeperDb {
  vault: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  copyOrder: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  copyOrderLeg: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
  epochCheckpoint: { findMany(a: unknown): Promise<Record<string, unknown>[]> };
}

@Injectable()
export class ChainKeeperService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private lastLegId = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChainProgramClient) private readonly program: ChainProgramClient,
    @Inject(DataStreamService) private readonly prices: DataStreamService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((e) => console.warn('[chain-keeper] tick failed:', (e as Error).message));
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get db(): KeeperDb {
    return this.prisma as unknown as KeeperDb;
  }

  private async tick(): Promise<void> {
    if (!this.program.enabled()) return;
    const keeper = this.program.keeper();
    const program = this.program.program();
    if (!keeper || !program) return;
    this.ticks += 1;
    const vaults = await this.db.vault.findMany({ where: { chainVault: { not: null } } });
    for (const v of vaults) {
      try {
        await this.tickVault(v as { id: number; chainVault: string }, program, keeper);
      } catch (e) {
        console.warn(`[chain-keeper] vault ${v.id} failed:`, (e as Error).message);
      }
    }
    await this.recordSimTrades(program, keeper).catch(() => undefined);
  }

  private async solPrice(): Promise<number> {
    try {
      const m = await this.prices.bulkPrices([WSOL]);
      return m[WSOL] ?? 0;
    } catch {
      return 0;
    }
  }

  private async tickVault(
    v: { id: number; chainVault: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
    keeper: Keypair,
  ): Promise<void> {
    const vaultPk = new PublicKey(v.chainVault);
    const treasury = this.program.treasuryOf(vaultPk);
    const open = await this.db.copyOrder.findMany({
      where: { vaultId: v.id, status: 'CONFIRMED', closedAt: null },
      select: { amountUsd: true },
    });
    const sol = await this.solPrice();
    const values = open.map((o) => (sol > 0 ? Number(o.amountUsd ?? 0) / sol : 0));
    const marks = computeMarksLamports(values);
    await this.program.sendAndConfirmPolling(
      program.methods
        .updateMarks(new BN(marks))
        .accounts({ vault: vaultPk, treasury, keeper: keeper.publicKey }),
      keeper,
    );
    if (this.ticks % SETTLE_EVERY_TICKS === 0) {
      await this.program.sendAndConfirmPolling(
        program.methods.settleEpoch().accounts({ vault: vaultPk, treasury, keeper: keeper.publicKey }),
        keeper,
      );
    }
    await this.killSwitch(v);
  }

  /**
   * Kill-switch watch: NAV drop ≥5% across the last two epochs raises an
   * audit alert. On-chain pause stays manager-only (set_paused has_one
   * manager), so the keeper never pauses by itself — a human decides.
   */
  private async killSwitch(v: { id: number; chainVault: string }): Promise<void> {
    const epochs = await this.db.epochCheckpoint.findMany({
      where: { vaultId: v.id },
      orderBy: { id: 'desc' },
      take: 2,
    });
    if (epochs.length < 2) return;
    // Compare price per share, not NAV: deposits/withdrawals legitimately
    // change NAV via flows and must not trigger a performance kill-switch.
    const [now, prev] = epochs.map((e) => Number(e.sharePrice ?? 0));
    if (prev > 0 && now < prev * (1 - KILL_DROP)) {
      const reason = `share-price drop ${(100 * (1 - now / prev)).toFixed(2)}% — manager review, consider set_paused`;
      console.warn(`[chain-keeper] KILL-SWITCH vault ${v.id}: ${reason}`);
      await this.audit
        .record({ actor: 'chain-keeper', action: 'chain.kill_switch', target: String(v.id), reason })
        .catch(() => undefined);
    }
  }

  private async recordSimTrades(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
    keeper: Keypair,
  ): Promise<void> {
    const legs = await this.db.copyOrderLeg.findMany({
      where: { id: { gt: this.lastLegId } },
      orderBy: { id: 'asc' },
      take: 20,
    });
    for (const leg of legs) {
      const id = Number(leg.id ?? 0);
      if (id > this.lastLegId) this.lastLegId = id;
      const orders = await this.db.copyOrder.findMany({
        where: { id: Number(leg.orderId ?? -1) },
        take: 1,
      });
      const order = orders[0] as unknown as { vaultId?: unknown; tokenMint?: unknown; amountUsd?: unknown } | undefined;
      if (!order?.vaultId || typeof order.tokenMint !== 'string') continue;
      const vaults = await this.db.vault.findMany({ where: { id: Number(order.vaultId) }, take: 1 });
      const chainVault = (vaults[0] as unknown as { chainVault?: unknown } | undefined)?.chainVault;
      if (!chainVault) continue;
      const sol = await this.solPrice();
      const sizeLamports = sol > 0 ? Math.floor(Number(order.amountUsd ?? 0) / sol) : 0;
      try {
        await this.program.sendAndConfirmPolling(
          program.methods
            .recordSimTrade(
              new PublicKey(String(order.tokenMint)),
              String(leg.leg ?? '').startsWith('TP') ? 1 : 0,
              new BN(sizeLamports),
              new BN(0),
              new BN(0),
            )
            .accounts({ vault: new PublicKey(String(chainVault)), keeper: keeper.publicKey }),
          keeper,
        );
      } catch {
        continue;
      }
    }
  }
}
