import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress } from '../../common/auth/solana-verify.js';
import { DataStreamService } from '../../common/market/datastream.service.js';

export interface VaultStatus {
  id: number;
  name: string;
  environment: string;
  feeBps: number;
  hwmSharePrice: number;
  totalShares: number;
  treasurySol: number;
  partnerAccruedSol: number;
  policy: { reserveBps: number; withdrawFeeBps: number; lockHours: number };
  window: WindowState | null;
  lastEpoch: {
    navSol: number;
    sharePrice: number;
    sharesOutstanding: number;
    feeSol: number;
    createdAt: string;
  } | null;
  queuedDeposits: number;
  queuedWithdrawals: number;
}

export interface SettleResult {
  epochId: number;
  navSol: number;
  sharePrice: number;
  sharesOutstanding: number;
  feeSol: number;
  partnerPayouts: { trader: string; amountSol: number }[];
  edgepoolSol: number;
  settledDeposits: { id: number; shares: number }[];
  settledWithdrawals: { id: number; payoutSol: number }[];
}

const num = (v: { toNumber(): number } | number | string | null | undefined): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return v?.toNumber() ?? 0;
};

const dec = (v: number): string => String(Math.round(v * 1e9) / 1e9);

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

function missing(message: string): never {
  throw new NotFoundException({ success: false, message });
}

/** Max active traders per vault (fund spec §5: 3–5). */
export const MAX_VAULT_TRADERS = 5;

/**
 * Report §4 (edgepool-core-logic-report.html): performance fee is 20% of new
 * profit above HWM, split as 80 depositors / 15 partner traders / 5 Edgepool.
 * Of the FEE itself that means 75% to partner traders, 25% to Edgepool.
 * Dust from pro-rata rounding goes to treasury so the split always conserves.
 */
export const PARTNER_FEE_SHARE = 0.75;

const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;
const f9 = (v: number): number => Math.floor(v * 1e9) / 1e9;

/** Latest NAV across epoch checkpoints (0 when the pool never settled). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastNav(epochs: { navSol: any }[]): number {
  const last = epochs[epochs.length - 1];
  return last ? num(last.navSol) : 0;
}

export interface WindowState {
  open: boolean;
  nextOpensAt: string;
  periodHours: number;
  lengthMin: number;
}

/**
 * Settlement window state anchored at vault creation (intent D-W1).
 * Returns null when windows are OFF (period or length is 0) = always open.
 * Pure function (exported for asserts).
 */
export function windowState(
  createdAt: Date,
  periodHours: number,
  lengthMin: number,
  now = Date.now(),
): WindowState | null {
  if (!Number.isFinite(periodHours) || periodHours <= 0) return null;
  if (!Number.isFinite(lengthMin) || lengthMin <= 0) return null;
  const period = periodHours * 3600 * 1000;
  const length = lengthMin * 60 * 1000;
  const elapsed = now - createdAt.getTime();
  const pos = ((elapsed % period) + period) % period;
  const cycleStart = createdAt.getTime() + (elapsed - pos);
  return {
    open: pos < length,
    nextOpensAt: new Date(cycleStart + period).toISOString(),
    periodHours,
    lengthMin,
  };
}

/**
 * Paper vault accounting (MoneyFi model, off-chain v1).
 * - PnL moves share price; deposits mint at settle price (no retro profit).
 * - Value per holder = shares × current price; withdrawals burn at settle price.
 * - No per-trade split — rights are reflected via shares.
 * - Performance fee (deck 80/15/5, `feeBps`) applies only to new profit above
 *   the previous high-water mark; default 0 = disabled (pure MoneyFi model).
 */
@Injectable()
export class VaultService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(DataStreamService) private readonly prices?: DataStreamService,
  ) {}

  async getOrCreateVault(name = 'paper'): Promise<{ id: number; feeBps: number }> {
    const existing = await this.prisma.vault.findFirst({ where: { name } });
    if (existing) return { id: existing.id, feeBps: existing.feeBps };
    const created = await this.prisma.vault.create({ data: { name } });
    return { id: created.id, feeBps: created.feeBps };
  }

  /** Default vault id 1 auto-creates the 'paper' vault (explicit ids must exist). */
  private async resolveVault(vaultId: number): Promise<{ id: number }> {
    const found = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (found) return { id: found.id };
    if (vaultId === 1) {
      const created = await this.getOrCreateVault('paper');
      return { id: created.id };
    }
    fail(`Vault ${vaultId} not found.`);
  }

  async deposit(
    vaultId: number,
    depositor: string,
    amountSol: number,
    userId?: number,
  ): Promise<{ id: number; status: string }> {
    if (!depositor?.trim()) fail('Depositor is required.');
    if (!Number.isFinite(amountSol) || amountSol <= 0) fail('amountSol must be positive.');
    // Pool app P2 (pool-math.ts): minimum 0.5 SOL per deposit.
    if (amountSol < 0.5) fail('Minimum deposit is 0.5 SOL.');
    const { id } = await this.resolveVault(vaultId);
    const vault = await this.prisma.vault.findUnique({ where: { id } });
    if (!vault) fail(`Vault ${id} not found.`);
    // Slots: a full pool blocks NEW depositors; existing holders add freely.
    const maxSlots = (vault.maxSlots as number | null) ?? 100;
    const holders = await this.prisma.deposit.findMany({
      where: { vaultId: id, status: 'SETTLED' },
      select: { depositor: true },
    });
    const isHolder = holders.some((h) => h.depositor === depositor.trim());
    const used = new Set(holders.map((h) => h.depositor)).size;
    if (!isHolder && used >= maxSlots) {
      fail(`Pool is full (${used}/${maxSlots} slots). Existing holders can still add.`);
    }
    const row = await this.prisma.deposit.create({
      data: {
        vaultId: id,
        depositor: depositor.trim(),
        userId: userId ?? null,
        amountSol: dec(amountSol),
        status: 'QUEUED',
      },
    });
    return { id: row.id, status: row.status };
  }

  async depositorShares(vaultId: number, depositor: string): Promise<number> {
    const [ins, outs] = await Promise.all([
      this.prisma.deposit.findMany({ where: { vaultId, depositor, status: 'SETTLED' } }),
      this.prisma.withdrawal.findMany({ where: { vaultId, depositor, status: 'SETTLED' } }),
    ]);
    const minted = ins.reduce((s, r) => s + num(r.sharesMinted), 0);
    const burned = outs.reduce((s, r) => s + num(r.sharesRequested), 0);
    return Math.max(0, Math.round((minted - burned) * 1e9) / 1e9);
  }

  async requestWithdraw(
    vaultId: number,
    depositor: string,
    shares: number,
    userId?: number,
  ): Promise<{ id: number; status: string }> {
    if (!depositor?.trim()) fail('Depositor is required.');
    if (!Number.isFinite(shares) || shares <= 0) fail('shares must be positive.');
    const { id: resolvedId } = await this.resolveVault(vaultId);
    const balance = await this.depositorShares(resolvedId, depositor.trim());
    if (shares - balance > 1e-9) {
      fail(`Insufficient shares: requested ${shares}, balance ${balance}.`);
    }
    const vault = await this.prisma.vault.findUnique({ where: { id: resolvedId } });
    if (!vault) fail(`Vault ${resolvedId} not found.`);
    // T2 lock: identity = depositor string OR linked userId (covers legacy + linked).
    const lockHours = vault.lockHours ?? 0;
    if (lockHours > 0) {
      const or: Record<string, unknown>[] = [{ depositor: depositor.trim() }];
      if (userId !== undefined) or.push({ userId });
      const latest = await this.prisma.deposit.findFirst({
        where: { vaultId: resolvedId, status: 'SETTLED', OR: or },
        orderBy: { settledAt: 'desc' },
      });
      const settledAt = latest?.settledAt ? new Date(latest.settledAt as unknown as string).getTime() : 0;
      const unlockAt = settledAt + lockHours * 3600 * 1000;
      if (settledAt > 0 && unlockAt > Date.now()) {
        fail(`Withdrawal locked until ${new Date(unlockAt).toISOString()} (lock ${lockHours}h).`);
      }
    }
    // T2 reserve: estimated payout must leave the reserve floor intact.
    // Needs a priced epoch; skipped on bootstrap (no epoch yet).
    const reserveBps = vault.reserveBps ?? 0;
    if (reserveBps > 0) {
      const last = await this.prisma.epochCheckpoint.findFirst({
        where: { vaultId: resolvedId },
        orderBy: { id: 'desc' },
      });
      if (last) {
        const nav = num(last.navSol);
        const price = num(last.sharePrice);
        const queued = await this.prisma.withdrawal.findMany({
          where: { vaultId: resolvedId, status: 'QUEUED' },
        });
        const queuedShares = queued.reduce((s, w) => s + num(w.sharesRequested), 0);
        const floor = (nav * (10000 - reserveBps)) / 10000;
        const afterNav = nav - (queuedShares + shares) * price;
        if (afterNav < floor - 1e-9) {
          fail(
            `Reserve floor: this withdrawal would leave ${Math.round(afterNav * 1e9) / 1e9} SOL ` +
              `below the ${(reserveBps / 100).toFixed(2)}% reserve (${Math.round(floor * 1e9) / 1e9} SOL).`,
          );
        }
      }
    }
    const row = await this.prisma.withdrawal.create({
      data: {
        vaultId: resolvedId,
        depositor: depositor.trim(),
        userId: userId ?? null,
        sharesRequested: dec(shares),
        status: 'QUEUED',
      },
    });
    return { id: row.id, status: row.status };
  }

  async settleEpoch(vaultId: number, navSol?: number): Promise<SettleResult> {
    const { id } = await this.resolveVault(vaultId);
    vaultId = id;
    // P1 NAV engine: omitted navSol = mark-to-market from open positions +
    // realized since last epoch. Explicit navSol keeps legacy/manual behavior.
    if (navSol === undefined || navSol === null) {
      navSol = await this.computeNav(vaultId);
    }
    if (!Number.isFinite(navSol) || (navSol as number) < 0) fail('navSol must be non-negative.');
    navSol = navSol as number;
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!vault) fail(`Vault ${vaultId} not found.`);
    // W gate: settle runs only inside an open window (requests still queue anytime).
    const win = windowState(
      new Date(vault.createdAt as unknown as string),
      (vault.settlePeriodHours as number | null) ?? 0,
      (vault.settleLengthMin as number | null) ?? 0,
    );
    if (win && !win.open) {
      fail(`Settlement window closed — next opens at ${win.nextOpensAt}. Requests stay queued.`);
    }
    const totalShares = num(vault.totalShares);
    const hwm = num(vault.hwmSharePrice);
    const [deposits, withdrawals] = await Promise.all([
      this.prisma.deposit.findMany({ where: { vaultId, status: 'QUEUED' }, orderBy: { id: 'asc' } }),
      this.prisma.withdrawal.findMany({ where: { vaultId, status: 'QUEUED' }, orderBy: { id: 'asc' } }),
    ]);
    // Price on NAV excluding pending deposits (their cash hasn't entered yet —
    // otherwise newcomers would inflate their own mint price).
    const pendingIn = deposits.reduce((s, d) => s + num(d.amountSol), 0);
    if (totalShares > 0 && navSol - pendingIn <= 0) {
      fail('NAV below pending deposits — cannot price this epoch.');
    }
    let nav = navSol;
    let price = totalShares > 0 ? Math.round(((nav - pendingIn) / totalShares) * 1e9) / 1e9 : 1;
    let feeSol = 0;
    if (vault.feeBps > 0 && totalShares > 0 && price > hwm) {
      feeSol = Math.round((price - hwm) * totalShares * (vault.feeBps / 10000) * 1e9) / 1e9;
      nav = Math.round((nav - feeSol) * 1e9) / 1e9;
      price = Math.round(((nav - pendingIn) / totalShares) * 1e9) / 1e9;
    }
    const newHwm = Math.max(hwm, price);
    let shares = totalShares;
    const settledDeposits: { id: number; shares: number }[] = [];
    for (const d of deposits) {
      // Re-check balance at settle time (deposits after a withdrawal request).
      const minted = Math.round((num(d.amountSol) / price) * 1e9) / 1e9;
      await this.prisma.deposit.update({
        where: { id: d.id },
        data: { status: 'SETTLED', sharesMinted: dec(minted), sharePrice: dec(price), settledAt: new Date() },
      });
      shares = Math.round((shares + minted) * 1e9) / 1e9;
      settledDeposits.push({ id: d.id, shares: minted });
    }
    const settledWithdrawals: { id: number; payoutSol: number }[] = [];
    const feeBps = vault.withdrawFeeBps ?? 0;
    let treasuryFee = 0;
    for (const w of withdrawals) {
      const want = num(w.sharesRequested);
      const held = await this.depositorShares(vaultId, w.depositor);
      const payoutShares = Math.min(want, held);
      const gross = Math.round(payoutShares * price * 1e9) / 1e9;
      const fee = feeBps > 0 ? Math.round(((gross * feeBps) / 10000) * 1e9) / 1e9 : 0;
      const payout = Math.round((gross - fee) * 1e9) / 1e9;
      treasuryFee = Math.round((treasuryFee + fee) * 1e9) / 1e9;
      await this.prisma.withdrawal.update({
        where: { id: w.id },
        data: { status: 'SETTLED', sharePrice: dec(price), payoutSol: dec(payout), settledAt: new Date() },
      });
      shares = Math.round((shares - payoutShares) * 1e9) / 1e9;
      settledWithdrawals.push({ id: w.id, payoutSol: payout });
    }
    await this.prisma.vault.update({
      where: { id: vaultId },
      data: {
        totalShares: dec(shares),
        hwmSharePrice: dec(newHwm),
        treasurySol: dec(Math.round((num(vault.treasurySol) + treasuryFee) * 1e9) / 1e9),
      },
    });
    const epoch = await this.prisma.epochCheckpoint.create({
      data: {
        vaultId,
        navSol: dec(nav),
        sharePrice: dec(price),
        sharesOutstanding: dec(shares),
        feeSol: dec(feeSol),
      },
    });
    // Report §4 split: book partner/edgepool shares AFTER the epoch exists so
    // payouts link to it. Runs only when a performance fee was taken.
    const split = feeSol > 0 ? await this.bookFeeSplit(vaultId, epoch.id, feeSol) : { payouts: [], edgepoolSol: 0 };
    if (split.edgepoolSol > 0) {
      const cur = await this.prisma.vault.findUnique({ where: { id: vaultId } });
      await this.prisma.vault.update({
        where: { id: vaultId },
        data: { treasurySol: dec(r9(num(cur?.treasurySol) + split.edgepoolSol)) },
      });
    }
    return {
      epochId: epoch.id,
      navSol: nav,
      sharePrice: price,
      sharesOutstanding: shares,
      feeSol,
      partnerPayouts: split.payouts,
      edgepoolSol: split.edgepoolSol,
      settledDeposits,
      settledWithdrawals,
    };
  }

  /**
   * Split a performance fee per report §4: 75% pro-rata to ACTIVE partner
   * traders (by weightBps) as ACCRUED PartnerPayout rows, 25% + rounding dust
   * to Edgepool (returned for treasury booking). No active/weighted traders →
   * the whole fee accrues to treasury. Conservation: payouts + edgepool == fee.
   */
  private async bookFeeSplit(
    vaultId: number,
    epochId: number,
    feeSol: number,
  ): Promise<{ payouts: { trader: string; amountSol: number }[]; edgepoolSol: number }> {
    const traders = await this.prisma.vaultTrader.findMany({ where: { vaultId, isActive: true } });
    const weighted = traders.filter((t) => ((t.weightBps as number | null) ?? 0) > 0);
    const totalWeight = weighted.reduce((s, t) => s + ((t.weightBps as number | null) ?? 0), 0);
    if (weighted.length === 0 || totalWeight <= 0) {
      return { payouts: [], edgepoolSol: r9(feeSol) };
    }
    const partnerPool = f9(feeSol * PARTNER_FEE_SHARE);
    const payouts: { trader: string; amountSol: number }[] = [];
    let assigned = 0;
    for (const t of weighted) {
      const amt = f9((partnerPool * (((t.weightBps as number | null) ?? 0))) / totalWeight);
      if (amt <= 0) continue;
      assigned = r9(assigned + amt);
      const row = await this.prisma.partnerPayout.create({
        data: {
          vaultId,
          epochId,
          trader: t.wallet,
          amountSol: dec(amt),
          kind: 'PERF_FEE',
          status: 'ACCRUED',
        },
      });
      payouts.push({ trader: (row.trader as string) ?? t.wallet, amountSol: amt });
    }
    return { payouts, edgepoolSol: r9(feeSol - assigned) };
  }

  /** Partner earnings ledger (report §4): totals + rows, optional trader filter. */
  async earnings(vaultId: number, trader?: string): Promise<{
    vaultId: number;
    totalSol: number;
    byTrader: Record<string, number>;
    payouts: { id: number; trader: string; amountSol: number; epochId: number | null; status: string; createdAt: string }[];
  }> {
    const { id } = await this.resolveVault(vaultId);
    vaultId = id;
    const clean = (trader ?? '').trim();
    const rows = await this.prisma.partnerPayout.findMany({
      where: clean ? { vaultId, trader: clean } : { vaultId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    const byTrader: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const amt = num(r.amountSol);
      total = r9(total + amt);
      byTrader[r.trader] = r9((byTrader[r.trader] ?? 0) + amt);
    }
    return {
      vaultId,
      totalSol: total,
      byTrader,
      payouts: rows.map((r) => ({
        id: r.id,
        trader: r.trader,
        amountSol: num(r.amountSol),
        epochId: (r.epochId as number | null) ?? null,
        status: r.status,
        createdAt: (r.createdAt as Date).toISOString(),
      })),
    };
  }

  /**
   * Pool app P1 — NAV engine. NAV = last settled NAV
   * + unrealized of open pool orders (mark-to-market via DataStream)
   * + realized gains closed since the last epoch.
   * Orders without vaultId (legacy) are pool-agnostic and excluded.
   */
  async computeNav(vaultId: number): Promise<number> {
    const { id } = await this.resolveVault(vaultId);
    vaultId = id;
    const [last, opens] = await Promise.all([
      this.prisma.epochCheckpoint.findFirst({ where: { vaultId }, orderBy: { id: 'desc' } }),
      this.prisma.copyOrder.findMany({ where: { vaultId, closedAt: null } }),
    ]);
    const base = last ? num(last.navSol) : 0;
    const since = last ? new Date(last.createdAt as unknown as string) : new Date(0);
    const closed = await this.prisma.copyOrder.findMany({
      where: { vaultId, closedAt: { not: null } },
    });
    const realized = closed
      .filter((o) => new Date(o.closedAt as unknown as string) >= since)
      .reduce((s, o) => s + num(o.realizedPnlUsd), 0);
    // Mark-to-market only BUY positions with known entry + mint.
    const pricable = opens.filter(
      (o) => (o.action ?? 'BUY') === 'BUY' && o.tokenMint && num(o.entryPriceUsd) > 0 && num(o.amountUsd) > 0,
    );
    let unrealized = 0;
    if (pricable.length > 0) {
      let px: Record<string, number> = {};
      try {
        px = this.prices ? await this.prices.bulkPrices([...new Set(pricable.map((o) => o.tokenMint as string))]) : {};
      } catch {
        px = {};
      }
      for (const o of pricable) {
        const live = px[o.tokenMint as string];
        if (!Number.isFinite(live)) continue;
        const qty = num(o.amountUsd) / num(o.entryPriceUsd);
        unrealized += qty * live - num(o.amountUsd);
      }
    }
    return r9(Math.max(0, base + unrealized + realized));
  }

  /**
   * Pool app P2 — pool detail (Calm). Base row (pools) + NAV series + open
   * positions (MTM) + signal pipeline + execution log + exposure + myHolding
   * + masked flag (<0.5 SOL hides tokens/traders/sizes per pool-math.ts).
   */
  async poolDetail(vaultId: number, user?: { id: number; wallet: string }): Promise<Record<string, unknown>> {
    const { id } = await this.resolveVault(vaultId);
    vaultId = id;
    const base = ((await this.pools(user)) as Record<string, unknown>[]).find((p) => p.id === vaultId);
    if (!base) fail(`Vault ${vaultId} not found.`);
    const [epochs, orders] = await Promise.all([
      this.prisma.epochCheckpoint.findMany({ where: { vaultId }, orderBy: { id: 'asc' } }),
      this.prisma.copyOrder.findMany({ where: { vaultId }, orderBy: { id: 'desc' }, take: 100 }),
    ]);
    const nav = lastNav(epochs);
    const mints = [...new Set(orders.filter((o) => o.tokenMint).map((o) => o.tokenMint as string))];
    let px: Record<string, number> = {};
    try {
      px = this.prices && mints.length > 0 ? await this.prices.bulkPrices(mints) : {};
    } catch {
      px = {};
    }
    const liveOf = (o: { tokenMint: unknown; entryPriceUsd: unknown }): number | null => {
      const p = o.tokenMint ? px[o.tokenMint as string] : undefined;
      return typeof p === 'number' && p > 0 ? p : null;
    };
    const positions = orders
      .filter((o) => !o.closedAt && o.status === 'CONFIRMED')
      .map((o) => {
        const entry = num(o.entryPriceUsd);
        const live = liveOf(o);
        const qty = entry > 0 ? num(o.amountUsd) / entry : 0;
        const unreal = live !== null && entry > 0 ? r9(qty * live - num(o.amountUsd)) : null;
        return {
          token: o.symbol ?? o.tokenMint?.slice(0, 8) ?? '—',
          trader: o.masterHandle ?? o.masterWallet?.slice(0, 8) ?? '—',
          sizeSol: null,
          unrealizedPct: unreal !== null && num(o.amountUsd) > 0 ? r9((unreal / num(o.amountUsd)) * 100) : null,
          stage: o.closeReason ?? 'OPEN',
          entryPriceUsd: entry > 0 ? entry : null,
          livePriceUsd: live,
        };
      });
    const stepsOf = (o: { status: string; quoteJson: unknown; legs?: unknown }): { label: string; state: string }[] => {
      const q = (o.quoteJson ?? {}) as Record<string, unknown>;
      const has = (k: string): boolean => !!q[k];
      const legs = ((o as { legs?: { leg: string }[] }).legs ?? []).map((l) => l.leg);
      const done = (c: boolean): string => (c ? 'done' : 'waiting');
      const steps = [
        { label: 'Detect', state: 'done' as string },
        { label: 'Qualify', state: o.status === 'FAILED' && !has('qualify') ? 'skipped' : done(o.status !== 'PENDING') },
        { label: 'Enter 50%', state: done(['QUATED', 'SENT', 'CONFIRMED'].includes(o.status)) },
        { label: 'Limit −10%', state: done(o.status === 'CONFIRMED') },
      ];
      if (o.status === 'FAILED') steps.push({ label: 'Skipped', state: 'skipped' });
      if (legs.includes('TP1')) steps.push({ label: 'TP', state: 'tp' });
      if (legs.includes('STOP')) steps.push({ label: 'Stop', state: 'stopped' });
      return steps;
    };
    const withLegs = await this.prisma.copyOrderLeg.findMany({
      where: { orderId: { in: orders.slice(0, 20).map((o) => o.id) } },
    });
    const signals = orders.slice(0, 20).map((o) => ({
      token: o.symbol ?? o.tokenMint?.slice(0, 8) ?? '—',
      trader: o.masterHandle ?? o.masterWallet?.slice(0, 8) ?? '—',
      ageSec: Math.max(0, Math.floor((Date.now() - new Date(o.createdAt as unknown as string).getTime()) / 1000)),
      note: (o.error as string | null) ?? '',
      steps: stepsOf({ status: o.status, quoteJson: o.quoteJson, legs: withLegs.filter((l) => l.orderId === o.id) }),
    }));
    const log = orders
      .filter((o) => o.closedAt || o.status === 'FAILED')
      .slice(0, 20)
      .map((o) => ({
        at: new Date((o.closedAt ?? o.createdAt) as unknown as string).toISOString(),
        token: o.symbol ?? o.tokenMint?.slice(0, 8) ?? '—',
        trader: o.masterHandle ?? o.masterWallet?.slice(0, 8) ?? '—',
        event: o.status === 'FAILED' ? 'skip' : 'exit',
        detail: ((o.closeReason as string | null) ?? o.error ?? '') as string,
        kind: o.status === 'FAILED' ? 'skip' : 'exit',
      }));
    const exp = new Map<string, number>();
    for (const o of orders.filter((o) => !o.closedAt && o.status === 'CONFIRMED')) {
      const k = (o.masterWallet as string) ?? '—';
      exp.set(k, (exp.get(k) ?? 0) + num(o.amountUsd));
    }
    // USD→SOL approx via wSOL price for %NAV exposure.
    let solPx = 0;
    try {
      const w = 'So11111111111111111111111111111111111111112';
      solPx = this.prices ? ((await this.prices.bulkPrices([w]))[w] ?? 0) : 0;
    } catch {
      solPx = 0;
    }
    const exposure = [...exp.entries()].map(([trader, usd]) => ({
      trader,
      pctNav: nav > 0 && solPx > 0 ? r9(((usd / solPx) / nav) * 100) : 0,
      pnlSol: 0,
    }));
    const holding = user ? await this.mine(vaultId, user) : null;
    const masked = !holding || holding.valueSol < 0.5;
    return {
      ...base,
      navSeries: epochs.map((e) => ({ t: new Date(e.createdAt as unknown as string).getTime(), v: num(e.sharePrice) })),
      openPositions: positions,
      openCount: positions.length,
      signals,
      log,
      exposure,
      myHolding: holding,
      masked,
    };
  }

  async status(vaultId: number): Promise<VaultStatus> {
    const { id } = await this.resolveVault(vaultId);
    vaultId = id;
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!vault) fail(`Vault ${vaultId} not found.`);
    const [last, qd, qw] = await Promise.all([
      this.prisma.epochCheckpoint.findFirst({ where: { vaultId }, orderBy: { id: 'desc' } }),
      this.prisma.deposit.count({ where: { vaultId, status: 'QUEUED' } }),
      this.prisma.withdrawal.count({ where: { vaultId, status: 'QUEUED' } }),
    ]);
    const accrued = await this.prisma.partnerPayout.aggregate({
      where: { vaultId },
      _sum: { amountSol: true },
    });
    return {
      id: vault.id,
      name: vault.name,
      environment: (vault.environment ?? 'SANDBOX').toLowerCase(),
      feeBps: vault.feeBps,
      hwmSharePrice: num(vault.hwmSharePrice),
      totalShares: num(vault.totalShares),
      treasurySol: num(vault.treasurySol),
      partnerAccruedSol: num(((accrued._sum ?? {}) as { amountSol?: number | string | null }).amountSol ?? null),
      policy: {
        reserveBps: vault.reserveBps ?? 0,
        withdrawFeeBps: vault.withdrawFeeBps ?? 0,
        lockHours: vault.lockHours ?? 0,
      },
      window: windowState(
        new Date(vault.createdAt as unknown as string),
        (vault.settlePeriodHours as number | null) ?? 0,
        (vault.settleLengthMin as number | null) ?? 0,
      ),
      lastEpoch: last
        ? {
            navSol: num(last.navSol),
            sharePrice: num(last.sharePrice),
            sharesOutstanding: num(last.sharesOutstanding),
            feeSol: num(last.feeSol),
            createdAt: last.createdAt.toISOString(),
          }
        : null,
      queuedDeposits: qd,
      queuedWithdrawals: qw,
    };
  }

  /**
   * Investor view (Investor Mode): *my* position in a vault — shares held,
   * current value, settled totals and queued requests — matched by session
   * identity (userId, plus depositor string equal to the session wallet for
   * legacy rows created before auth existed). Read-only.
   */
  async mine(vaultId: number, user: { id: number; wallet: string }): Promise<{
    vaultId: number;
    vaultName: string;
    sharePrice: number;
    shares: number;
    valueSol: number;
    depositedSol: number;
    withdrawnSol: number;
    returnsSol: number;
    queuedDeposits: { id: number; amountSol: number; createdAt: string }[];
    queuedWithdrawals: { id: number; shares: number; createdAt: string }[];
  }> {
    const { id } = await this.resolveVault(vaultId);
    vaultId = id;
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!vault) fail(`Vault ${vaultId} not found.`);
    const mine = { vaultId, OR: [{ userId: user.id }, { depositor: user.wallet }] };
    const [deposits, withdrawals, last] = await Promise.all([
      this.prisma.deposit.findMany({ where: mine, orderBy: { id: 'asc' } }),
      this.prisma.withdrawal.findMany({ where: mine, orderBy: { id: 'asc' } }),
      this.prisma.epochCheckpoint.findFirst({ where: { vaultId }, orderBy: { id: 'desc' } }),
    ]);
    const price = last ? num(last.sharePrice) : 1;
    let minted = 0;
    let deposited = 0;
    const qd: { id: number; amountSol: number; createdAt: string }[] = [];
    for (const d of deposits) {
      if (d.status === 'SETTLED') {
        minted = r9(minted + num(d.sharesMinted));
        deposited = r9(deposited + num(d.amountSol));
      } else if (d.status === 'QUEUED') {
        qd.push({ id: d.id, amountSol: num(d.amountSol), createdAt: (d.createdAt as Date).toISOString() });
      }
    }
    let burned = 0;
    let withdrawn = 0;
    const qw: { id: number; shares: number; createdAt: string }[] = [];
    for (const w of withdrawals) {
      if (w.status === 'SETTLED') {
        burned = r9(burned + num(w.sharesRequested));
        withdrawn = r9(withdrawn + num(w.payoutSol));
      } else if (w.status === 'QUEUED') {
        qw.push({ id: w.id, shares: num(w.sharesRequested), createdAt: (w.createdAt as Date).toISOString() });
      }
    }
    const shares = Math.max(0, r9(minted - burned));
    const value = r9(shares * price);
    return {
      vaultId,
      vaultName: vault.name,
      sharePrice: price,
      shares,
      valueSol: value,
      depositedSol: deposited,
      withdrawnSol: withdrawn,
      returnsSol: r9(value + withdrawn - deposited),
      queuedDeposits: qd,
      queuedWithdrawals: qw,
    };
  }

  // ---- Multi-vault + trader sets (fund-roles-auth P3, ADMIN-gated in controller) ----

  async listVaults(): Promise<unknown[]> {
    const vaults = await this.prisma.vault.findMany({ orderBy: { id: 'asc' } });
    const traders = await this.prisma.vaultTrader.findMany({
      where: { vaultId: { in: vaults.map((v) => v.id) } },
      orderBy: { id: 'asc' },
    });
    return vaults.map((v) => ({
      id: v.id,
      name: v.name,
      environment: (v.environment ?? 'SANDBOX').toLowerCase(),
      feeBps: v.feeBps,
      totalShares: num(v.totalShares),
      traders: traders.filter((t) => t.vaultId === v.id),
    }));
  }

  /**
   * Pool app P1 — pools index (design: pools > detail > partner).
   * One pool = one vault + its bot scope + trader basket. Enriches each vault
   * with kind/status/listing, slots, NAV/sharePrice/HWM, per-period PnL (from
   * epoch checkpoints), trader basket (handle + rank), and optional myHolding.
   */
  async pools(user?: { id: number; wallet: string }): Promise<unknown[]> {
    const vaults = await this.prisma.vault.findMany({ orderBy: { id: 'asc' } });
    const traders = await this.prisma.vaultTrader.findMany({
      where: { vaultId: { in: vaults.map((v) => v.id) }, isActive: true },
      orderBy: { id: 'asc' },
    });
    const [tracked, epochs, deposits] = await Promise.all([
      this.prisma.trackedWallet.findMany({
        where: { address: { in: [...new Set(traders.map((t) => t.wallet))] } },
      }),
      this.prisma.epochCheckpoint.findMany({
        where: { vaultId: { in: vaults.map((v) => v.id) } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.deposit.findMany({
        where: { vaultId: { in: vaults.map((v) => v.id) }, status: 'SETTLED' },
      }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>(tracked.map((t) => [t.address, t]));
    const out: unknown[] = [];
    for (const v of vaults) {
      const eps = epochs.filter((e) => e.vaultId === v.id);
      const last = eps[eps.length - 1];
      const pnl: Record<string, { sol: number; pct: number }> = {};
      for (const [key, days] of [['day', 1], ['week', 7], ['month', 30], ['all', 36500]] as const) {
        const cut = Date.now() - days * 86400000;
        // Value at window start = last checkpoint before the cutoff
        // (fallback: oldest checkpoint when the pool is younger than the window).
        const base = [...eps].reverse().find((e) => new Date(e.createdAt as unknown as string).getTime() < cut) ?? eps[0];
        const navNow = last ? num(last.navSol) : 0;
        const navBase = base ? num(base.navSol) : navNow;
        const sol = r9(navNow - navBase);
        pnl[key] = { sol, pct: navBase > 0 ? r9((sol / navBase) * 100) : 0 };
      }
      const used = new Set(deposits.filter((d) => d.vaultId === v.id).map((d) => d.depositor)).size;
      const basket = traders
        .filter((t) => t.vaultId === v.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t) => ({ wallet: t.wallet, handle: (byId.get(t.wallet)?.handle as string) ?? t.wallet.slice(0, 6), rank: (byId.get(t.wallet)?.fomoRank as number | null) ?? null }));
      const row: Record<string, unknown> = {
        id: v.id,
        name: v.name,
        kind: (v.kind as string) ?? 'basket',
        status: (v.status as string) ?? 'live',
        listing: (v.listing as string) ?? 'public',
        navSol: last ? num(last.navSol) : 0,
        navPerShare: last ? num(last.sharePrice) : 1,
        hwmNavPerShare: num(v.hwmSharePrice),
        totalShares: num(v.totalShares),
        slots: { used, max: (v.maxSlots as number) ?? 100 },
        maxTraders: (v.maxTraders as number) ?? 5,
        traders: basket,
        pnl,
      };
      if (user) {
        const m = await this.mine(v.id, user);
        row.myHolding = { shares: m.shares, valueSol: m.valueSol, returnsSol: m.returnsSol };
      }
      out.push(row);
    }
    return out;
  }

  async createVault(name: string, environment = 'SANDBOX'): Promise<unknown> {
    const clean = (name ?? '').trim();
    if (clean.length < 2) fail('Vault name is required.');
    const env = (environment ?? 'SANDBOX').toUpperCase();
    // Production custody/settlement is not implemented — refuse explicitly (D7).
    if (env !== 'SANDBOX') fail(`Vault environment '${env}' is not enabled. Only SANDBOX exists.`);
    try {
      const created = await this.prisma.vault.create({ data: { name: clean, environment: 'SANDBOX' } });
      return { ...created, environment: 'sandbox', traders: [] };
    } catch {
      fail(`Vault name already exists: ${clean}.`);
    }
  }

  async assignTrader(vaultId: number, wallet: string, weightBps = 0): Promise<unknown> {
    const clean = (wallet ?? '').trim();
    try {
      decodeWalletAddress(clean);
    } catch {
      fail(`Invalid Solana wallet address: ${wallet}`);
    }
    if (!Number.isInteger(weightBps) || weightBps < 0 || weightBps > 10000) {
      fail('weightBps must be an integer 0..10000.');
    }
    const { id } = await this.resolveVault(vaultId);
    const existing = await this.prisma.vaultTrader.findUnique({
      where: { vaultId_wallet: { vaultId: id, wallet: clean } },
    });
    const activating = !existing || !existing.isActive;
    if (activating) {
      const activeCount = await this.prisma.vaultTrader.count({ where: { vaultId: id, isActive: true } });
      const othersActive = existing ? activeCount - 1 : activeCount;
      if (othersActive >= MAX_VAULT_TRADERS) {
        fail(`Vault ${id} already tracks ${MAX_VAULT_TRADERS} active traders (cap).`);
      }
    }
    if (existing) {
      return this.prisma.vaultTrader.update({
        where: { id: existing.id },
        data: { weightBps, isActive: true },
      });
    }
    return this.prisma.vaultTrader.create({ data: { vaultId: id, wallet: clean, weightBps, isActive: true } });
  }

  async removeTrader(vaultId: number, wallet: string): Promise<unknown> {
    const { id } = await this.resolveVault(vaultId);
    const existing = await this.prisma.vaultTrader.findUnique({
      where: { vaultId_wallet: { vaultId: id, wallet: (wallet ?? '').trim() } },
    });
    if (!existing) missing(`Trader ${(wallet ?? '').trim()} is not tracked by vault ${id}.`);
    // Soft-remove (keep history); re-assign reactivates subject to the cap.
    return this.prisma.vaultTrader.update({ where: { id: existing.id }, data: { isActive: false } });
  }

  // ---- Treasury policy (T2, ADMIN-gated in controller) ----

  async setPolicy(
    vaultId: number,
    patch: { reserveBps?: number; withdrawFeeBps?: number; lockHours?: number; settlePeriodHours?: number; settleLengthMin?: number; feeBps?: number },
  ): Promise<{ id: number; policy: { reserveBps: number; withdrawFeeBps: number; lockHours: number; settlePeriodHours: number; settleLengthMin: number; feeBps: number } }> {
    const { id } = await this.resolveVault(vaultId);
    const current = await this.prisma.vault.findUnique({ where: { id } });
    if (!current) fail(`Vault ${id} not found.`);
    const data: Record<string, number> = {};
    if (patch.feeBps !== undefined) {
      if (!Number.isInteger(patch.feeBps) || patch.feeBps < 0 || patch.feeBps > 10000) {
        fail('feeBps must be an integer 0..10000.');
      }
      data.feeBps = patch.feeBps;
    }
    if (patch.reserveBps !== undefined) {
      if (!Number.isInteger(patch.reserveBps) || patch.reserveBps < 0 || patch.reserveBps > 10000) {
        fail('reserveBps must be an integer 0..10000.');
      }
      data.reserveBps = patch.reserveBps;
    }
    if (patch.withdrawFeeBps !== undefined) {
      if (!Number.isInteger(patch.withdrawFeeBps) || patch.withdrawFeeBps < 0 || patch.withdrawFeeBps > 10000) {
        fail('withdrawFeeBps must be an integer 0..10000.');
      }
      data.withdrawFeeBps = patch.withdrawFeeBps;
    }
    if (patch.lockHours !== undefined) {
      if (!Number.isInteger(patch.lockHours) || patch.lockHours < 0 || patch.lockHours > 8760) {
        fail('lockHours must be an integer 0..8760.');
      }
      data.lockHours = patch.lockHours;
    }
    if (patch.settlePeriodHours !== undefined) {
      if (!Number.isInteger(patch.settlePeriodHours) || patch.settlePeriodHours < 0 || patch.settlePeriodHours > 8760) {
        fail('settlePeriodHours must be an integer 0..8760.');
      }
      data.settlePeriodHours = patch.settlePeriodHours;
    }
    if (patch.settleLengthMin !== undefined) {
      if (!Number.isInteger(patch.settleLengthMin) || patch.settleLengthMin < 0 || patch.settleLengthMin > 1440) {
        fail('settleLengthMin must be an integer 0..1440.');
      }
      data.settleLengthMin = patch.settleLengthMin;
    }
    if (Object.keys(data).length === 0) fail('Nothing to update: provide feeBps, reserveBps, withdrawFeeBps, lockHours, settlePeriodHours or settleLengthMin.');
    const period = data.settlePeriodHours ?? (current.settlePeriodHours as number | null) ?? 0;
    const length = data.settleLengthMin ?? (current.settleLengthMin as number | null) ?? 0;
    if (length > 0 && period <= 0) fail('settleLengthMin requires settlePeriodHours > 0.');
    if (period > 0 && length <= 0) fail('settlePeriodHours requires settleLengthMin > 0.');
    const updated = await this.prisma.vault.update({ where: { id }, data });
    return {
      id: updated.id,
      policy: {
        feeBps: updated.feeBps as number,
        reserveBps: updated.reserveBps as number,
        withdrawFeeBps: updated.withdrawFeeBps as number,
        lockHours: updated.lockHours as number,
        settlePeriodHours: updated.settlePeriodHours as number,
        settleLengthMin: updated.settleLengthMin as number,
      },
    };
  }
}
