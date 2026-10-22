/**
 * Pure chain-event helpers (P2). No network, no DB — shared by the indexer
 * service and `assert-chain.ts`.
 */
export const CHAIN_EVENT_KINDS = [
  'VaultInit',
  'DepositEvent',
  'WithdrawEvent',
  'MarkEvent',
  'EpochSettled',
  'SimTradeEvent',
  'PausedEvent',
  'FeesCollected',
] as const;

export type ChainEventKind = (typeof CHAIN_EVENT_KINDS)[number];

export interface ParsedChainEvent {
  signature: string;
  ixIndex: number;
  eventIndex: number;
  kind: string;
  slot: number;
  payload: Record<string, unknown>;
}

/** Anchor event coder returns camelCase (`markEvent`); domain uses PascalCase. */
export function normalizeEventKind(kind: string): string {
  if (!kind) return kind;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function isKnownKind(kind: string): boolean {
  return (CHAIN_EVENT_KINDS as readonly string[]).includes(normalizeEventKind(kind));
}

/** Read a numeric event field from Anchor camelCase or legacy snake_case. */
export function eventNumber(
  payload: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): number {
  const value = payload[camelKey] ?? payload[snakeKey] ?? 0;
  return Number(value);
}

/** Idempotency key — mirrors @@unique([signature, ixIndex, eventIndex]). */
export function eventKey(e: Pick<ParsedChainEvent, 'signature' | 'ixIndex' | 'eventIndex'>): string {
  return `${e.signature}:${e.ixIndex}:${e.eventIndex}`;
}

function isInvokeLine(line: string, programId: string): boolean {
  return line.startsWith(`Program ${programId} invoke`);
}

function dataOf(line: string): string | null {
  const m = /^Program data:\s*(\S+)/.exec(line.trim());
  return m ? m[1] : null;
}

/**
 * Scan transaction logs for Anchor event payloads of `programId`.
 * `decode(base64)` maps a payload to {kind, payload} (wired to the Anchor
 * coder in the service, stubbed in asserts). Unknown payloads are skipped.
 */
export function parseChainEvents(
  signature: string,
  slot: number,
  logs: string[],
  programId: string,
  decode: (base64: string) => { kind: string; payload: Record<string, unknown> } | null,
): ParsedChainEvent[] {
  const out: ParsedChainEvent[] = [];
  let ix = -1;
  let ev = 0;
  for (const line of logs) {
    if (isInvokeLine(line, programId)) {
      ix += 1;
      continue;
    }
    const b64 = dataOf(line);
    if (b64 === null || ix < 0) continue;
    let decoded: { kind: string; payload: Record<string, unknown> } | null = null;
    try {
      decoded = decode(b64);
    } catch {
      decoded = null;
    }
    if (!decoded) continue;
    const kind = normalizeEventKind(decoded.kind);
    if (!isKnownKind(kind)) continue;
    out.push({ signature, ixIndex: ix, eventIndex: ev, kind, slot, payload: decoded.payload });
    ev += 1;
  }
  return out;
}

/** Marks in lamports from open position values in SOL (floor). */
export function computeMarksLamports(valuesSol: number[]): number {
  let total = 0;
  for (const v of valuesSol) {
    if (!Number.isFinite(v) || v <= 0) continue;
    total += Math.floor(v * 1_000_000_000);
  }
  return total;
}

/** Faucet gate (pure): devnet cluster only + explicit enablement. */
export function isFaucetAllowed(cluster: string, chainEnabled: boolean): boolean {
  return chainEnabled && cluster === 'devnet';
}

export interface QueuedRow {
  id: number;
  amountSol: unknown;
}

/** Match a QUEUED deposit to an on-chain amount: exact lamports first, else oldest. */
export function matchDepositByAmount(rows: QueuedRow[], amountLamports: number): QueuedRow | null {
  if (rows.length === 0) return null;
  return rows.find((d) => Math.round(Number(d.amountSol) * 1_000_000_000) === amountLamports) ?? rows[0];
}
