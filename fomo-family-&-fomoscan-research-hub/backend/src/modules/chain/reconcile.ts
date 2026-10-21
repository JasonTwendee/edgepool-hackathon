/**
 * Pure reconcile checks (P2, design §7.5B). No network, no DB — shared by the
 * reconcile service and `assert-chain.ts`.
 */
export interface ReconcileOnchain {
  supplyRaw: number;
  hwmScaled: number;
  priceScaled: number;
  treasuryCash: number;
  feeCredit: number;
}

export interface ReconcileOffchain {
  /** Σ settled minted − burned, in raw shares. */
  supplyRaw: number;
  hwmScaled: number;
  lastPriceScaled: number;
  /** Σ unsettled payouts + buffer, in lamports. */
  obligations: number;
  treasuryCash: number;
  referencedSigs: string[];
  storedSigs: string[];
}

export interface ReconcileIssue {
  check: string;
  detail: string;
}

const DUST_RAW = 1000;
const PRICE_TOL_SCALED = 1000;

export function checkReconcile(on: ReconcileOnchain, off: ReconcileOffchain): ReconcileIssue[] {
  const issues: ReconcileIssue[] = [];
  if (Math.abs(on.supplyRaw - off.supplyRaw) > DUST_RAW) {
    issues.push({
      check: 'supply-mirror',
      detail: `on-chain supply ${on.supplyRaw} vs off-chain ${off.supplyRaw}`,
    });
  }
  if (off.treasuryCash < off.obligations) {
    issues.push({
      check: 'cash-coverage',
      detail: `treasury cash ${off.treasuryCash} below obligations ${off.obligations}`,
    });
  }
  if (Math.abs(on.priceScaled - off.lastPriceScaled) > PRICE_TOL_SCALED) {
    issues.push({
      check: 'price-mirror',
      detail: `on-chain price ${on.priceScaled} vs off-chain ${off.lastPriceScaled}`,
    });
  }
  const stored = new Set(off.storedSigs);
  const missing = off.referencedSigs.filter((s) => !stored.has(s));
  if (missing.length > 0) {
    issues.push({ check: 'event-completeness', detail: `missing events for ${missing.length} sig(s): ${missing.slice(0, 3).join(',')}` });
  }
  if (on.hwmScaled < off.hwmScaled) {
    issues.push({
      check: 'hwm-monotonic',
      detail: `on-chain hwm ${on.hwmScaled} below off-chain ${off.hwmScaled}`,
    });
  }
  return issues;
}
