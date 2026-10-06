import { useMemo, useState } from 'react';
import { Check, Copy, ArrowSquareOut, ShareNetwork } from '@phosphor-icons/react';
import type { OnChainTransactionEvent, TrackedWallet } from '../types/onchain';
import type { WalletHoldings, WalletPnl } from '../lib/api';
import { formatDateTimeShort, formatUsd, formatUsdSigned, shortAddress, timeAgo } from '../lib/format';
import { PnlChart, type ChartPoint } from './PnlChart';
import { SwapsTable, type SwapsTab } from './SwapsTable';
import { ThesisCard } from './ThesisCard';
import { WalletAvatar } from './WalletAvatar';

export const RANGES = [
  { key: '24h', label: '24H', days: 1 },
  { key: '3d', label: '3D', days: 3 },
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: 'all', label: 'ALL', days: 120 },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];

export function rangeDays(key: RangeKey): number {
  return RANGES.find((r) => r.key === key)!.days;
}

/**
 * Aggregate cumulative points by UTC day (FOMO-style smooth curve).
 * Intraday sawtooth collapses into one net point per day; short ranges
 * (< 2d span) keep full detail. Endpoint value is preserved.
 */
function toDaily(pts: ChartPoint[]): ChartPoint[] {
  if (pts.length < 2) return pts;
  const span = pts[pts.length - 1].t - pts[0].t;
  if (span <= 2 * 86400) return pts;
  const perDay = new Map<number, number>();
  let prev = 0;
  for (const p of pts) {
    const day = Math.floor(p.t / 86400);
    perDay.set(day, (perDay.get(day) ?? 0) + (p.v - prev));
    prev = p.v;
  }
  const days = [...perDay.keys()].sort((a, b) => a - b);
  const out: ChartPoint[] = [];
  let cum = 0;
  for (const d of days) {
    cum = Math.round((cum + (perDay.get(d) ?? 0)) * 100) / 100;
    out.push({ t: d * 86400 + 43200, v: cum });
  }
  return out;
}

interface Props {
  wallet: TrackedWallet;
  /** Full-range dataset for chart/top-trades/stats (up to 1000). */
  swaps: OnChainTransactionEvent[];
  /** Current table page (≤25 rows) — rendered in SwapsTable. */
  tableSwaps: OnChainTransactionEvent[];
  pnl: WalletPnl | null;
  /** True while switching wallets/ranges (skeleton instead of seed fallback). */
  pnlLoading: boolean;
  holdings: WalletHoldings | null;
  holdingsLoading: boolean;
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  swapsTotal: number;
  swapsPage: number;
  swapsTotalPages: number;
  swapsTab: SwapsTab;
  swapsLoading: boolean;
  onSwapsTabChange: (tab: SwapsTab) => void;
  onSwapsPageChange: (page: number) => void;
  showZero: boolean;
  onToggleShowZero: () => void;
  liveConnected: boolean;
  lastSyncSec: number | null;
  followBusy: boolean;
  onToggleFollow: () => void;
  /** Non-ADMIN hides the Follow toggle (copy-engine control lives in BE/admin). */
  isAdmin?: boolean;
}

export function TraderProfile({
  wallet,
  swaps,
  tableSwaps,
  pnl,
  pnlLoading,
  holdings,
  holdingsLoading,
  range,
  onRangeChange,
  swapsTotal,
  swapsPage,
  swapsTotalPages,
  swapsTab,
  swapsLoading,
  onSwapsTabChange,
  onSwapsPageChange,
  showZero,
  onToggleShowZero,
  liveConnected,
  lastSyncSec,
  followBusy,
  onToggleFollow,
  isAdmin = true,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [positionsTab, setPositionsTab] = useState<'open' | 'closed'>('open');

  const { points, detailPoints, rangeFlow, topTrades, buys, sells, chartMode, emptyHint } = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const days = rangeDays(range);
    // Single-point curves anchor from 0 so they render as 0 → value
    // instead of "Not enough data". Anchor capped at 30d before the trade
    // so ALL-range doesn't flatten into a 10-year line.
    const anchor = (pts: ChartPoint[]): ChartPoint[] => {
      if (pts.length !== 1) return pts;
      const start = Math.max(nowSec - days * 86400, pts[0].t - 30 * 86400);
      if (start >= pts[0].t) return pts;
      return [{ t: start, v: 0 }, pts[0]];
    };
    if (pnl && pnl.pairs > 0) {
      // Realized mode: everything comes from the PnL response (full-range,
      // server-side) — no extra ledger fetch needed.
      const raw = pnl.series.map((p) => ({ t: p.t, v: p.cum }));
      const pts = anchor(toDaily(raw));
      return {
        points: pts,
        detailPoints: raw,
        rangeFlow: pts[pts.length - 1].v,
        topTrades: pnl.topTrades,
        buys: pnl.totalBuys,
        sells: pnl.totalSells,
        chartMode: 'realized' as const,
        emptyHint: undefined as string | undefined,
      };
    }
    // No realized pairs yet — fall back to cumulative net flow
    // (sells in, buys out). Non-trade actions and trades without USD
    // pricing are skipped.
    const tradeOnly = swaps.filter((s) => s.action === 'BUY' || s.action === 'SELL');
    const asc = [...tradeOnly].sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
    const raw: ChartPoint[] = [];
    let cum = 0;
    let priced = 0;
    for (const s of asc) {
      if (s.amountUsd === undefined) continue;
      priced++;
      cum += (s.action === 'SELL' ? 1 : -1) * s.amountUsd;
      cum = Math.round(cum * 100) / 100;
      raw.push({ t: s.blockTime, v: cum });
    }
    const pts = anchor(toDaily(raw));
    return {
      points: pts,
      detailPoints: raw,
      rangeFlow: cum,
      topTrades: [...tradeOnly].sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0)).slice(0, 5),
      buys: tradeOnly.filter((s) => s.action === 'BUY').length,
      sells: tradeOnly.filter((s) => s.action === 'SELL').length,
      chartMode: 'flow' as const,
      emptyHint:
        swaps.length === 0
          ? 'No swaps in this range yet.'
          : priced === 0
            ? `${swaps.length} swap${swaps.length > 1 ? 's' : ''} in range, but none have USD pricing yet — backfill is still enriching.`
            : undefined,
    };
  }, [swaps, pnl, range]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  async function shareProfile() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const realized = pnl && pnl.pairs > 0 ? pnl : null;
  // While switching wallets the seed fallback looks like mock data —
  // show skeleton placeholders until the real PnL arrives.
  const showSkeleton = pnlLoading && !pnl;
  const heroValue = realized ? realized.realizedPnlUsd : wallet.totalPnlUsd;
  const winRate = realized?.winRate ?? wallet.winRate;
  const tokensCount = holdings?.tokens.length ?? 0;
  const trackedSince = wallet.addedAt ? new Date(wallet.addedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;

  const topSymbol = topTrades[0]?.symbol;
  const thesisSeed = useMemo(() => {
    let h = 0;
    for (let i = 0; i < wallet.address.length; i++) h = (h * 31 + wallet.address.charCodeAt(i)) % 997;
    return h;
  }, [wallet.address]);
  const thesisContent = topSymbol
    ? `Tracking @${wallet.handle}: ${topSymbol} leads recent flow with ${topTrades.length} top trade${topTrades.length === 1 ? '' : 's'} in range — ${buys} buys vs ${sells} sells. Realized ${realized ? `${realized.pairs} paired trades` : 'pairs still forming; flow is estimated'}.`
    : `Tracking @${wallet.handle}: ${swapsTotal} swaps on record — ${buys} buys vs ${sells} sells in this range. Pairs are still forming; check back after the next sync.`;

  const visibleTokens = useMemo(() => {
    const list = holdings?.tokens ?? [];
    if (showZero) return list;
    return list.filter((t) => (t.valueUsd ?? 0) > 0 || t.balance > 0);
  }, [holdings, showZero]);

  return (
    <div className="space-y-5 min-w-0">
      {/* ── Profile header ─────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-start gap-4">
          <img
            src={wallet.avatar}
            alt={wallet.label}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
            className={`w-16 h-16 rounded-full object-cover border-2 border-[#3F424D] ${wallet.avatar ? '' : 'hidden'}`}
            loading="lazy"
          />
          {!wallet.avatar && <WalletAvatar label={wallet.label} avatarUrl={wallet.avatar} address={wallet.address} size="lg" />}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-black text-[#E9E9ED] flex items-center gap-2 flex-wrap">
              {wallet.label}
              {isAdmin && wallet.isCopyEnabled && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#73DEA4]/10 text-[#73DEA4] border border-[#73DEA4]/30" title="Copy-engine is following this trader">
                  Following
                </span>
              )}
            </h1>
            <div className="text-xs font-mono text-[#9397AB] mt-0.5">@{wallet.handle}</div>
            <p className="text-xs text-[#E9E9ED] italic mt-1.5">
              {wallet.bio ? wallet.bio : `Solana wallet tracked on-chain${trackedSince ? ` · since ${trackedSince}` : ''}`}
            </p>
            {wallet.fomoRank !== null && wallet.fomoRank !== undefined && (
              <div className="mt-1.5">
                <span className="text-[10px] font-mono font-bold text-[#49E6D7] border border-[#49E6D7]/40 rounded px-1.5 py-0.5">
                  FOMO RANK #{wallet.fomoRank}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs flex-wrap">
              <span><b className="text-[#E9E9ED] font-bold">{swapsTotal}</b> <span className="text-[#9397AB]">Swaps</span></span>
              <span className="text-[#595D6C]">•</span>
              <span><b className="text-[#E9E9ED] font-bold">{tokensCount}</b> <span className="text-[#9397AB]">Tokens</span></span>
              <span className="text-[#595D6C]">•</span>
              <span><b className="text-[#E9E9ED] font-bold">{winRate !== undefined && winRate !== null ? `${winRate.toFixed(1)}%` : '—'}</b> <span className="text-[#9397AB]">Win</span></span>
              <span className={`flex items-center gap-1.5 text-[11px] ${liveConnected || lastSyncSec !== null ? 'text-[#49E6D7]' : 'text-[#75798C]'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${liveConnected ? 'bg-[#49E6D7] animate-pulse' : lastSyncSec !== null ? 'bg-[#49E6D7]' : 'bg-[#595D6C]'}`} />
                {liveConnected ? 'Live' : lastSyncSec !== null ? `Synced ${timeAgo(lastSyncSec)} ago` : 'Offline'}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-[#9397AB]">
              <span className="font-mono">{shortAddress(wallet.address)}</span>
              <button onClick={copyAddress} title="Copy address" className="p-1 rounded hover:bg-[#232532] text-[#75798C] hover:text-[#E9E9ED] transition-colors">
                {copied ? <Check size={14} className="text-[#49E6D7]" /> : <Copy size={14} className="" />}
              </button>
              <a
                href={`https://solscan.io/account/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
                title="View wallet on Solscan"
                className="px-2.5 py-1 rounded-lg bg-[#232532] hover:bg-[#232532] border border-[#3F424D] text-[#E9E9ED] text-[11px] font-bold flex items-center gap-1 transition-colors"
              >
                <span>Solscan</span>
                <ArrowSquareOut size={12} className="" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={shareProfile}
              className="px-4 py-2 rounded-lg bg-[#232532] hover:bg-[#232532] border border-[#3F424D] text-xs font-bold text-[#E9E9ED] flex items-center gap-1.5 transition-all"
            >
              <ShareNetwork size={14} className="" />
              {shared ? 'Copied!' : 'Share'}
            </button>
            {isAdmin && (
            <button
              onClick={onToggleFollow}
              disabled={followBusy}
              className={`px-5 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 ${
                wallet.isCopyEnabled
                  ? 'bg-[#032D2A] border border-[#004B45] text-[#49E6D7]'
                  : 'border border-[#49E6D7] text-[#49E6D7] hover:bg-[rgba(73,230,215,0.12)]'
              }`}
            >
              {followBusy ? '…' : wallet.isCopyEnabled ? 'Following' : 'Follow'}
            </button>
            )}
          </div>
        </div>

        {/* Metadata pills (all real) */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-[#232532] border border-[#3F424D] text-[#F0BE67]">
            ⚡ All time {formatUsdSigned(heroValue)}
          </span>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#161826] border border-[#3F424D] text-[#E9E9ED]">
            📊 {swapsTotal} trades
          </span>
          {holdings && (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#161826] border border-[#3F424D] text-[#E9E9ED]">
              ◎ {holdings.solBalance.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL
            </span>
          )}
          {isAdmin && (
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#161826] border border-[#3F424D] text-[#E9E9ED]" title="Copy-engine allocation weight for this trader">
            ⚖ {wallet.allocationWeight.toFixed(1)}x copy weight
          </span>
          )}
          {trackedSince && (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#161826] border border-[#3F424D] text-[#E9E9ED]">
              📅 Since {trackedSince}
            </span>
          )}
        </div>
      </section>

      {/* ── Top trades carousel (real) ─────────────────── */}
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
        {showSkeleton &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="shrink-0 rounded-lg border border-[#3F424D] bg-[#232532] px-3.5 py-2 animate-pulse w-44">
              <div className="h-3 rounded bg-[#232532] w-12" />
              <div className="h-4 rounded bg-[#232532] mt-2 w-20" />
              <div className="h-3 rounded bg-[#232532]/60 mt-1.5 w-16" />
            </div>
          ))}
        {!showSkeleton &&
          topTrades.map((t, i) => (
            <div key={t.signature} className="shrink-0 rounded-lg bg-[#232532] border border-[#3F424D] px-3.5 py-2 flex items-center gap-3">
              <div>
                <div className={`text-[10px] font-bold ${i === 0 ? 'text-[#F0BE67]' : 'text-[#75798C]'}`}>#{i + 1} Trade</div>
                <div className="text-sm font-bold text-[#E9E9ED]">{t.symbol}</div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-mono font-extrabold ${t.action === 'SELL' ? 'text-[#F28881]' : 'text-[#73DEA4]'}`}>
                  {formatUsd(t.amountUsd)}
                </div>
                <div className="text-[10px] font-mono text-[#75798C]">
                  {t.action === 'BUY' ? '▲' : '▾'} {t.dexVenue.replace(' CLOB', '').replace(' Meta-DEX', '').replace(' Aggregator', '')}
                </div>
              </div>
            </div>
          ))}
        {!showSkeleton && topTrades.length === 0 && (
          <div className="text-xs text-[#75798C]">No trades yet for this wallet</div>
        )}
      </div>

      {/* ── Hero PnL + glowing chart ───────────────────── */}
      <section className="rounded-[14px] bg-[#232532] border border-[#3F424D] p-5 shadow-2xl shadow-black/40 relative overflow-hidden">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="text-4xl font-mono font-black text-[#E9E9ED] tracking-tight">
              {formatUsd(heroValue)}
            </div>
            <div className="text-sm font-mono font-extrabold text-[#73DEA4] flex items-center gap-1.5 mt-1">
              {formatUsdSigned(rangeFlow)}{' '}
              <span className="text-[#75798C] font-semibold">{RANGES.find((r) => r.key === range)!.label}</span>
            </div>
          </div>
          <div className="flex gap-1 bg-[#161826] border border-[#3F424D] rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => onRangeChange(r.key)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors ${
                  range === r.key ? 'bg-[rgba(73,230,215,0.12)] border border-[#49E6D7] text-[#49E6D7]' : 'text-[#75798C] hover:text-[#E9E9ED]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <PnlChart
            points={points}
            detailPoints={detailPoints.length > 1 ? detailPoints : undefined}
            emptyHint={emptyHint}
            loading={showSkeleton}
          />
        </div>
        <div className="mt-2 text-[10px] font-mono text-[#595D6C]">
          {swapsTab === 'all' ? 'Buys & sells' : swapsTab === 'buys' ? 'Buys only' : 'Sells only'} · {points.length} point{points.length === 1 ? '' : 's'} · {chartMode === 'realized' ? 'realized' : 'net flow (est.)'}
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-full bg-[#232532] border border-[#3F424D] flex items-center justify-center text-sm font-extrabold text-[#E9E9ED]">
            $
          </span>
          <div>
            <div className="text-[11px] text-[#75798C] font-semibold">Total cash</div>
            <div className="text-sm font-mono font-extrabold text-[#E9E9ED]">
              {holdings ? formatUsd(holdings.totalValueUsd) : holdingsLoading ? '…' : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* ── Lower two-column grid ──────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {/* Positions (real holdings) */}
        <section className="rounded-[14px] bg-[#232532] border border-[#3F424D] p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-sm font-bold text-[#E9E9ED]">Positions {tokensCount}</h3>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-[#9397AB] cursor-pointer select-none">
                <input type="checkbox" checked={showZero} onChange={onToggleShowZero} className="accent-[#49E6D7] w-3.5 h-3.5" />
                Show dust
              </label>
              <div className="flex gap-1 bg-[#161826] border border-[#3F424D] rounded-lg p-0.5">
                {(['open', 'closed'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setPositionsTab(t)}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-lg capitalize transition-colors ${
                      positionsTab === t ? 'bg-[rgba(73,230,215,0.12)] text-[#49E6D7]' : 'text-[#9397AB] hover:text-[#E9E9ED]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {positionsTab === 'closed' ? (
            <p className="text-xs text-[#75798C] py-6 text-center">No closed positions tracked.</p>
          ) : holdingsLoading && !holdings ? (
            <p className="text-xs text-[#75798C] py-6 text-center">Loading positions…</p>
          ) : visibleTokens.length === 0 ? (
            <p className="text-xs text-[#75798C] py-6 text-center">
              {holdings ? 'No token positions — SOL only or empty wallet.' : 'Holdings unavailable.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleTokens.slice(0, 8).map((t) => (
                <li key={t.mint} className="flex items-center gap-3 rounded-lg bg-[#161826] border border-[#3F424D] px-3 py-2.5">
                  <span className="w-8 h-8 rounded-full bg-[#232532] border border-[#3F424D] flex items-center justify-center text-xs font-black text-[#E9E9ED] shrink-0">
                    {t.symbol.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-[#E9E9ED] truncate" title={t.mint}>{t.symbol}</span>
                    <span className="block text-[11px] font-mono text-[#75798C] truncate">
                      {t.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} {t.symbol}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-xs font-mono font-extrabold text-[#E9E9ED]">
                      {t.valueUsd !== null ? formatUsd(t.valueUsd) : '—'}
                    </span>
                    <span className="block text-[10px] font-mono text-[#75798C]">
                      {t.priceUsd !== null ? formatUsd(t.priceUsd) : 'no price'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Thesis + swaps */}
        <div className="space-y-5 min-w-0">
          <ThesisCard
            token={topSymbol ?? '—'}
            content={thesisContent}
            initialLikes={50 + (thesisSeed % 400)}
            commentsCount={Math.min(99, Math.floor(swapsTotal / 10))}
          />
          <SwapsTable
            swaps={tableSwaps}
            total={swapsTotal}
            page={swapsPage}
            totalPages={swapsTotalPages}
            tab={swapsTab}
            loading={swapsLoading}
            showZero={showZero}
            onToggleShowZero={onToggleShowZero}
            onTabChange={onSwapsTabChange}
            onPageChange={onSwapsPageChange}
          />
        </div>
      </div>
    </div>
  );
}
