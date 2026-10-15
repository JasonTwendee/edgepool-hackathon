import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress } from '../../common/auth/solana-verify.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { isHaltedVault } from '../copy-trade/kill-switch.js';

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

/** Basket pools split the 20% fee 10/10 → partner share of the FEE is 50%. */
export const BASKET_FEE_SHARE = 0.5;

const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;

/**
 * Actual burned shares of a withdrawal row. Settle clamps over-requests to
 * the holder's balance (partial/zero payout), so counting sharesRequested
 * phantom-burns shares that never left the vault. payout/price is exact
 * (withdrawFeeBps is 0 on every vault); legacy rows without a settle price
 * fall back to sharesRequested.
 */
const burnedOf = (w: { status: unknown; sharesRequested: unknown; payoutSol: unknown; sharePrice: unknown }): number => {
  if (w.status !== 'SETTLED') return 0;
  const price = num(w.sharePrice as never);
  if (price > 0) return r9(num(w.payoutSol as never) / price);
  return num(w.sharesRequested as never);
};
const f9 = (v: number): number => Math.floor(v * 1e9) / 1e9;

/** Latest NAV across epoch checkpoints (0 when the pool never settled). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastNav(epochs: { navSol: any }[]): number {
  const last = epochs[epochs.length - 1];
  return last ? num(last.navSol) : 0;
}

/** One-line human status under a live signal (design: "Entered 50% · limit filled"). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function signalDetail(o: any, legs: { leg: string }[]): string {
  if (o.status === 'FAILED') return '';
  if (o.closedAt) return `Closed · ${(o.closeReason as string) ?? ''}`.trim();
  const names = legs.map((l) => l.leg);
  if (names.includes('TP2')) return 'TP2 hit · runner armed';
  if (names.includes('TP1')) return 'TP1 hit · managing runner';
  if (names.includes('TRAIL')) return 'Trailing · runner armed';
  if (names.includes('STOP')) return 'Stopped out';
  if (names.includes('TIME')) return 'Time stop · scratched';
  const stop = Math.abs(num(o.stopPct)) || 30;
  return `Open · stop at −${stop}%`;
}

/**
 * Paywall (pool-math.ts): holding < 0.5 SOL sees $•••• / Trader • / •••.
 * Percent PnL stays visible. Applied server-side so curl can't bypass the UI.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function maskPoolDetail(masked: boolean, positions: any[], signals: any[], log: any[], exposure: any[], advanced: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clean = (positions as any[]).map(({ notionalUsd, ...p }) => p);
  if (!masked) return { positions: clean, signals, log, exposure, advanced };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    positions: clean.map((p: any) => ({ ...p, token: '$••••', trader: 'Trader •', sizeSol: null, entryPriceUsd: null, livePriceUsd: null })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signals: (signals as any[]).map((s: any) => ({ ...s, token: '$••••', trader: 'Trader •' })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    log: (log as any[]).map((l: any) => ({ ...l, token: '$••••', trader: 'Trader •' })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exposure: (exposure as any[]).map((e: any) => ({ ...e, trader: 'Trader •' })),
    advanced: advanced
      ? {
          ...advanced,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ladder: ((advanced as any).ladder as any[]).map((l: any) => ({
            ...l, token: '$••••', trader: 'Trader •', entry: null, live: null, sizeSol: null,
          })),
        }
      : advanced,
  };
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
    userOrDepositor: { id: number; wallet: string } | string,
    amountSol: number,
    userIdOrDisplay?: number | string,
  ): Promise<{ id: number; status: string }> {
    // Fix #4: session identity is authoritative. Controllers pass the authed
    // user object; the client `depositor` string is display-only and ignored.
    // String overload stays for asserts/legacy tests only (never exposed via
    // the guarded controller path).
    let depositor: string;
    let userId: number | undefined;
    if (typeof userOrDepositor === 'string') {
      depositor = userOrDepositor;
      userId = typeof userIdOrDisplay === 'number' ? userIdOrDisplay : undefined;
    } else {
      if (!userOrDepositor || !Number.isFinite(userOrDepositor.id) || !userOrDepositor.wallet?.trim()) {
        fail('Authentication required.');
      }
      depositor = userOrDepositor.wallet.trim();
      userId = userOrDepositor.id;
    }
    if (!depositor?.trim()) fail('Depositor is required.');
    if (!Number.isFinite(amountSol) || amountSol <= 0) fail('amountSol must be positive.');
    // Pool app P2 (pool-math.ts): minimum 0.5 SOL per deposit.
    if (amountSol < 0.5) fail('Minimum deposit is 0.5 SOL.');
    const { id } = await this.resolveVault(vaultId);
    const vault = await this.prisma.vault.findUnique({ where: { id } });
    if (!vault) fail(`Vault ${id} not found.`);
    // Kill-switch: deposits into a halted vault are refused (withdrawals
    // still work — exits are never blocked).
    {
      const veps = await this.prisma.epochCheckpoint.findMany({ where: { vaultId: id }, orderBy: { id: 'asc' } });
      const halt = isHaltedVault(
        (vault as { status?: unknown }).status,
        (vault as { rulesJson?: unknown }).rulesJson,
        veps as unknown as { navSol: unknown; createdAt: unknown }[],
      );
      if (halt.halted) {
        fail(`Kill-switch: pool ${id} halted (day ${halt.dayPct}% / week ${halt.weekPct}%). Deposits blocked until recovery.`);
      }
    }
    // Slots: a full pool blocks NEW depositors; existing holders add freely.
    // Identity-aware: holder = same userId OR same depositor string (legacy).
    const maxSlots = (vault.maxSlots as number | null) ?? 100;
    const holders = (await this.prisma.deposit.findMany({
      where: { vaultId: id, status: 'SETTLED' },
      select: { depositor: true, userId: true } as never,
    }) as unknown as { depositor: string; userId: number | null }[]);
    const isHolder = holders.some(
      (h) => h.depositor === depositor.trim() || (userId !== undefined && h.userId === userId),
    );
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
    const burned = outs.reduce((s, r) => s + burnedOf(r), 0);
    return Math.max(0, Math.round((minted - burned) * 1e9) / 1e9);
  }

  /** Session-scoped balance: userId OR legacy depositor==wallet rows. */
  async depositorSharesByUser(vaultId: number, user: { id: number; wallet: string }): Promise<number> {
    const where = { vaultId, status: 'SETTLED', OR: [{ userId: user.id }, { depositor: user.wallet }] };
    const [ins, outs] = await Promise.all([
      this.prisma.deposit.findMany({ where }),
      this.prisma.withdrawal.findMany({ where }),
    ]);
    const minted = ins.reduce((s, r) => s + num(r.sharesMinted), 0);
    const burned = outs.reduce((s, r) => s + burnedOf(r), 0);
    return Math.max(0, Math.round((minted - burned) * 1e9) / 1e9);
  }

  async requestWithdraw(
    vaultId: number,
    userOrDepositor: { id: number; wallet: string } | string,
    shares: number,
    userIdOrDisplay?: number | string,
  ): Promise<{ id: number; status: string }> {
    let depositor: string;
    let userId: number | undefined;
    if (typeof userOrDepositor === 'string') {
      depositor = userOrDepositor;
      userId = typeof userIdOrDisplay === 'number' ? userIdOrDisplay : undefined;
    } else {
      if (!userOrDepositor || !Number.isFinite(userOrDepositor.id) || !userOrDepositor.wallet?.trim()) {
        fail('Authentication required.');
      }
      depositor = userOrDepositor.wallet.trim();
      userId = userOrDepositor.id;
    }
    if (!depositor?.trim()) fail('Depositor is required.');
    if (!Number.isFinite(shares) || shares <= 0) fail('shares must be positive.');
    const { id: resolvedId } = await this.resolveVault(vaultId);
    const balance =
      typeof userOrDepositor === 'string'
        ? await this.depositorShares(resolvedId, depositor.trim())
        : await this.depositorSharesByUser(resolvedId, userOrDepositor);
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
    // realized since last epoch. Explicit navSol keeps legacy/manual behavior
    // (ADMIN-only + audited at the controller layer).
    // NOTE: pricing inputs are resolved OUTSIDE the DB transaction so the
    // advisory lock is never held across network (price) calls.
    const autoNav = navSol === undefined || navSol === null;
    if (autoNav) {
      navSol = await this.computeNav(vaultId);
    }
    if (!Number.isFinite(navSol) || (navSol as number) < 0) fail('navSol must be non-negative.');
    const inputNav = navSol as number;
    // Atomic settlement (fix #2+#3): every ledger write runs inside a single
    // interactive transaction guarded by a per-vault pg advisory xact lock.
    // Crash mid-settle → rollback → retry safe; concurrent settles serialize
    // on the lock (no double-mint/double-burn); retry on the same NAV takes
    // fee 0 via the HWM ratchet (idempotent retry without extra columns).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = async (tx: Record<string, any>): Promise<SettleResult> => {
      if (typeof tx.$queryRaw === 'function') {
        try {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'vault-settle-' + vaultId}))`;
        } catch {
          // Mock clients in asserts have no pg — lock is a no-op there.
        }
      }
      const vault = await tx.vault.findUnique({ where: { id: vaultId } });
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
        tx.deposit.findMany({ where: { vaultId, status: 'QUEUED' }, orderBy: { id: 'asc' } }),
        tx.withdrawal.findMany({ where: { vaultId, status: 'QUEUED' }, orderBy: { id: 'asc' } }),
      ]);
      // Price on NAV excluding pending deposits (their cash hasn't entered yet —
      // otherwise newcomers would inflate their own mint price).
      const pendingIn = deposits.reduce((s: number, d: { amountSol: unknown }) => s + num(d.amountSol as never), 0);
      let nav = inputNav;
      if (autoNav) {
        // computeNav tracks trading equity only (queued cash excluded), while
        // the formula below assumes total equity (an explicit navSol carries
        // the caller's total, cash included). Price the settling cash in, or
        // every deposit dilutes existing holders and vault cash leaks from NAV.
        nav = Math.round((nav + pendingIn) * 1e9) / 1e9;
      }
      if (totalShares > 0 && nav - pendingIn <= 0) {
        fail('NAV below pending deposits — cannot price this epoch.');
      }
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
        await tx.deposit.update({
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
        // Linked identity (same scope as request-time depositorSharesByUser):
        // the session userId OR the depositor string. A withdrawal requested
        // with a connected wallet settles against the exact balance it was
        // approved against — never a silent 0 payout on identity mismatch.
        const scope = (w.userId as number | null | undefined) != null
          ? { OR: [{ userId: w.userId }, { depositor: w.depositor }] }
          : { depositor: w.depositor };
        // Balance inside the tx (same snapshot as the mint loop above).
        const [ins, outs] = await Promise.all([
          tx.deposit.findMany({ where: { vaultId, status: 'SETTLED', ...scope } }),
          tx.withdrawal.findMany({ where: { vaultId, status: 'SETTLED', ...scope } }),
        ]);
        const mintedIn = ins.reduce((s: number, r: { sharesMinted: unknown }) => s + num(r.sharesMinted as never), 0);
        const burnedOut = outs.reduce((s: number, r: { sharesRequested: unknown; payoutSol: unknown; sharePrice: unknown; status: unknown }) => s + burnedOf(r as never), 0);
        const held = Math.max(0, Math.round((mintedIn - burnedOut) * 1e9) / 1e9);
        const payoutShares = Math.min(want, held);
        const gross = Math.round(payoutShares * price * 1e9) / 1e9;
        const fee = feeBps > 0 ? Math.round(((gross * feeBps) / 10000) * 1e9) / 1e9 : 0;
        const payout = Math.round((gross - fee) * 1e9) / 1e9;
        treasuryFee = Math.round((treasuryFee + fee) * 1e9) / 1e9;
        await tx.withdrawal.update({
          where: { id: w.id },
          data: { status: 'SETTLED', sharePrice: dec(price), payoutSol: dec(payout), settledAt: new Date() },
        });
        shares = Math.round((shares - payoutShares) * 1e9) / 1e9;
        settledWithdrawals.push({ id: w.id, payoutSol: payout });
      }
      await tx.vault.update({
        where: { id: vaultId },
        data: {
          totalShares: dec(shares),
          hwmSharePrice: dec(newHwm),
          treasurySol: dec(Math.round((num(vault.treasurySol) + treasuryFee) * 1e9) / 1e9),
        },
      });
      // Exit cash leaves the fund: the recorded epoch NAV drops by settled
      // payouts, or every exit would inflate the price for remaining holders
      // (and mint phantom performance fees on exit-driven "gains").
      const epochNav = Math.max(0, Math.round((nav - settledWithdrawals.reduce((s, w) => s + w.payoutSol, 0)) * 1e9) / 1e9);
      const epoch = await tx.epochCheckpoint.create({
        data: {
          vaultId,
          navSol: dec(epochNav),
          sharePrice: dec(price),
          sharesOutstanding: dec(shares),
          feeSol: dec(feeSol),
        },
      });
      // Report §4 split: book partner/edgepool shares AFTER the epoch exists so
      // payouts link to it. Runs only when a performance fee was taken.
      const split = feeSol > 0 ? await this.bookFeeSplit(vaultId, epoch.id, feeSol, tx) : { payouts: [], edgepoolSol: 0 };
      if (split.edgepoolSol > 0) {
        const cur = await tx.vault.findUnique({ where: { id: vaultId } });
        await tx.vault.update({
          where: { id: vaultId },
          data: { treasurySol: dec(r9(num(cur?.treasurySol) + split.edgepoolSol)) },
        });
      }
      return {
        epochId: epoch.id,
        navSol: epochNav,
        sharePrice: price,
        sharesOutstanding: shares,
        feeSol,
        partnerPayouts: split.payouts,
        edgepoolSol: split.edgepoolSol,
        settledDeposits,
        settledWithdrawals,
      };
    };
    if (typeof db.$transaction === 'function') return db.$transaction(run);
    // Test mocks without $transaction (assert-*.ts): run directly, no atomicity.
    return run({ ...db, $queryRaw: async () => [] });
  }

  /**
   * Split a performance fee by pool kind (fix #5):
   * - partner pools: 75% pro-rata to ACTIVE traders, 25% + dust to Edgepool
   *   (15% trader / 5% Edgepool of profit).
   * - basket (flagship) pools: 50/50 (10% trader / 10% Edgepool of profit).
   * No active/weighted traders → whole fee accrues to treasury.
   * Conservation: payouts + edgepool == fee.
   */
  private async bookFeeSplit(
    vaultId: number,
    epochId: number,
    feeSol: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: Record<string, any>,
  ): Promise<{ payouts: { trader: string; amountSol: number }[]; edgepoolSol: number }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.prisma) as any;
    const vaultRow = (await db.vault.findUnique({ where: { id: vaultId } })) as { kind?: unknown } | null;
    const kind = (((vaultRow?.kind as string | undefined) ?? 'basket') as string).toLowerCase();
    if (kind !== 'basket' && kind !== 'partner') fail(`Unknown vault kind '${kind}'.`);
    const share = kind === 'partner' ? PARTNER_FEE_SHARE : BASKET_FEE_SHARE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traders = (await db.vaultTrader.findMany({ where: { vaultId, isActive: true } })) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weighted = traders.filter((t: any) => ((t.weightBps as number | null) ?? 0) > 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalWeight = weighted.reduce((s: number, t: any) => s + ((t.weightBps as number | null) ?? 0), 0);
    if (weighted.length === 0 || totalWeight <= 0) {
      return { payouts: [], edgepoolSol: r9(feeSol) };
    }
    const partnerPool = f9(feeSol * share);
    const payouts: { trader: string; amountSol: number }[] = [];
    let assigned = 0;
    for (const t of weighted) {
      const amt = f9((partnerPool * (((t.weightBps as number | null) ?? 0))) / totalWeight);
      if (amt <= 0) continue;
      assigned = r9(assigned + amt);
      const row = await db.partnerPayout.create({
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
  /**
   * Open pool positions with MTM pricing (shared by poolDetail + overview).
   * Returns positions (with USD notional) plus the price map used.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async poolPositions(vaultId: number): Promise<{ positions: any[]; nav: number }> {
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
    // wSOL price for SOL-denominated size (best-effort; null when unpriced).
    let solPx = 0;
    try {
      const w = 'So11111111111111111111111111111111111111112';
      solPx = this.prices ? ((await this.prices.bulkPrices([w]))[w] ?? 0) : 0;
    } catch {
      solPx = 0;
    }
    const positions = orders
      .filter((o) => !o.closedAt && o.status === 'CONFIRMED')
      .map((o) => {
        const entry = num(o.entryPriceUsd);
        const live = o.tokenMint && typeof px[o.tokenMint as string] === 'number' ? (px[o.tokenMint as string] as number) : null;
        const qty = entry > 0 ? num(o.amountUsd) / entry : 0;
        const unreal = live !== null && entry > 0 ? r9(qty * live - num(o.amountUsd)) : null;
        return {
          token: o.symbol ?? o.tokenMint?.slice(0, 8) ?? '—',
          trader: o.masterHandle ?? o.masterWallet?.slice(0, 8) ?? '—',
          sizeSol: solPx > 0 ? r9(num(o.amountUsd) / solPx) : null,
          notionalUsd: num(o.amountUsd),
          unrealizedPct: unreal !== null && num(o.amountUsd) > 0 ? r9((unreal / num(o.amountUsd)) * 100) : null,
          stage: o.closeReason ?? 'OPEN',
          entryPriceUsd: entry > 0 ? entry : null,
          livePriceUsd: live,
          createdAt: new Date(o.createdAt as unknown as string).toISOString(),
        };
      });
    return { positions, nav };
  }

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
    const { positions } = await this.poolPositions(vaultId);
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
      detail: signalDetail(o, withLegs.filter((l) => l.orderId === o.id)),
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
    const marks = await this.liveMarks(vaultId);
    // Unlock counts queued deposits too: a fresh 0.5+ deposit opens signals
    // before the next epoch settles (prototype behavior; shares mint at settle).
    const queuedIn = holding
      ? (holding.queuedDeposits as { amountSol: number }[]).reduce((s, q) => s + num(q.amountSol), 0)
      : 0;
    const masked = !holding || holding.valueSol + queuedIn < 0.5;
    const advanced = await this.advancedView(vaultId, orders, withLegs, epochs, nav, solPx, exposure);
    const unmasked = maskPoolDetail(masked, positions, signals, log, exposure, advanced);
    const chain = await this.chainBlock(vaultId);
    return {
      ...base,
      navSeries: epochs.map((e) => ({ t: new Date(e.createdAt as unknown as string).getTime(), v: num(e.sharePrice) })),
      liveNavSol: marks.liveNavSol,
      liveSharePrice: marks.liveSharePrice,
      live: marks.live,
      openPositions: unmasked.positions,
      openCount: positions.length,
      signals: unmasked.signals,
      log: unmasked.log,
      exposure: unmasked.exposure,
      myHolding: holding,
      masked,
      advanced: unmasked.advanced,
      ...(chain ? { chain } : {}),
    };
  }

  /**
   * P2 chain block: on-chain identity + last mirrored state for a vault
   * bound to the program. Null when the vault has no chainVault (legacy
   * shape unchanged). DB mirror only — no RPC in the request path.
   */
  private async chainBlock(vaultId: number): Promise<Record<string, unknown> | null> {
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    const addr = (vault as unknown as { chainVault?: unknown } | null)?.chainVault;
    if (typeof addr !== 'string' || !addr) return null;
    const pid = (vault as unknown as { chainProgramId?: unknown })?.chainProgramId;
    const last = await this.prisma.chainEvent.findFirst({
      where: { vaultId, kind: { in: ['EpochSettled', 'MarkEvent'] } },
      orderBy: { id: 'desc' },
    });
    const payload = (last?.payload ?? {}) as Record<string, unknown>;
    const cluster = String((vault as unknown as { chainEnv?: unknown })?.chainEnv ?? 'devnet');
    const explorer = `https://explorer.solana.com/address/${addr}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
    return {
      programId: typeof pid === 'string' ? pid : null,
      vault: addr,
      price: last?.kind === 'EpochSettled' ? Number(payload.price_scaled ?? 0) / 1_000_000_000 : null,
      marks: Number(payload.marks_lamports ?? 0) / 1_000_000_000,
      paused: (vault as unknown as { chainPaused?: unknown })?.chainPaused ?? null,
      env: cluster,
      explorerUrl: explorer,
    };
  }

  /**
   * Pool app P3 — portfolio overview for the session identity: per-pool mine
   * + openCount/flat + my exposure per open position (size × my share
   * fraction) + pending withdrawals (with next checkpoint) + cross-pool history.
   */
  async portfolioOverview(user: { id: number; wallet: string }): Promise<Record<string, unknown>> {
    const vaults = await this.prisma.vault.findMany({ orderBy: { id: 'asc' } });
    let solPx = 0;
    try {
      const w = 'So11111111111111111111111111111111111111112';
      solPx = this.prices ? ((await this.prices.bulkPrices([w]))[w] ?? 0) : 0;
    } catch {
      solPx = 0;
    }
    const poolsOut: Record<string, unknown>[] = [];
    let totalValue = 0;
    let totalDeposited = 0;
    let totalWithdrawn = 0;
    const exposures: Record<string, unknown>[] = [];
    const pending: Record<string, unknown>[] = [];
    const history: Record<string, unknown>[] = [];
    for (const v of vaults) {
      const [m, st, pos] = await Promise.all([
        this.mine(v.id, user),
        this.status(v.id),
        this.poolPositions(v.id),
      ]);
      if (m.shares <= 0 && m.queuedDeposits.length === 0 && m.queuedWithdrawals.length === 0) continue;
      const frac = st.totalShares > 0 ? m.shares / st.totalShares : 0;
      for (const p of pos.positions) {
        const sizeSol = solPx > 0 ? r9(((p as { notionalUsd: number }).notionalUsd / solPx) * frac) : 0;
        exposures.push({ poolId: v.id, poolName: v.name, ...(p as object), mySizeSol: sizeSol });
      }
      for (const q of m.queuedWithdrawals) {
        pending.push({
          id: q.id, poolId: v.id, poolName: v.name, shares: q.shares,
          createdAt: q.createdAt,
          nextCheckpointAt: st.window?.nextOpensAt ?? null,
        });
      }
      totalValue = r9(totalValue + m.valueSol);
      totalDeposited = r9(totalDeposited + m.depositedSol);
      totalWithdrawn = r9(totalWithdrawn + m.withdrawnSol);
      poolsOut.push({
        vaultId: v.id, poolName: v.name,
        kind: (v.kind as string) ?? 'basket', status: (v.status as string) ?? 'live',
        shares: m.shares, valueSol: m.valueSol, returnsSol: m.returnsSol,
        liveValueSol: m.liveValueSol, liveReturnsSol: m.liveReturnsSol, liveSharePrice: m.liveSharePrice, live: m.live,
        depositedSol: m.depositedSol, withdrawnSol: m.withdrawnSol,
        sharePrice: m.sharePrice, avgEntrySol: m.avgEntrySol,
        sharePricePct: m.avgEntrySol > 0 ? r9((m.sharePrice / m.avgEntrySol - 1) * 100) : 0,
        openCount: pos.positions.length,
        flat: pos.positions.length === 0,
        queued: m.queuedDeposits.length + m.queuedWithdrawals.length,
      });
      const [deps, wds] = await Promise.all([
        this.prisma.deposit.findMany({ where: { vaultId: v.id, OR: [{ userId: user.id }, { depositor: user.wallet }] } }),
        this.prisma.withdrawal.findMany({ where: { vaultId: v.id, OR: [{ userId: user.id }, { depositor: user.wallet }] } }),
      ]);
      for (const d of deps) {
        history.push({ date: new Date(d.createdAt as unknown as string).toISOString(), type: 'deposit', poolId: v.id, poolName: v.name, tx: '—', amountSol: num(d.amountSol), sharesDelta: d.status === 'SETTLED' ? num(d.sharesMinted) : 0, status: d.status });
      }
      for (const w of wds) {
        history.push({
          date: new Date(w.createdAt as unknown as string).toISOString(),
          type: w.status === 'SETTLED' ? 'withdrawal_settled' : w.status === 'CANCELLED' ? 'withdrawal_cancelled' : 'withdrawal_queued',
          poolId: v.id, poolName: v.name, tx: '—',
          amountSol: w.status === 'SETTLED' ? num(w.payoutSol) : 0,
          sharesDelta: w.status === 'CANCELLED' ? 0 : w.status === 'SETTLED' ? -burnedOf(w) : -num(w.sharesRequested), status: w.status,
        });
      }
    }
    history.sort((a, b) => (b.date as string).localeCompare(a.date as string));
    const returns = r9(totalValue + totalWithdrawn - totalDeposited);
    let totalLiveValue = 0;
    let totalLiveReturns = 0;
    for (const p of poolsOut) {
      totalLiveValue = r9(totalLiveValue + (p.liveValueSol as number));
      totalLiveReturns = r9(totalLiveReturns + (p.liveReturnsSol as number));
    }
    return {
      totalValueSol: totalValue, totalDepositedSol: totalDeposited,
      totalWithdrawnSol: totalWithdrawn, returnsSol: returns,
      totalLiveValueSol: totalLiveValue, totalLiveReturnsSol: totalLiveReturns,
      pools: poolsOut, exposures, pending, history,
    };
  }

  /**
   * Cancel an own QUEUED withdrawal (P3). Settled/cancelled/foreign rows are
   * refused. Cancellation never burns shares (settle only touches QUEUED).
   */
  async cancelWithdraw(id: number, user: { id: number; wallet: string }): Promise<{ id: number; status: string }> {
    const row = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!row) fail(`Withdrawal ${id} not found.`);
    const owned = (row.userId as number | null) === user.id || ((row.userId as number | null) === null && row.depositor === user.wallet);
    if (!owned) fail(`Withdrawal ${id} is not yours.`);
    if (row.status !== 'QUEUED') fail(`Withdrawal ${id} is ${row.status}, only QUEUED can be cancelled.`);
    await this.prisma.withdrawal.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { id, status: 'CANCELLED' };
  }

  /**
   * Pool app P5 — Advanced view payload: KPIs, risk vs limits, ladder per
   * open position, exposure vs the 2% per-trader cap.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async advancedView(vaultId: number, orders: any[], withLegs: { orderId: number; leg: string }[], epochs: { navSol: any; createdAt: any; sharePrice?: any }[], nav: number, solPx: number, exposure: { trader: string; pctNav: number }[]): Promise<Record<string, unknown>> {
    const now = Date.now();
    const dayAgo = now - 86400000;
    const weekAgo = now - 7 * 86400000;
    const navAt = (ts: number): number | null => {
      const past = epochs.filter((e) => new Date(e.createdAt as unknown as string).getTime() <= ts);
      return past.length > 0 ? num(past[past.length - 1].navSol) : null;
    };
    const dayBase = navAt(dayAgo) ?? nav;
    const weekBase = navAt(weekAgo) ?? nav;
    const dayPct = dayBase > 0 ? r9(((nav - dayBase) / dayBase) * 100) : 0;
    const weekPct = weekBase > 0 ? r9(((nav - weekBase) / weekBase) * 100) : 0;
    const open = orders.filter((o) => !o.closedAt && o.status === 'CONFIRMED');
    const mints = [...new Set(open.filter((o) => o.tokenMint).map((o) => o.tokenMint as string))];
    let px: Record<string, number> = {};
    try {
      px = this.prices && mints.length > 0 ? await this.prices.bulkPrices(mints) : {};
    } catch {
      px = {};
    }
    let deployedUsd = 0;
    let unrealSol = 0;
    for (const o of open) {
      const live = o.tokenMint ? (px[o.tokenMint as string] as number | undefined) : undefined;
      const entry = num(o.entryPriceUsd);
      if (typeof live === 'number' && live > 0 && entry > 0 && solPx > 0) {
        const qty = num(o.amountUsd) / entry;
        const unrealUsd = qty * live - num(o.amountUsd);
        unrealSol = r9(unrealSol + unrealUsd / solPx);
        deployedUsd += num(o.amountUsd);
      } else if (solPx > 0) {
        deployedUsd += num(o.amountUsd);
      }
    }
    const deployedPctNav = nav > 0 && solPx > 0 ? r9((deployedUsd / solPx / nav) * 100) : 0;
    const hwmRow = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    const hwm = hwmRow ? num(hwmRow.hwmSharePrice) : 0;
    const lastEp = epochs[epochs.length - 1];
    const shareNow = lastEp ? num(lastEp.sharePrice ?? null) : 1;
    const fromHwmPct = hwm > 0 ? r9(((shareNow - hwm) / hwm) * 100) : 0;
    const in24h = orders.filter((o) => new Date(o.createdAt as unknown as string).getTime() >= dayAgo);
    const exits7d = orders.filter(
      (o) => o.closedAt && new Date((o.closedAt ?? o.createdAt) as unknown as string).getTime() >= weekAgo &&
        ['STOP_HIT', 'TRAIL_HIT', 'TIME_STOP'].includes((o.closeReason as string) ?? ''),
    );
    const legsByOrder = new Map<number, string[]>();
    for (const l of withLegs) {
      const arr = legsByOrder.get(l.orderId) ?? [];
      arr.push(l.leg);
      legsByOrder.set(l.orderId, arr);
    }
    const ladder = open.map((o) => {
      const legs = legsByOrder.get(o.id as number) ?? [];
      const tp1 = num(o.tp1Pct) > 0 ? num(o.tp1Pct) : 60;
      const stop = num(o.stopPct) > 0 ? -Math.abs(num(o.stopPct)) : -30;
      const tp2 = tp1 * (num(o.tp2MultPct) > 0 ? num(o.tp2MultPct) / 100 : 2);
      const entry = num(o.entryPriceUsd);
      const live = o.tokenMint ? ((px[o.tokenMint as string] as number | undefined) ?? null) : null;
      const movePct = entry > 0 && typeof live === 'number' ? r9(((live - entry) / entry) * 100) : null;
      return {
        token: o.symbol ?? (o.tokenMint as string)?.slice(0, 8) ?? '—',
        trader: o.masterHandle ?? (o.masterWallet as string)?.slice(0, 8) ?? '—',
        entry, live, movePct,
        sizeSol: solPx > 0 ? r9(num(o.amountUsd) / solPx) : null,
        createdAt: new Date(o.createdAt as unknown as string).toISOString(),
        tp1Pct: r9(tp1), tp1Hit: legs.includes('TP1'),
        tp2Pct: r9(tp2), tp2Hit: legs.includes('TP2'),
        stopPct: r9(stop),
        trailFloorPct: legs.includes('TP2') ? r9(tp1 + (tp2 - tp1) / 2) : null,
        currentPctOfRange: 0,
        stage: (o.closeReason as string | null) ?? 'OPEN',
      };
    });
    return {
      kpis: {
        navSol: r9(nav), sharePrice: r9(shareNow),
        pnlSol: null, unrealizedSol: r9(unrealSol),
        deployedPctNav, fromHwmPct,
      },
      risk: {
        dayPct: r9(dayPct), dayLimitPct: 5, dayUsedPct: Math.min(100, Math.abs(dayPct) / 5 * 100),
        weekPct: r9(weekPct), weekLimitPct: 15, weekUsedPct: Math.min(100, Math.abs(weekPct) / 15 * 100),
        signals24h: in24h.length, emergencyExits7d: exits7d.length,
      },
      ladder,
      exposure: exposure.map((e) => ({ ...e, capPct: r9(Math.min(100, (e.pctNav / 2) * 100)) })),
    };
  }

  /**
   * Pool terminal log P6 — replay for the SSE stream: last orders of a vault
   * mapped to signal events (newest last). Live legs arrive via the bus.
   */
  async recentSignalEvents(
    vaultId: number,
    limit = 30,
  ): Promise<{ vaultId: number; kind: string; token: string; trader: string; note: string; at: number }[]> {
    const { id } = await this.resolveVault(vaultId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await (this.prisma as any).copyOrder.findMany({
      where: { vaultId: id },
      orderBy: { id: 'desc' },
      take: Math.max(1, Math.min(100, limit)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any[];
    const at = (v: unknown): number => new Date(v as string).getTime() || Date.now();
    const evs: { vaultId: number; kind: string; token: string; trader: string; note: string; at: number }[] = [];
    for (const o of [...raw].reverse()) {
      const token = (o.symbol ?? (o.tokenMint ?? '').slice(0, 8)) || '—';
      const trader = (o.masterHandle ?? (o.masterWallet ?? '').slice(0, 8)) || '—';
      if (o.status === 'FAILED') {
        evs.push({ vaultId: id, kind: 'SKIP', token, trader, note: (o.error ?? 'failed').slice(0, 120), at: at(o.createdAt) });
      } else {
        evs.push({ vaultId: id, kind: 'ENTER', token, trader, note: `order #${o.id} entered`, at: at(o.createdAt) });
        if (o.closedAt) {
          const pnl = num(o.realizedPnlUsd);
          evs.push({
            vaultId: id, kind: 'EXIT', token, trader,
            note: `${o.closeReason ?? 'CLOSED'} (${pnl >= 0 ? '+' : ''}$${pnl})`,
            at: at(o.closedAt),
          });
        }
      }
    }
    return evs;
  }

  /**
   * Pool app — fund-flow ledger (1 bot = 1 vault traceability).
   * Every copy order mapped to vault money: allocated size, live MTM value,
   * realized on exit — plus a vault-level cash reconciliation (deposits −
   * withdrawals + realized + unrealized ≈ NAV). SOL equivalents use the
   * current wSOL price (labeled as such). Same 0.5-SOL paywall as poolDetail.
   */
  async ledger(
    vaultId: number,
    user?: { id: number; wallet: string },
  ): Promise<Record<string, unknown>> {
    const { id } = await this.resolveVault(vaultId);
    const [orders, epochs, deposits, withdrawals] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.prisma as any).copyOrder.findMany({ where: { vaultId: id }, orderBy: { id: 'desc' }, take: 200 }),
      this.prisma.epochCheckpoint.findMany({ where: { vaultId: id }, orderBy: { id: 'asc' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.prisma as any).deposit.findMany({ where: { vaultId: id, status: 'SETTLED' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.prisma as any).withdrawal.findMany({ where: { vaultId: id, status: 'SETTLED' } }),
    ]);
    const last = epochs[epochs.length - 1];
    const nav = last ? num(last.navSol) : 0;
    const shares = last ? num(last.sharePrice) : 1;
    let solPx = 0;
    try {
      const w = 'So11111111111111111111111111111111111111112';
      solPx = this.prices ? ((await this.prices.bulkPrices([w]))[w] ?? 0) : 0;
    } catch {
      solPx = 0;
    }
    const mints = [
      ...new Set(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (orders as any[]).filter((o) => o.tokenMint && !o.closedAt).map((o) => o.tokenMint as string),
      ),
    ];
    let px: Record<string, number> = {};
    try {
      px = this.prices && mints.length > 0 ? await this.prices.bulkPrices(mints) : {};
    } catch {
      px = {};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (orders as any[]).map((o) => {
      const amountUsd = num(o.amountUsd);
      const entry = num(o.entryPriceUsd);
      const live = o.tokenMint && typeof px[o.tokenMint as string] === 'number' ? (px[o.tokenMint as string] as number) : null;
      const qty = entry > 0 ? amountUsd / entry : 0;
      const liveUsd = live !== null && entry > 0 ? r9(qty * live) : null;
      const realized = o.closedAt ? num(o.realizedPnlUsd) : 0;
      return {
        id: o.id,
        open: !o.closedAt,
        token: o.symbol ?? (o.tokenMint as string)?.slice(0, 8) ?? '—',
        trader: o.masterHandle ?? (o.masterWallet as string)?.slice(0, 8) ?? '—',
        status: o.status,
        amountUsd: r9(amountUsd),
        allocatedSol: solPx > 0 ? r9(amountUsd / solPx) : null,
        liveValueUsd: liveUsd,
        liveValueSol: liveUsd !== null && solPx > 0 ? r9(liveUsd / solPx) : null,
        realizedUsd: r9(realized),
        realizedSol: solPx > 0 ? r9(realized / solPx) : null,
        closeReason: (o.closeReason as string | null) ?? null,
        createdAt: new Date(o.createdAt as unknown as string).toISOString(),
        closedAt: o.closedAt ? new Date(o.closedAt as unknown as string).toISOString() : null,
      };
    });
    const openRows = rows.filter((r) => (r as { open: boolean }).open);
    const openAllocatedUsd = r9(openRows.reduce((s, r) => s + (r as { amountUsd: number }).amountUsd, 0));
    const unrealizedUsd = r9(
      openRows.reduce((s, r) => {
        const rr = r as { liveValueUsd: number | null; amountUsd: number };
        return s + (rr.liveValueUsd !== null ? rr.liveValueUsd - rr.amountUsd : 0);
      }, 0),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const realizedUsd = r9((orders as any[]).reduce((s, o) => s + (o.closedAt ? num(o.realizedPnlUsd) : 0), 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settledDepositsSol = r9((deposits as any[]).reduce((s: number, d: any) => s + num(d.amountSol), 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settledWithdrawalsSol = r9((withdrawals as any[]).reduce((s: number, w: any) => s + num(w.payoutSol), 0));
    const holding = user ? await this.mine(id, user) : null;
    const queuedIn = holding
      ? (holding.queuedDeposits as { amountSol: number }[]).reduce((s, q) => s + num(q.amountSol), 0)
      : 0;
    const masked = !holding || holding.valueSol + queuedIn < 0.5;
    const shown = masked
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? rows.map((r: any) => ({ ...r, token: '$••••', trader: 'Trader •' }))
      : rows;
    return {
      vaultId: id,
      statement: {
        settledDepositsSol,
        settledWithdrawalsSol,
        openAllocatedUsd,
        openAllocatedSol: solPx > 0 ? r9(openAllocatedUsd / solPx) : null,
        realizedUsd,
        realizedSol: solPx > 0 ? r9(realizedUsd / solPx) : null,
        unrealizedUsd,
        unrealizedSol: solPx > 0 ? r9(unrealizedUsd / solPx) : null,
        navSol: r9(nav),
        sharesOutstanding: last ? num(last.sharesOutstanding) : 0,
        sharePrice: r9(shares),
        solPriceUsd: solPx > 0 ? solPx : null,
      },
      orders: shown,
      masked,
    };
  }

  /**
   * Admin console — per-signal phase journeys for one vault (terminal demo
   * tab). Read-only: each order mapped to its Detect → Qualify → Enter →
   * Manage → Exit evidence (master tx, qualify verdict, entry params, legs,
   * exit reason + realized). No masking here — ADMIN-only route.
   */
  async ordersJourney(vaultId: number): Promise<unknown[]> {
    const { id } = await this.resolveVault(vaultId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = (await (this.prisma as any).copyOrder.findMany({
      where: { vaultId: id },
      orderBy: { id: 'desc' },
      take: 50,
      include: { legs: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return orders.map((o: any) => {
      const q = ((o.quoteJson ?? {}) as Record<string, unknown>) ?? {};
      const qual = (q.qualify ?? null) as { pass?: unknown; reasons?: unknown; score?: unknown } | null;
      const sized = (q.sized ?? null) as Record<string, unknown> | null;
      const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
      const opt = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = num(v as { toNumber(): number } | number | string);
        return Number.isFinite(n) ? n : null;
      };
      const reasons = Array.isArray(qual?.reasons) ? (qual.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legs = (((o.legs ?? []) as any[]) ?? []).map((l: any) => ({
        leg: l.leg as string,
        fraction: num(l.fraction),
        exitPriceUsd: opt(l.exitPriceUsd),
        realizedPnlUsd: opt(l.realizedPnlUsd),
        closedAt: l.closedAt ? new Date(l.closedAt as unknown as string).toISOString() : null,
      }));
      return {
        id: o.id,
        token: o.symbol ?? (o.tokenMint as string)?.slice(0, 8) ?? '—',
        trader: o.masterHandle ?? (o.masterWallet as string)?.slice(0, 8) ?? '—',
        status: o.status,
        error: str(o.error),
        masterTxHash: str(o.masterTxHash),
        createdAt: new Date(o.createdAt as unknown as string).toISOString(),
        qualify: qual
          ? {
            pass: qual.pass === true,
            score: typeof qual.score === 'number' ? qual.score : null,
            reasons,
          }
          : null,
        entry: {
          priceUsd: opt(o.entryPriceUsd),
          amountUsd: num(o.amountUsd),
          tp1Pct: opt(o.tp1Pct),
          stopPct: opt(o.stopPct),
          trailPct: opt(o.trailPct),
          entryMode: str(o.entryMode),
          venue: str(o.venue),
          sizedCopyUsd: typeof sized?.copyUsd === 'number' ? (sized.copyUsd as number) : null,
        },
        legs,
        closeReason: str(o.closeReason),
        exitPriceUsd: opt(o.exitPriceUsd),
        realizedPnlUsd: o.closedAt ? (opt(o.realizedPnlUsd) ?? 0) : null,
        closedAt: o.closedAt ? new Date(o.closedAt as unknown as string).toISOString() : null,
      };
    });
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
  /**
   * Live marks for DISPLAY ONLY: MTM NAV + implied share price without
   * settling an epoch. Fail-soft to the last epoch when pricing is
   * unavailable. Settlement math never uses these — read-path display does,
   * so positions track the market between epochs.
   */
  private async liveMarks(vaultId: number): Promise<{ liveNavSol: number; liveSharePrice: number; live: boolean }> {
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    const totalShares = num(vault?.totalShares as never);
    const last = await this.prisma.epochCheckpoint.findFirst({ where: { vaultId }, orderBy: { id: 'desc' } });
    const fallbackPrice = last ? num(last.sharePrice) : 1;
    try {
      const liveNav = await this.computeNav(vaultId);
      if (totalShares > 0) return { liveNavSol: liveNav, liveSharePrice: r9(liveNav / totalShares), live: true };
    } catch {
      // Pricing down — caller shows last settled numbers instead.
    }
    return { liveNavSol: r9(fallbackPrice * totalShares), liveSharePrice: fallbackPrice, live: false };
  }

  async mine(vaultId: number, user: { id: number; wallet: string }): Promise<{
    vaultId: number;
    vaultName: string;
    sharePrice: number;
    avgEntrySol: number;
    shares: number;
    valueSol: number;
    depositedSol: number;
    withdrawnSol: number;
    returnsSol: number;
    liveSharePrice: number;
    liveValueSol: number;
    liveReturnsSol: number;
    live: boolean;
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
        burned = r9(burned + burnedOf(w));
        withdrawn = r9(withdrawn + num(w.payoutSol));
      } else if (w.status === 'QUEUED') {
        qw.push({ id: w.id, shares: num(w.sharesRequested), createdAt: (w.createdAt as Date).toISOString() });
      }
    }
    const shares = Math.max(0, r9(minted - burned));
    const value = r9(shares * price);
    const marks = await this.liveMarks(vaultId);
    const liveValue = r9(shares * marks.liveSharePrice);
    return {
      vaultId,
      vaultName: vault.name,
      sharePrice: price,
      avgEntrySol: minted > 0 ? r9(deposited / minted) : price,
      shares,
      valueSol: value,
      depositedSol: deposited,
      withdrawnSol: withdrawn,
      returnsSol: r9(value + withdrawn - deposited),
      liveSharePrice: marks.liveSharePrice,
      liveValueSol: liveValue,
      liveReturnsSol: r9(liveValue + withdrawn - deposited),
      live: marks.live,
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
        // Value at window start = last FUNDED checkpoint before the cutoff
        // (fallback: oldest funded checkpoint when the pool is younger than
        // the window). The genesis 0-NAV checkpoint is never a base — using it
        // prints a contradictory "+X SOL at +0.0%".
        const funded = eps.filter((e) => num(e.navSol) > 0);
        const base = [...funded].reverse().find((e) => new Date(e.createdAt as unknown as string).getTime() < cut) ?? funded[0];
        const navNow = last ? num(last.navSol) : 0;
        const navBase = base ? num(base.navSol) : navNow;
        const sol = r9(navNow - navBase);
        pnl[key] = { sol, pct: navBase > 0 ? r9((sol / navBase) * 100) : 0 };
      }
      const used = new Set(deposits.filter((d) => d.vaultId === v.id).map((d) => d.depositor)).size;
      const basket = traders
        .filter((t) => t.vaultId === v.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t) => {
          const tw = byId.get(t.wallet) as any;
          return {
            wallet: t.wallet,
            handle: (tw?.handle as string) ?? t.wallet.slice(0, 6),
            rank: (tw?.fomoRank as number | null) ?? null,
            ranks: {
              h24: (tw?.rank24h as number | null) ?? null,
              d7: (tw?.rank7d as number | null) ?? null,
              d30: (tw?.rank30d as number | null) ?? null,
            },
            weightBps: (t.weightBps as number | null) ?? 0,
          };
        });
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
        spark: eps.slice(-20).map((e) => num(e.sharePrice)),
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
    // Prod DB guard: external smoke/e2e/test scripts must never land pools in
    // production (both POST /api/vaults and seeds funnel through here).
    // `demo-` stays allowed: explicit ADMIN action, owned + cleaned by demo reset.
    if (process.env.NODE_ENV === 'production' && /(smoke|e2e|prod-x|[-_]test([-_]|$)|^test[-_])/i.test(clean)) {
      fail(`Refusing test-like pool name in production: '${clean}'.`);
    }
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
