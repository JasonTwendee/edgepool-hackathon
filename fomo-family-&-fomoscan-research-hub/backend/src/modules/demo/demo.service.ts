import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CopyTradeService } from '../copy-trade/copy-trade.service.js';
import { ManageService } from '../copy-trade/manage.service.js';
import type { PaperExecutorService } from '../copy-trade/paper-executor.service.js';
import { VaultService } from '../vaults/vault.service.js';
import { emitSignal } from '../copy-trade/signal-bus.js';
import { BotsService } from '../bots/bots.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';

const DEMO_PREFIX = 'demo-';
const DEMO_DEPOSITOR = 'demo';
const WSOL = 'So11111111111111111111111111111111111111112';

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

function missing(message: string): never {
  throw new NotFoundException({ success: false, message });
}

const num = (v: { toNumber(): number } | number | null | undefined): number => {
  if (typeof v === 'number') return v;
  return v?.toNumber() ?? 0;
};

/**
 * Simulated executor for replay (intent D-M1): full order lifecycle with zero
 * devnet broadcasts. Replay IS simulation — dust proofs add no demo value.
 */
function simExecutor(): PaperExecutorService {
  let n = 0;
  return {
    assertDevnet: async () => undefined,
    fetchQuote: async () => ({ outAmount: '1000000', otherAmountThreshold: '1000000', priceImpactPct: '0' }),
    loadVaultKeypair: () => Keypair.generate(),
    executeProof: async () => {
      n += 1;
      return { signature: `demoProof${Date.now()}${n}`.padEnd(88, '0'), slot: 0 };
    },
  } as unknown as PaperExecutorService;
}

/**
 * Demo Simulator: seed → replay → manage → settle + deposit2/withdraw-pending →
 * performance, reset. Trader/portfolio inputs are REAL ledger rows; every bot
 * output row is marked simulated (`demo-` names, `demo` depositor,
 * `quoteJson.sized.triggeredBy = 'demo:<botId>'`). Manual-trigger only.
 */
@Injectable()
export class DemoService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CopyTradeService) private readonly copy: CopyTradeService,
    @Inject(ManageService) private readonly manage: ManageService,
    @Inject(VaultService) private readonly vaults: VaultService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DataStreamService) private readonly market: DataStreamService,
  ) {}

  private demoTag(): string {
    return Date.now().toString(36);
  }

  async seed(opts: { name?: string; depositSol?: number; traderCount?: number }, actor: string) {
    const baseName = (opts.name ?? 'fund').trim() || 'fund';
    const name = `${DEMO_PREFIX}${baseName}`;
    const depositSol = opts.depositSol ?? 100;
    const traderCount = Math.min(Math.max(opts.traderCount ?? 3, 1), 5);
    const wallets = await this.prisma.trackedWallet.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      take: traderCount,
    });
    if (wallets.length === 0) fail('No active tracked wallets to build the demo set.');
    const tag = this.demoTag();
    const vault = (await this.vaults.createVault(`${name}-${tag}`)) as { id: number };
    // Demo pools stay off the public index (unlisted) + never pose as flagship.
    await this.prisma.vault.update({ where: { id: vault.id }, data: { listing: 'unlisted' } });
    const even = Math.floor(10000 / wallets.length);
    for (let i = 0; i < wallets.length; i++) {
      await this.vaults.assignTrader(vault.id, wallets[i].address, i === 0 ? 10000 - even * (wallets.length - 1) : even);
    }
    const bot = (await this.bots.create(`${DEMO_PREFIX}bot-${tag}`, vault.id)) as { id: number };
    await this.vaults.deposit(vault.id, DEMO_DEPOSITOR, depositSol);
    await this.vaults.settleEpoch(vault.id, depositSol);
    await this.audit.record({ actor, action: 'demo.seed', target: `vault:${vault.id}`, reason: `bot:${bot.id} traders=${wallets.length} deposit=${depositSol}` });
    return {
      vaultId: vault.id,
      botId: bot.id,
      traders: wallets.map((w) => w.address),
      depositSol,
      sharePrice: 1,
      environment: 'sandbox' as const,
    };
  }

  private async resolveDemoPair(vaultId?: number, botId?: number): Promise<{ vaultId: number; botId: number }> {
    if (vaultId !== undefined && botId !== undefined) {
      const [v, b] = await Promise.all([
        this.prisma.vault.findUnique({ where: { id: vaultId } }),
        this.prisma.bot.findUnique({ where: { id: botId } }),
      ]);
      if (!v || !v.name.startsWith(DEMO_PREFIX)) fail(`Vault ${vaultId} is not a demo vault.`);
      if (!b || !b.name.startsWith(DEMO_PREFIX)) fail(`Bot ${botId} is not a demo bot.`);
      return { vaultId, botId };
    }
    const v = await this.prisma.vault.findFirst({ where: { name: { startsWith: DEMO_PREFIX } }, orderBy: { id: 'desc' } });
    if (!v) fail('No demo vault yet — POST /api/demo/seed first.');
    const b = await this.prisma.bot.findFirst({ where: { vaultId: v.id }, orderBy: { id: 'desc' } });
    if (!b) fail(`Demo vault ${v.id} has no bot.`);
    return { vaultId: v.id, botId: b.id };
  }

  async replay(
    opts: { vaultId?: number; botId?: number; days?: number; limit?: number; skipClose?: boolean },
    actor: string,
  ) {
    const { vaultId, botId } = await this.resolveDemoPair(opts.vaultId, opts.botId);
    const days = Math.min(Math.max(opts.days ?? 7, 1), 120);
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await this.prisma.transaction.findMany({
      where: { action: 'BUY', tokenMint: { not: null }, createdAt: { gte: since } },
      select: { signature: true, walletAddress: true, symbol: true, tokenMint: true, amountUsd: true, dexVenue: true },
      orderBy: { blockTime: 'asc' },
      take: limit * 2,
    });
    // Respect exposure caps (3/trader/24h): at most 3 signals per master.
    const perWallet = new Map<string, number>();
    const signals = rows.filter((r) => {
      const c = (perWallet.get(r.walletAddress) ?? 0) + 1;
      perWallet.set(r.walletAddress, c);
      return c <= 3;
    }).slice(0, limit);
    let fired = 0;
    let failed = 0;
    const orderIds: number[] = [];
    for (const s of signals) {
      try {
        const order = await this.copy.executePaper(
          {
            masterWallet: s.walletAddress,
            masterTxHash: s.signature,
            symbol: s.symbol ?? undefined,
            action: 'BUY',
            tokenMint: s.tokenMint ?? undefined,
            amountUsd: num(s.amountUsd) || undefined,
            venue: s.dexVenue ?? undefined,
            mode: 'paper',
            confirm: true,
            entryMode: 'immediate',
            tp1Pct: 60,
            stopPct: 30,
          },
          {
            paperEnabled: true,
            maxUsd: 10_000_000,
            executor: simExecutor(),
            connection: {} as never,
            strict: false,
            vaultId,
            triggeredBy: `demo:${botId}`,
          },
        );
        fired++;
        orderIds.push(order.id);
        emitSignal({
          vaultId,
          kind: 'ENTER',
          token: (s.symbol ?? (s.tokenMint ?? '').slice(0, 8)) || '—',
          trader: (s.walletAddress ?? '').slice(0, 8),
          note: `order #${order.id} entered (demo)`,
        });
      } catch (e) {
        failed++;
        emitSignal({
          vaultId,
          kind: 'SKIP',
          token: (s.symbol ?? (s.tokenMint ?? '').slice(0, 8)) || '—',
          trader: (s.walletAddress ?? '').slice(0, 8),
          note: `demo skip: ${e instanceof Error ? e.message.slice(0, 100) : 'failed'}`,
        });
      }
    }
    const managed = await this.manage.tick(100).catch(() => null);
    // Guided-flow mode: leave positions open for the visible partial exit —
    // no force-close, no scripted settle, no withdrawal yet.
    if (opts.skipClose === true) {
      await this.audit.record({
        actor,
        action: 'demo.replay',
        target: `vault:${vaultId}`,
        reason: `bot:${botId} signals=${signals.length} fired=${fired} failed=${failed} skippedClose`,
      });
      return {
        vaultId,
        botId,
        signals: signals.length,
        fired,
        failed,
        orderIds,
        managed,
        forceClosed: 0,
        skippedClose: true,
        deposit2: 0,
        settleNavSol: null,
        withdrawal: null,
        environment: 'sandbox' as const,
      };
    }
    const forceClosed = await this.closeRemainder(orderIds);
    // Second deposit at the new price (no retro profit) + one epoch settle.
    const realizedSum = await this.demoRealized(orderIds);
    let solPrice = 0;
    try {
      solPrice = (await this.market.bulkPrices([WSOL]))[WSOL] ?? 0;
    } catch {
      solPrice = 0;
    }
    const status = await this.vaults.status(vaultId);
    const prevNav = status.lastEpoch?.navSol ?? 0;
    const nav = prevNav + 20 + (solPrice > 0 ? realizedSum / solPrice : 0);
    await this.vaults.deposit(vaultId, DEMO_DEPOSITOR, 20);
    await this.vaults.settleEpoch(vaultId, Math.round(nav * 1e9) / 1e9);
    // Withdraw demo: request ONLY — stays QUEUED with a pending notification.
    // The operator settles it explicitly later (or leaves it pending on stage).
    let withdrawal: { id: number; status: string; pending: boolean; message: string } | null = null;
    try {
      const balance = await this.vaults.depositorShares(vaultId, DEMO_DEPOSITOR);
      if (balance > 0) {
        const w = await this.vaults.requestWithdraw(vaultId, DEMO_DEPOSITOR, Math.min(10, balance));
        withdrawal = {
          id: w.id,
          status: w.status,
          pending: true,
          message: 'Withdrawal is queued for the next epoch — the demo stops here (no auto-settle).',
        };
      }
    } catch (e) {
      withdrawal = { id: -1, status: 'SKIPPED', pending: true, message: `Demo withdrawal failed: ${(e as Error).message}` };
    }
    await this.audit.record({
      actor,
      action: 'demo.replay',
      target: `vault:${vaultId}`,
      reason: `bot:${botId} signals=${signals.length} fired=${fired} failed=${failed} forceClosed=${forceClosed} withdrawal=${withdrawal?.status ?? 'none'}`,
    });
    return {
      vaultId,
      botId,
      signals: signals.length,
      fired,
      failed,
      orderIds,
      managed,
      forceClosed,
      deposit2: 20,
      settleNavSol: Math.round(nav * 1e9) / 1e9,
      withdrawal,
      environment: 'sandbox' as const,
    };
  }

  /**
   * One-click stage demo: reset old demo pools, then run 3 cases in parallel.
   * Each case = seed (vault + bot + traders + deposit + settle) + replay
   * (real ledger BUYs → SKIP/ENTER on the terminal bus, manage EXITs,
   * second deposit + settle moves NAV, withdrawal stays QUEUED = vault trừ tiền).
   */
  async scenario(actor: string) {
    const cleaned = await this.reset(actor);
    const cases = [
      { name: 'case-momentum', depositSol: 100, traderCount: 3, limit: 5 },
      { name: 'case-value', depositSol: 50, traderCount: 2, limit: 3 },
      { name: 'case-broad', depositSol: 200, traderCount: 5, limit: 8 },
    ];
    const settled = await Promise.allSettled(
      cases.map(async (c) => {
        const seeded = await this.seed(
          { name: c.name, depositSol: c.depositSol, traderCount: c.traderCount },
          actor,
        );
        const replayed = await this.replay(
          { vaultId: seeded.vaultId, botId: seeded.botId, days: 7, limit: c.limit },
          actor,
        );
        return { name: c.name, ...replayed };
      }),
    );
    const results = settled.map((r, i) =>
      r.status === 'fulfilled'
        ? { ok: true as const, ...r.value }
        : {
            ok: false as const,
            name: cases[i].name,
            error: r.reason instanceof Error ? r.reason.message : 'scenario case failed',
          },
    );
    await this.audit.record({
      actor,
      action: 'demo.scenario',
      target: 'demo:scenariox3',
      reason: results.map((d) => `${d.name}:${d.ok ? 'ok' : `fail(${d.error})`}`).join(', '),
    });
    return { cleaned, cases: results, environment: 'sandbox' as const };
  }

  /** Close still-open demo orders as TIME scratch (no price guessing). */
  private async closeRemainder(orderIds: number[]): Promise<number> {
    if (orderIds.length === 0) return 0;
    const open = await this.prisma.copyOrder.findMany({
      where: { id: { in: orderIds }, closedAt: null },
      select: { id: true, vaultId: true, symbol: true, tokenMint: true, masterHandle: true, masterWallet: true, amountUsd: true, entryPriceUsd: true },
    });
    if (open.length === 0) return 0;
    const mints = [...new Set(open.map((o) => o.tokenMint).filter((m): m is string => !!m))];
    const spot = await this.market.bulkPrices(mints).catch(() => ({}) as Record<string, number>);
    let closed = 0;
    for (const o of open) {
      const entry = num(o.entryPriceUsd);
      const now = (o.tokenMint && spot[o.tokenMint]) || null;
      const exit = now ?? (entry > 0 ? entry : 0);
      const realized = entry > 0 && now !== null ? Math.round((((now - entry) / entry) * num(o.amountUsd)) * 100) / 100 : 0;
      const legs = await this.prisma.copyOrderLeg.findMany({ where: { orderId: o.id } });
      const done = legs.reduce((s, l) => s + Number(l.fraction ?? 0), 0);
      const remaining = Math.max(0, 1 - done);
      if (remaining <= 1e-9) continue;
      await this.prisma.copyOrderLeg.create({
        data: { orderId: o.id, leg: 'TIME', fraction: remaining, exitPriceUsd: exit, realizedPnlUsd: realized, closedAt: new Date() },
      });
      const all = [...legs, { fraction: remaining, realizedPnlUsd: realized, exitPriceUsd: exit }];
      const total = Math.round(all.reduce((s, l) => s + Number(l.realizedPnlUsd ?? 0), 0) * 100) / 100;
      await this.prisma.copyOrder.update({
        where: { id: o.id },
        data: { exitPriceUsd: exit, closeReason: done > 0 ? 'TP1_HIT' : 'TIME_STOP', closedAt: new Date(), realizedPnlUsd: total },
      });
      closed++;
      // Terminal stream: force-closes were silent — emit the EXIT leg like
      // manage.tick does so the demo narrative shows the full journey.
      try {
        if (o.vaultId) {
          emitSignal({
            vaultId: o.vaultId as number,
            kind: 'EXIT',
            token: o.symbol ?? (o.tokenMint ?? '').slice(0, 8),
            trader: o.masterHandle ?? (o.masterWallet ?? '').slice(0, 8),
            note: `TIME ${(remaining * 100).toFixed(0)}% scratch (${realized >= 0 ? '+' : ''}$${realized})`,
          });
        }
      } catch {
        // stream-only; persist already succeeded above
      }
    }
    return closed;
  }

  /**
   * Guided-flow partial exit (demo vaults only): sell a fraction of one open
   * order at the live price. TP1 leg when the live price reached the target,
   * otherwise a TIME scratch leg. Honest paper math — realized from the live
   * print, order stays open unless the remainder hits zero.
   */
  async partialClose(
    opts: { vaultId: number; orderId?: number; fraction?: number },
    actor: string,
  ): Promise<Record<string, unknown>> {
    const v = await this.prisma.vault.findUnique({ where: { id: opts.vaultId } });
    if (!v || !(v.name as string).startsWith(DEMO_PREFIX)) fail(`Vault ${opts.vaultId} is not a demo vault.`);
    const frac = Math.min(Math.max(typeof opts.fraction === 'number' ? opts.fraction : 0.4, 0.05), 1);
    let order;
    if (opts.orderId !== undefined) {
      order = await this.prisma.copyOrder.findUnique({ where: { id: opts.orderId } });
      if (!order || (order.vaultId as number) !== (v.id as number)) fail(`Order ${opts.orderId} is not in demo vault ${v.id}.`);
      if ((order.closedAt as unknown) !== null && (order.closedAt as unknown) !== undefined) fail(`Order ${opts.orderId} is already closed.`);
    } else {
      const open = await this.prisma.copyOrder.findMany({
        where: { vaultId: v.id, closedAt: null, status: 'CONFIRMED' },
        orderBy: { id: 'asc' },
      });
      order = open[0] ?? null;
      if (!order) fail(`Demo vault ${v.id} has no open orders to partially exit.`);
    }
    const mints = order.tokenMint ? [order.tokenMint as string] : [];
    const WSOL = 'So11111111111111111111111111111111111111112';
    let spot: Record<string, number> = {};
    let solPx = 0;
    try {
      const px = await this.market.bulkPrices([...new Set([...mints, WSOL])]);
      solPx = px[WSOL] ?? 0;
      spot = px;
    } catch {
      spot = {};
    }
    const entry = num(order.entryPriceUsd);
    const live = (order.tokenMint && spot[order.tokenMint as string]) || null;
    const tp1 = num(order.tp1Pct);
    const hit = entry > 0 && live !== null && tp1 > 0 && live >= entry * (1 + tp1 / 100);
    const legs = await this.prisma.copyOrderLeg.findMany({ where: { orderId: order.id } });
    const done = legs.reduce((s, l) => s + Number(l.fraction ?? 0), 0);
    const remaining = Math.max(0, 1 - done);
    const take = Math.min(frac, remaining);
    if (take <= 1e-9) fail(`Order ${order.id} is already fully exited.`);
    const exit = live ?? (entry > 0 ? entry : 0);
    const realized = entry > 0 && live !== null
      ? Math.round((((live - entry) / entry) * num(order.amountUsd) * take) * 100) / 100
      : 0;
    const leg = hit ? 'TP1' : 'TIME';
    await this.prisma.copyOrderLeg.create({
      data: { orderId: order.id, leg, fraction: take, exitPriceUsd: exit, realizedPnlUsd: realized, closedAt: new Date() },
    });
    const all = await this.prisma.copyOrderLeg.findMany({ where: { orderId: order.id } });
    const total = Math.round(all.reduce((s, l) => s + Number(l.realizedPnlUsd ?? 0), 0) * 100) / 100;
    const closesFully = remaining - take <= 1e-9;
    await this.prisma.copyOrder.update({
      where: { id: order.id },
      data: closesFully
        ? { exitPriceUsd: exit, closeReason: leg === 'TP1' ? 'TP1_HIT' : 'TIME_STOP', closedAt: new Date(), realizedPnlUsd: total }
        : { exitPriceUsd: exit, realizedPnlUsd: total },
    });
    await this.audit.record({
      actor,
      action: 'demo.partial_close',
      target: `order:${order.id}`,
      reason: `${leg} frac=${take} exit=${exit} realized=$${realized}`,
    });
    try {
      emitSignal({
        vaultId: v.id as number,
        kind: 'EXIT',
        token: (order.symbol as string | null) ?? ((order.tokenMint as string | null) ?? '').slice(0, 8),
        trader: (order.masterHandle as string | null) ?? ((order.masterWallet as string | null) ?? '').slice(0, 8),
        note: `${leg} ${(take * 100).toFixed(0)}% @${exit} (${realized >= 0 ? '+' : ''}$${realized})`,
      });
    } catch {
      // stream-only
    }
    return {
      orderId: order.id, leg, fraction: take, exitPriceUsd: exit,
      realizedPnlUsd: realized, remaining: Math.max(0, remaining - take),
      closed: closesFully, solPx, environment: 'sandbox' as const,
    };
  }

  private async demoRealized(orderIds: number[]): Promise<number> {
    if (orderIds.length === 0) return 0;
    const rows = await this.prisma.copyOrder.findMany({
      where: { id: { in: orderIds } },
      select: { realizedPnlUsd: true },
    });
    return Math.round(rows.reduce((s, r) => s + num(r.realizedPnlUsd), 0) * 100) / 100;
  }

  async reset(actor: string) {
    const vaults = await this.prisma.vault.findMany({ where: { name: { startsWith: DEMO_PREFIX } }, select: { id: true } });
    const vaultIds = vaults.map((v) => v.id);
    const bots = await this.prisma.bot.findMany({ where: { name: { startsWith: DEMO_PREFIX } }, select: { id: true } });
    const botIds = bots.map((b) => b.id);
    const demoOrders = await this.prisma.copyOrder.findMany({
      where: { quoteJson: { path: ['sized', 'triggeredBy'], string_contains: 'demo:' } },
      select: { id: true },
    });
    const orderIds = demoOrders.map((o) => o.id);
    let legs = 0;
    let orders = 0;
    if (orderIds.length > 0) {
      legs = (await this.prisma.copyOrderLeg.deleteMany({ where: { orderId: { in: orderIds } } })).count;
      orders = (await this.prisma.copyOrder.deleteMany({ where: { id: { in: orderIds } } })).count;
    }
    let deposits = 0;
    let withdrawals = 0;
    let epochs = 0;
    let traders = 0;
    if (vaultIds.length > 0) {
      deposits = (await this.prisma.deposit.deleteMany({ where: { vaultId: { in: vaultIds } } })).count;
      withdrawals = (await this.prisma.withdrawal.deleteMany({ where: { vaultId: { in: vaultIds } } })).count;
      epochs = (await this.prisma.epochCheckpoint.deleteMany({ where: { vaultId: { in: vaultIds } } })).count;
      traders = (await this.prisma.vaultTrader.deleteMany({ where: { vaultId: { in: vaultIds } } })).count;
    }
    if (botIds.length > 0) {
      await this.prisma.bot.deleteMany({ where: { id: { in: botIds } } });
    }
    if (vaultIds.length > 0) {
      await this.prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    }
    // Audit is append-only: business rows go, audit stays + one reset row.
    await this.audit.record({
      actor,
      action: 'demo.reset',
      target: 'demo:*',
      reason: `vaults=${vaultIds.length} bots=${botIds.length} orders=${orders} legs=${legs} deposits=${deposits} withdrawals=${withdrawals} epochs=${epochs} traders=${traders} (audit kept)`,
    });
    return {
      vaults: vaultIds.length,
      bots: botIds.length,
      orders,
      legs,
      deposits,
      withdrawals,
      epochs,
      traders,
      auditKept: true,
      environment: 'sandbox' as const,
    };
  }

  async performance(botId: number) {
    const bot = await this.prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) missing(`Bot ${botId} not found.`);
    const match = (tag: string): object => ({ quoteJson: { path: ['sized', 'triggeredBy'], equals: tag } });
    const [auto, demo] = await Promise.all([
      this.prisma.copyOrder.findMany({ where: match(`bot:${botId}`), select: { id: true, status: true, realizedPnlUsd: true, closedAt: true, symbol: true } }),
      this.prisma.copyOrder.findMany({ where: match(`demo:${botId}`), select: { id: true, status: true, realizedPnlUsd: true, closedAt: true, symbol: true } }),
    ]);
    const rows = [...auto, ...demo];
    const closed = rows.filter((r) => r.closedAt !== null);
    const realized = closed.map((r) => num(r.realizedPnlUsd));
    const wins = realized.filter((v) => v > 0).length;
    const losses = realized.filter((v) => v < 0).length;
    const totalRealized = Math.round(realized.reduce((s, v) => s + v, 0) * 100) / 100;
    const byTime = [...closed].sort((a, b) => (a.closedAt as Date).getTime() - (b.closedAt as Date).getTime());
    let cum = 0;
    const equity = byTime.map((r) => {
      cum = Math.round((cum + num(r.realizedPnlUsd)) * 100) / 100;
      return { t: (r.closedAt as Date).toISOString(), cum };
    });
    return {
      botId,
      botName: (bot as { name: string }).name,
      orders: rows.length,
      open: rows.filter((r) => r.closedAt === null).length,
      closed: closed.length,
      wins,
      losses,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : null,
      totalRealizedUsd: totalRealized,
      equity,
      environment: 'sandbox' as const,
    };
  }
}
