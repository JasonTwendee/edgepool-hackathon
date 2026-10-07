/**
 * Shared kill-switch math (auto-fire halt + executePaper/deposit gates).
 * Pure functions — no DI, no Prisma. Loss is measured last-settled-NAV vs the
 * checkpoint before each window (same convention as the NAV series).
 */

export interface EpsRow {
  navSol: unknown;
  createdAt: unknown;
}

const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  return 0;
};

export function vaultLoss(epochs: EpsRow[]): { dayPct: number; weekPct: number; nav: number } {
  const at = (ts: number): number | null => {
    const past = epochs.filter((e) => new Date(e.createdAt as unknown as string).getTime() <= ts);
    return past.length > 0 ? num(past[past.length - 1].navSol) : null;
  };
  const navs = epochs.map((e) => num(e.navSol));
  const navNum = navs.length > 0 ? navs[navs.length - 1] : 0;
  const now = Date.now();
  const dayBase = at(now - 86400000) ?? navNum;
  const weekBase = at(now - 7 * 86400000) ?? navNum;
  const dayPct = dayBase > 0 ? r9(((navNum - dayBase) / dayBase) * 100) : 0;
  const weekPct = weekBase > 0 ? r9(((navNum - weekBase) / weekBase) * 100) : 0;
  return { dayPct, weekPct, nav: navNum };
}

export function killLimits(rulesJson: unknown): { daily: number; weekly: number } {
  const r = (rulesJson ?? {}) as Record<string, unknown>;
  const daily =
    typeof r.dailyKillSwitchPct === 'number' && Number.isFinite(r.dailyKillSwitchPct)
      ? Math.abs(r.dailyKillSwitchPct as number)
      : 5;
  const weekly =
    typeof r.weeklyLossLimitPct === 'number' && Number.isFinite(r.weeklyLossLimitPct)
      ? Math.abs(r.weeklyLossLimitPct as number)
      : 15;
  return { daily: daily > 0 ? daily : 5, weekly: weekly > 0 ? weekly : 15 };
}

/** True when a vault must refuse NEW risk (paused status or breached limits). */
export function isHaltedVault(
  status: unknown,
  rulesJson: unknown,
  epochs: EpsRow[],
): { halted: boolean; dayPct: number; weekPct: number; daily: number; weekly: number } {
  if (((status as string | undefined) ?? 'live') !== 'live') {
    return { halted: true, dayPct: 0, weekPct: 0, daily: 5, weekly: 15 };
  }
  const { dayPct, weekPct } = vaultLoss(epochs);
  const { daily, weekly } = killLimits(rulesJson);
  return { halted: dayPct <= -daily || weekPct <= -weekly, dayPct, weekPct, daily, weekly };
}
