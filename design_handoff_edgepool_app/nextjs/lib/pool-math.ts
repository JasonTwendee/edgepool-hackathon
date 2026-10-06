// Pure business rules used by the prototype. Port these as-is; they are UI-agnostic.
// All accounting is in SOL. USDC is display-only and never used for shares or settlement.

export const MIN_DEPOSIT_SOL = 0.5;          // minimum deposit; also the signal-unlock threshold
export const UNLOCK_THRESHOLD_SOL = 0.5;     // signals/tokens visible only if user holds >= this in that pool

export type PoolKind = "edgepool_basket" | "partner_pool";

export interface FeeSplit { totalPct: number; signalTraderPct: number; edgepoolPct: number }
// Fees apply only to new profit above the pool's NAV-per-share high-water mark. No management fee.
export const FEES: Record<PoolKind, FeeSplit> = {
  edgepool_basket: { totalPct: 20, signalTraderPct: 10, edgepoolPct: 10 }, // algorithm-picked traders
  partner_pool:    { totalPct: 20, signalTraderPct: 15, edgepoolPct: 5 },  // owner + invited traders
};
// Fee is attributed per trade to the trader whose signal produced the profit. Losing trades earn 0.
export const traderFeeForTrade = (kind: PoolKind, profitSol: number) =>
  Math.max(0, profitSol) * FEES[kind].signalTraderPct / 100;

// Shares
export const sharesForDeposit = (amountSol: number, navPerShare: number) => amountSol / navPerShare;
export const sharesForWithdrawal = (amountSol: number, navPerShare: number) => amountSol / navPerShare;
export const positionValue = (shares: number, navPerShare: number) => shares * navPerShare;
export const weightedAvgEntry = (prevShares: number, prevAvg: number, addShares: number, navPerShare: number) =>
  (prevShares * prevAvg + addShares * navPerShare) / (prevShares + addShares);

// PnL (Portfolio shows both, per pool, in the expandable row)
export const cashFlowPnl = (value: number, deposited: number, withdrawn: number) => value - deposited + withdrawn;
export const sharePricePnlPct = (navPerShare: number, avgEntry: number) => (navPerShare / avgEntry - 1) * 100;
export const totalPnlPct = (pnl: number, deposited: number, withdrawn: number) =>
  deposited - withdrawn > 0 ? (pnl / (deposited - withdrawn)) * 100 : 0;

// Withdrawals: instant when the pool has no open positions ("flat"); otherwise queued to the next checkpoint.
// A queued request does NOT reduce shares/value until it settles. Available = value - already queued.
export const withdrawMode = (openPositions: number) => (openPositions === 0 ? "instant" : "queued");
export const availableToWithdraw = (value: number, queued: number) => Math.max(0, value - queued);

// Depositor slots (FOMO cap). Partners set max for their pool; it can never go below current depositors.
export interface SlotState { used: number; max: number }
export const slotsLeft = (s: SlotState) => Math.max(0, s.max - s.used);
export const isFull = (s: SlotState) => slotsLeft(s) <= 0;
// Full pools block NEW depositors only; existing holders can still add.
export const canDeposit = (s: SlotState, isHolder: boolean) => !isFull(s) || isHolder;
export const slotColor = (s: SlotState) =>
  isFull(s) ? "var(--ep-neg)" : slotsLeft(s) <= Math.max(5, s.max * 0.1) ? "var(--ep-amber)" : "var(--ep-aqua)";
export const clampPartnerMax = (requested: number, currentDepositors: number) => Math.max(requested, currentDepositors);

// Strategy rules (initial settings under validation; partner pools may customise)
export const DEFAULT_RULES = {
  traderCapPctNav: 2,          // max exposure per trader
  entryNowPct: 50,             // execute 50% immediately
  limitOffsetPct: 10,          // remaining 50% as limit order 10% below the immediate fill
  stopMinPct: 8, stopMaxPct: 40, // stopPct = clamp(2 × ATR(1h), 8%, 40%)
  timeStopHours: 24,
  dailyKillSwitchPct: 5,       // pause new trades after −5% pool NAV in a day
  weeklyLossLimitPct: 15,
  tp1: { atPct: 60, sellPct: 40 },
  tp2: { atPct: 100, sellPct: 40 },
  runnerPct: 20, runnerFloorStartPct: 10, runnerFloorStepGainPct: 50, runnerFloorStepRaisePct: 25, runnerFullExitPct: 300,
};
export const adaptiveStopPct = (atr1hPct: number, r = DEFAULT_RULES) =>
  Math.min(r.stopMaxPct, Math.max(r.stopMinPct, 2 * atr1hPct));

// Masking for visitors / holders below the unlock threshold
export const MASK_TOKEN = "$••••";
export const MASK_TRADER = "Trader •";
export const MASK_VALUE = "•••";
