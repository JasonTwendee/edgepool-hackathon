// Data shapes the UI reads. Names mirror the reference prototype's sample data.
import type { PoolKind } from "./pool-math";

export interface Trader { id: string; handle: string; xHandle?: string; ranks: { d1: number; d7: number; d30: number } }

export interface Pool {
  id: string; name: string; kind: PoolKind; ownerHandle?: string; // partner pools only
  status: "live" | "paused"; listing: "public" | "unlisted";
  navSol: number; navPerShare: number; hwmNavPerShare: number;
  traders: Trader[]; maxTraders: 3 | 4 | 5;
  slots: { used: number; max: number };
  pnl: Record<"day" | "week" | "month" | "all", { sol: number; pct: number }>;
  navPerShareSeries: Record<"day" | "week" | "month" | "all", { t: number; v: number }[]>;
  openPositions: Position[]; signals: Signal[]; log: LogEvent[];
  exposure: { traderHandle: string; pctNav: number; pnlSol: number }[];
  risk: { todayPct: number; weekPct: number; signals24h: number; entered24h: number; emergencyExits7d: number; deployedPctNav: number };
}

export interface Position {
  token: string; traderHandle: string; sizeSol: number; unrealizedPct: number; stopPct: number;
  tp1Hit: boolean; tp2Hit: boolean; stage: string; runnerFloorPct?: number; timeStopRemainingSec: number;
}

export type StepState = "done" | "waiting" | "skipped" | "failed" | "tp" | "stopped";
export interface Signal { token: string; traderHandle: string; ageSec: number; note: string; steps: { label: string; state: StepState }[] }
export interface LogEvent { at: string; token: string; traderHandle: string; event: string; detail: string; kind: "entry" | "limit" | "tp" | "skip" | "exit" | "qualify" }

export interface Holding { poolId: string; shares: number; depositedSol: number; withdrawnSol: number; avgEntryNavPerShare: number }
export interface PendingWithdrawal { id: string; poolId: string; amountSol: number; settlesAt: string }
export interface HistoryRow { date: string; poolId: string; type: "deposit" | "withdrawal_instant" | "withdrawal_queued"; amountSol: number; sharesDelta: number; txSig: string }

export interface PartnerAccount {
  handle: string; email: string; payoutWallet?: string;
  fees: { pendingSol: number; claimableSol: number; paidSol: number; nextCheckpointAt: string };
  poolId: string; requests: { fomoHandle: string; xHandle?: string; status: "pending" }[];
  rules: Record<string, number>;
}
