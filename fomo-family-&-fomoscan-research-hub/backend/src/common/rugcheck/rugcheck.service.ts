import { Injectable } from '@nestjs/common';
import type { FetchLike } from '../market/datastream.service.js';

/**
 * Flux RugCheck token reports (Qualify step, deck slide 06).
 * GET /v1/tokens/{mint}/report?key= — 24h in-memory cache (reports change
 * slowly; cache avoids re-billing repeated Qualify checks on one mint).
 */
export interface RugVerdict {
  mint: string;
  score: number | null;
  rugged: boolean;
  riskNames: string[];
  topHolderPct: number | null;
  liquidityUsd: number | null;
}

export interface QualifyResult {
  pass: boolean;
  reasons: string[];
  verdict: RugVerdict;
}

const CACHE_TTL_MS = 24 * 3600 * 1000;

@Injectable()
export class RugCheckService {
  private readonly base = 'https://api.rugcheck.xyz';
  private readonly apiKey?: string;
  private readonly cache = new Map<string, { at: number; verdict: RugVerdict }>();

  // NOTE: no-arg constructor (tsx-safe DI) — env is read lazily per call
  // so tests can set process.env before invoking methods.
  constructor() {
    this.apiKey = process.env.RUGCHECK_API_KEY || undefined;
  }

  private url(mint: string): string {
    const key = this.apiKey ? `?key=${this.apiKey}` : '';
    return `${this.base}/v1/tokens/${mint}/report${key}`;
  }

  async getReport(
    mint: string,
    fetcher: FetchLike = fetch as unknown as FetchLike,
  ): Promise<RugVerdict> {
    const hit = this.cache.get(mint);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.verdict;
    const res = await fetcher(this.url(mint), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`RugCheck ${res.status} for ${mint.slice(0, 8)}…`);
    const body = (await res.json()) as Record<string, unknown>;
    const risks = Array.isArray(body.risks) ? body.risks : [];
    const names = risks
      .map((r) => (typeof r === 'string' ? r : (r as { name?: unknown }).name))
      .filter((n): n is string => typeof n === 'string');
    const top = Array.isArray(body.topHolders) ? (body.topHolders[0] as Record<string, unknown> | undefined) : undefined;
    const pctRaw = top ? (top.pct ?? top.percent ?? top.share) : undefined;
    const verdict: RugVerdict = {
      mint,
      score: typeof body.score === 'number' ? body.score : null,
      rugged: body.rugged === true,
      riskNames: names,
      topHolderPct: typeof pctRaw === 'number' ? pctRaw : null,
      liquidityUsd:
        typeof body.totalMarketLiquidity === 'number'
          ? body.totalMarketLiquidity
          : typeof body.totalStableLiquidity === 'number'
            ? body.totalStableLiquidity
            : null,
    };
    this.cache.set(mint, { at: Date.now(), verdict });
    return verdict;
  }

  /** v1 Qualify: block rugged or any flagged risk; strictness via maxRisks. */
  async qualify(
    mint: string,
    opts: { maxRisks?: number } = {},
    fetcher?: FetchLike,
  ): Promise<QualifyResult> {
    const verdict = await this.getReport(mint, fetcher);
    const reasons: string[] = [];
    if (verdict.rugged) reasons.push('flagged rugged');
    const maxRisks = opts.maxRisks ?? 0;
    if (verdict.riskNames.length > maxRisks) {
      reasons.push(`risks: ${verdict.riskNames.slice(0, 3).join(', ')}`);
    }
    return { pass: reasons.length === 0, reasons, verdict };
  }
}
