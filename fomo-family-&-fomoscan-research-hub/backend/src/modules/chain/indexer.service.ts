/**
 * Chain indexer (P2). Subscribes to program logs + backfills signatures,
 * parses Anchor events, upserts chain_events (idempotent), and mirrors
 * rows: deposit/withdrawal SETTLED + chain_sig/slot, vault chain_paused,
 * chain_sig on the latest epoch lacking one. No-op unless CHAIN_ENABLED.
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { matchDepositByAmount, parseChainEvents } from './events.js';
import { ChainProgramClient } from './program.client.js';

const BACKFILL_LIMIT = 50;
const HEAL_INTERVAL_MS = 60_000;

@Injectable()
export class ChainIndexerService implements OnModuleInit, OnModuleDestroy {
  private subId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSlot = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChainProgramClient) private readonly program: ChainProgramClient,
  ) {}

  onModuleInit(): void {
    if (!this.program.enabled()) return;
    void this.start().catch((e) => console.warn('[chain-indexer] start failed:', (e as Error).message));
    this.timer = setInterval(() => {
      void this.heal().catch((e) => console.warn('[chain-indexer] heal failed:', (e as Error).message));
    }, HEAL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    const connection = this.program.connection();
    if (connection && this.subId !== null) {
      void connection.removeOnLogsListener(this.subId).catch(() => undefined);
    }
  }

  private vaultIdByAddress(): Promise<Map<string, number>> {
    return this.prisma.vault
      .findMany({ where: { chainVault: { not: null } }, select: { id: true, chainVault: true } })
      .then((rows) => new Map(rows.map((r) => [r.chainVault as string, r.id])));
  }

  private async ingest(signature: string, slot: number, logs: string[]): Promise<void> {
    const pid = this.program.programId().toBase58();
    const decoded = this.program.decodeLogs(logs);
    let di = 0;
    const events = parseChainEvents(signature, slot, logs, pid, () => {
      const next = decoded[di];
      di += 1;
      return next ?? null;
    });
    if (events.length === 0) return;
    const byVault = await this.vaultIdByAddress();
    for (const e of events) {
      const vaultAddr = (e.payload.vault as string) ?? '';
      const vaultId = byVault.get(vaultAddr);
      if (!vaultId) continue;
      try {
        await (this.prisma as unknown as Record<string, unknown> & {
          chainEvent: { upsert(a: unknown): Promise<unknown> };
        }).chainEvent.upsert({
          where: { signature_ixIndex_eventIndex: { signature: e.signature, ixIndex: e.ixIndex, eventIndex: e.eventIndex } },
          create: {
            vaultId,
            signature: e.signature,
            ixIndex: e.ixIndex,
            eventIndex: e.eventIndex,
            kind: e.kind,
            slot: BigInt(e.slot),
            payload: e.payload as Record<string, number>,
          },
          update: {},
        });
      } catch {
        continue;
      }
      await this.mirror(vaultId, e.kind, e.payload, signature, slot).catch(() => undefined);
    }
    if (slot > this.lastSlot) this.lastSlot = slot;
  }

  /** Mirror an on-chain event into off-chain rows (best-effort, fuzzy match). */
  private async mirror(
    vaultId: number,
    kind: string,
    payload: Record<string, unknown>,
    signature: string,
    slot: number,
  ): Promise<void> {
    const db = this.prisma as unknown as Record<string, {
      findMany(a: unknown): Promise<unknown[]>;
      updateMany(a: unknown): Promise<unknown>;
      update(a: unknown): Promise<unknown>;
      findFirst(a: unknown): Promise<{ id: number } | null>;
    }>;
    if (kind === 'DepositEvent') {
      const user = String(payload.user ?? '');
      const amount = Number(payload.amount_lamports ?? 0);
      const queued = (await db.deposit.findMany({
        where: { vaultId, status: 'QUEUED', depositor: user },
        orderBy: { id: 'asc' },
      })) as { id: number; amountSol: unknown }[];
      const row = matchDepositByAmount(queued, amount);
      if (row) {
        await db.deposit.update({
          where: { id: row.id },
          data: { status: 'SETTLED', chainSig: signature, chainSlot: BigInt(slot), settledAt: new Date() },
        });
      }
    } else if (kind === 'WithdrawEvent') {
      const user = String(payload.user ?? '');
      const row = await db.withdrawal.findFirst({
        where: { vaultId, status: 'QUEUED', depositor: user },
        orderBy: { id: 'asc' },
      });
      if (row) {
        await db.withdrawal.update({
          where: { id: row.id },
          data: { status: 'SETTLED', chainSig: signature, chainSlot: BigInt(slot), settledAt: new Date() },
        });
      }
    } else if (kind === 'PausedEvent') {
      await db.vault.update({ where: { id: vaultId }, data: { chainPaused: Boolean(payload.flag) } });
    } else if (kind === 'EpochSettled') {
      const latest = await db.epochCheckpoint.findFirst({
        where: { vaultId, chainSig: null },
        orderBy: { id: 'desc' },
      });
      if (latest) {
        await db.epochCheckpoint.update({ where: { id: latest.id }, data: { chainSig: signature } });
      }
    }
  }

  private async start(): Promise<void> {
    const connection = this.program.connection();
    if (!connection) return;
    const pid = this.program.programId();
    await this.backfill();
    this.subId = await connection.onLogs(pid, (info, ctx) => {
      if (info.err) return;
      void this.ingest(info.signature, ctx.slot, info.logs).catch(() => undefined);
    });
  }

  private async backfill(): Promise<void> {
    const connection = this.program.connection();
    if (!connection) return;
    const sigs = await connection.getSignaturesForAddress(this.program.programId(), { limit: BACKFILL_LIMIT });
    for (const s of sigs.reverse()) {
      if (s.blockTime === null || s.slot <= this.lastSlot) continue;
      const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? null;
      if (!logs) continue;
      await this.ingest(s.signature, s.slot, logs);
    }
  }

  private async heal(): Promise<void> {
    await this.backfill().catch(() => undefined);
  }
}
