/**
 * Chain indexer (P2). Subscribes to program logs + backfills signatures,
 * parses Anchor events, upserts chain_events (idempotent), and mirrors
 * rows: deposit/withdrawal SETTLED + chain_sig/slot, vault chain_paused,
 * chain_sig on the latest epoch lacking one. No-op unless CHAIN_ENABLED.
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { getConfig } from '../../config/configuration.js';
import { PrismaService } from '../../database/prisma.service.js';
import { eventNumber, matchDepositByAmount, parseChainEvents } from './events.js';
import { ChainProgramClient } from './program.client.js';
import { ChainOperationService } from './chain-operation.service.js';

const BACKFILL_LIMIT = 50;

@Injectable()
export class ChainIndexerService implements OnModuleInit, OnModuleDestroy {
  private subId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSlot = 0;
  private readonly opQueue: { vaultId: number; signature: string }[] = [];
  private opQueueRunning = false;
  /** HTTP polling fallback runs even when WS is down/rate-limited. */
  private readonly pollMs = getConfig().chain.pollMs;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChainProgramClient) private readonly program: ChainProgramClient,
    @Inject(ChainOperationService) private readonly operations: ChainOperationService,
  ) {}

  onModuleInit(): void {
    if (!this.program.enabled()) return;
    void this.start().catch((e) => console.warn('[chain-indexer] start failed:', (e as Error).message));
    this.timer = setInterval(() => {
      void this.heal().catch((e) => console.warn('[chain-indexer] heal failed:', (e as Error).message));
    }, this.pollMs);
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
      if (e.kind === 'DepositEvent' || e.kind === 'WithdrawEvent' || e.kind === 'EpochSettled') {
        await this.syncVaultEpoch(vaultId, signature).catch(() => undefined);
      }
    }
    if (slot > this.lastSlot) this.lastSlot = slot;
    await this.operations.markIndexed(signature).catch(() => undefined);
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
      findFirst(a: unknown): Promise<{ id: number } | null>;
      updateMany(a: unknown): Promise<unknown>;
      update(a: unknown): Promise<unknown>;
      create(a: unknown): Promise<unknown>;
    }>;
    if (kind === 'DepositEvent') {
      const user = String(payload.user ?? '');
      const amountLamports = eventNumber(payload, 'amountLamports', 'amount_lamports');
      const amount = amountLamports / 1_000_000_000;
      const shares = eventNumber(payload, 'mintedRaw', 'minted_raw') / 1_000_000_000;
      const price = eventNumber(payload, 'priceScaled', 'price_scaled') / 1_000_000_000;
      const queued = (await db.deposit.findMany({
        where: { vaultId, status: 'QUEUED', depositor: user },
        orderBy: { id: 'asc' },
      })) as { id: number; amountSol: unknown }[];
      const row = matchDepositByAmount(queued, amountLamports);
      if (row) {
        await db.deposit.update({
          where: { id: row.id },
          data: { status: 'SETTLED', chainSig: signature, chainSlot: BigInt(slot), settledAt: new Date() },
        });
      } else {
        // Pure on-chain deposit (P3 user-signed path) has no queued off-chain
        // row. Mirror it so the investor UI can show shares/withdraw.
        const exists = await db.deposit.findFirst({ where: { vaultId, chainSig: signature } });
        if (!exists && user) {
          await db.deposit.create({
            data: {
              vaultId,
              depositor: user,
              amountSol: amount,
              status: 'SETTLED',
              sharesMinted: shares,
              sharePrice: price > 0 ? price : 1,
              chainSig: signature,
              chainSlot: BigInt(slot),
              settledAt: new Date(),
            },
          });
        }
      }
    } else if (kind === 'WithdrawEvent') {
      const user = String(payload.user ?? '');
      const shares = eventNumber(payload, 'sharesRaw', 'shares_raw') / 1_000_000_000;
      const paid = eventNumber(payload, 'paidLamports', 'paid_lamports') / 1_000_000_000;
      const price = eventNumber(payload, 'priceScaled', 'price_scaled') / 1_000_000_000;
      const row = await db.withdrawal.findFirst({
        where: { vaultId, status: 'QUEUED', depositor: user },
        orderBy: { id: 'asc' },
      });
      if (row) {
        await db.withdrawal.update({
          where: { id: row.id },
          data: { status: 'SETTLED', chainSig: signature, chainSlot: BigInt(slot), settledAt: new Date() },
        });
      } else {
        const exists = await db.withdrawal.findFirst({ where: { vaultId, chainSig: signature } });
        if (!exists && user) {
          await db.withdrawal.create({
            data: {
              vaultId,
              depositor: user,
              sharesRequested: shares,
              sharesBurned: shares,
              status: 'SETTLED',
              payoutSol: paid,
              sharePrice: price > 0 ? price : 1,
              chainSig: signature,
              chainSlot: BigInt(slot),
              settledAt: new Date(),
            },
          });
        }
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

  /** Low-latency targeted sync after submit; coalesced into one HTTP worker. */
  enqueueSignature(vaultId: number, signature: string): void {
    if (this.opQueue.some((q) => q.signature === signature)) return;
    this.opQueue.push({ vaultId, signature });
    void this.drainOperationQueue();
  }

  private async drainOperationQueue(): Promise<void> {
    if (this.opQueueRunning) return;
    this.opQueueRunning = true;
    try {
      while (this.opQueue.length > 0) {
        const item = this.opQueue.shift();
        if (!item) break;
        try {
          await this.syncSignature(item.signature).catch((e) => {
            console.warn('[chain-indexer] targeted sync failed:', (e as Error).message);
          });
        } catch (e) {
          console.warn('[chain-indexer] operation sync failed:', (e as Error).message);
        }
      }
    } finally {
      this.opQueueRunning = false;
    }
  }

  private async syncSignature(signature: string): Promise<void> {
    const connection = this.program.connection();
    if (!connection) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
      if (tx?.meta?.err) {
        await this.operations.markFailed(signature, JSON.stringify(tx.meta.err));
        return;
      }
      const logs = tx?.meta?.logMessages;
      if (tx && logs) {
        await this.ingest(signature, tx.slot, logs);
        await this.operations.markIndexed(signature);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // The regular 30s poll is the final safety net for a not-yet-visible tx.
  }

  /** Refresh off-chain NAV/price/supply from the vault PDA after money events. */
  private async syncVaultEpoch(vaultId: number, signature: string): Promise<void> {
    const program = this.program.program();
    const connection = this.program.connection();
    if (!program || !connection) return;
    const vault = await this.prisma.vault.findUnique({
      where: { id: vaultId },
      select: { chainVault: true, hwmSharePrice: true },
    });
    if (!vault?.chainVault) return;
    const exists = await this.prisma.epochCheckpoint.findFirst({
      where: { vaultId, chainSig: signature },
      select: { id: true },
    });
    if (exists) return;
    const vaultPk = new PublicKey(vault.chainVault);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onchain: any = await program.account.vault.fetch(vaultPk);
    const cashSol = (await connection.getBalance(this.program.treasuryOf(vaultPk))) / 1_000_000_000;
    const shares = Number(String(onchain.totalShares ?? 0)) / 1_000_000_000;
    const marks = Number(String(onchain.marksLamports ?? 0)) / 1_000_000_000;
    const fee = Number(String(onchain.feeCredit ?? 0)) / 1_000_000_000;
    const nav = cashSol + marks - fee;
    const price = shares > 0 && nav > 0 ? nav / shares : 1;
    await this.prisma.epochCheckpoint.create({
      data: {
        vaultId,
        navSol: nav,
        sharePrice: price,
        sharesOutstanding: shares,
        feeSol: 0,
        chainSig: signature,
      },
    });
    await this.prisma.vault.update({
      where: { id: vaultId },
      data: {
        totalShares: shares,
        treasurySol: cashSol,
        hwmSharePrice: Number(String(onchain.hwmPrice ?? 1_000_000_000)) / 1_000_000_000,
      },
    });
  }

  private async start(): Promise<void> {
    await this.hydrateCursor().catch(() => undefined);
    const connection = this.program.connection();
    if (!connection) return;
    if (getConfig().chain.wsEnabled) {
      try {
        this.subId = await connection.onLogs(this.program.programId(), (info, ctx) => {
          if (info.err) return;
          void this.ingest(info.signature, ctx.slot, info.logs).catch(() => undefined);
        });
      } catch (e) {
        console.warn('[chain-indexer] live subscription unavailable:', (e as Error).message);
      }
    }
    await this.backfill().catch((e) => {
      console.warn('[chain-indexer] backfill delayed:', (e as Error).message);
    });
  }

  private async hydrateCursor(): Promise<void> {
    const latest = await this.prisma.chainEvent.findFirst({
      orderBy: { slot: 'desc' },
      select: { slot: true },
    });
    this.lastSlot = latest ? Number(latest.slot) : 0;
  }

  /** User-triggered post-tx sync: processes the newest signatures even if a
   * keeper event already advanced the cursor past the deposit/withdraw slot. */
  async syncVault(vaultId: number): Promise<{ vaultId: number; synced: boolean }> {
    if (!this.program.enabled()) return { vaultId, synced: false };
    const vault = await this.prisma.vault.findUnique({
      where: { id: vaultId },
      select: { chainVault: true },
    });
    if (!vault?.chainVault) return { vaultId, synced: false };
    await this.backfill(true);
    return { vaultId, synced: true };
  }

  /**
   * Public devnet RPC rate-limits getSignaturesForAddress(programId) hard.
   * Bound vault accounts have very few transactions and include every
   * deposit/withdraw/init tx that touches them, so scan per vault instead.
   */
  private async backfill(force = false): Promise<void> {
    const connection = this.program.connection();
    if (!connection) return;
    const vaults = await this.prisma.vault.findMany({
      where: { chainVault: { not: null } },
      select: { chainVault: true },
    });
    const seen = new Set<string>();
    for (const vault of vaults) {
      if (!vault.chainVault) continue;
      let sigs;
      try {
        sigs = await connection.getSignaturesForAddress(new PublicKey(vault.chainVault), {
          limit: force ? 10 : BACKFILL_LIMIT,
        });
      } catch (e) {
        console.warn('[chain-indexer] vault signatures failed:', (e as Error).message);
        continue;
      }
      for (const s of sigs.reverse()) {
        if (s.blockTime === null || (!force && s.slot <= this.lastSlot) || seen.has(s.signature)) continue;
        seen.add(s.signature);
        try {
          const tx = await this.getTransactionWithRetry(connection, s.signature);
          const logs = tx?.meta?.logMessages ?? null;
          if (!logs) continue;
          await this.ingest(s.signature, s.slot, logs);
          // Public devnet limits getTransaction; pace historical backfill.
          await new Promise((r) => setTimeout(r, 250));
        } catch (e) {
          console.warn('[chain-indexer] tx read failed:', (e as Error).message);
        }
      }
    }
  }

  private async heal(): Promise<void> {
    await this.backfill().catch(() => undefined);
  }

  private async getTransactionWithRetry(
    connection: ReturnType<typeof this.program.connection> & object,
    signature: string,
  ): Promise<{ meta?: { logMessages?: string[] | null } | null } | null> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return (await (connection as unknown as {
          getTransaction(sig: string, opts: { maxSupportedTransactionVersion: number }): Promise<{
            meta?: { logMessages?: string[] | null } | null;
          } | null>;
        }).getTransaction(signature, { maxSupportedTransactionVersion: 0 })) as {
          meta?: { logMessages?: string[] | null } | null;
        } | null;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('getTransaction failed');
  }
}
