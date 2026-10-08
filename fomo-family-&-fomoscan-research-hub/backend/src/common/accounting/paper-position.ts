type Numeric = number | string | { toNumber(): number } | null | undefined;

export interface PaperPosition {
  amountUsd: Numeric;
  action?: string | null;
  entryPriceUsd?: Numeric;
  realizedPnlUsd?: Numeric;
  closedAt?: Date | null;
  legs?: { fraction: Numeric; realizedPnlUsd?: Numeric }[];
}

export function accountingNumber(value: Numeric): number {
  return typeof value === 'object' && value !== null ? value.toNumber() : Number(value ?? 0);
}

/** Filled legs remove principal from open exposure; a closed order has none. */
export function remainingNotionalUsd(order: PaperPosition): number {
  if (order.closedAt) return 0;
  const filled = (order.legs ?? []).reduce((sum, leg) => sum + accountingNumber(leg.fraction), 0);
  return accountingNumber(order.amountUsd) * Math.max(0, 1 - filled);
}

export function realizedPnlUsd(order: PaperPosition): number {
  return order.legs?.length
    ? order.legs.reduce((sum, leg) => sum + accountingNumber(leg.realizedPnlUsd), 0)
    : accountingNumber(order.realizedPnlUsd);
}

export function paperPositionPnl(order: PaperPosition, livePrice?: number): { realizedUsd: number; unrealizedUsd: number } {
  const realizedUsd = realizedPnlUsd(order);
  const remaining = remainingNotionalUsd(order);
  const entry = accountingNumber(order.entryPriceUsd);
  if (remaining <= 0) return { realizedUsd, unrealizedUsd: 0 };
  if (!(entry > 0) || typeof livePrice !== 'number' || !Number.isFinite(livePrice) || livePrice <= 0) {
    throw new Error('Open paper position cannot be valued without entry and token prices.');
  }
  const direction = order.action === 'SELL' ? -1 : 1;
  return { realizedUsd, unrealizedUsd: remaining * (livePrice / entry - 1) * direction };
}
