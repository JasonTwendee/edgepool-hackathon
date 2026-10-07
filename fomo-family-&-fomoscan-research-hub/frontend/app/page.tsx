'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { listPools, type PoolSummary } from '../lib/api';
import { SiteFooter, SiteHeader } from '../components/SiteHeader';

type Period = 'day' | 'week' | 'month' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  if (points.length < 2) return <div style={{ height: 72 }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 160;
  const h = 72;
  const step = w / (points.length - 1);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`).join(' ');
  const color = positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

const PERIOD_NOUN: Record<Period, string> = { day: 'DAY', week: 'WEEK', month: 'MONTH', all: 'TIME' };

function PoolCard({ pool, period, index }: { pool: PoolSummary; period: Period; index: number }) {
  const featured = pool.kind === 'basket';
  const pnl = pool.pnl[period];
  const positive = pnl.sol >= 0;
  const left = Math.max(0, pool.slots.max - pool.slots.used);
  const full = left <= 0 && !pool.myHolding;
  const signalPct = featured ? 10 : 15;
  const meterColor = left <= 0
    ? 'var(--ep-neg, #F28881)'
    : left <= Math.max(5, pool.slots.max * 0.1)
      ? 'var(--ep-amber, #F0BE67)'
      : 'var(--ep-aqua, #49E6D7)';
  return (
    <article
      className={`pool-card ep-enter`}
      style={{
        borderRadius: 18,
        padding: 22,
        background: featured
          ? 'radial-gradient(circle at top right, rgba(3,45,42,0.75), rgba(3,45,42,0) 60%), var(--ep-surface, #1D1F2C)'
          : 'radial-gradient(circle at top right, rgba(43,39,65,0.55), rgba(43,39,65,0) 60%), var(--ep-surface, #1D1F2C)',
        animationDelay: `${Math.min(index, 7) * 55}ms`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
          {pool.status === 'live' ? 'LIVE' : 'PAUSED'} · {featured ? 'FLAGSHIP' : 'PARTNER'}
        </span>
        {pool.myHolding && (
          <span
            className="font-mono text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: 'var(--ep-aqua-deep, #032D2A)', color: 'var(--ep-aqua-100, #BBF6EE)' }}
          >
            You hold {pool.myHolding.valueSol.toFixed(2)} SOL
          </span>
        )}
      </div>
      <h2 className="font-display text-2xl font-medium mt-2" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
        {pool.name}
      </h2>
      <p className="text-xs mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        {featured ? 'Edgepool basket · algorithm-ranked traders' : `Partner pool · @${pool.traders[0]?.handle ?? 'partner'}`}
      </p>
      <div className="flex items-center gap-2 mt-3">
        <div className="flex" style={{ marginLeft: 0 }}>
          {pool.traders.slice(0, 5).map((t) => (
            <span
              key={t.wallet}
              title={`@${t.handle}${t.rank ? ` · rank #${t.rank}` : ''}`}
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold -ml-2 first:ml-0 border"
              style={{ background: 'var(--ep-violet-tint, #2B2741)', color: 'var(--ep-violet-100, #D2CEFD)', borderColor: 'var(--ep-surface, #1D1F2C)' }}
            >
              {(t.handle || '?').slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
        <span className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          {pool.traders.length} traders · {signalPct}% to signal trader
        </span>
      </div>
      <div className="flex items-end justify-between gap-2 mt-3">
        <div>
          <div className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>
            PNL · THIS {PERIOD_NOUN[period]}
          </div>
          <div key={period} className="ep-fade font-mono whitespace-nowrap" style={{ fontSize: 24, color: positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
            {positive ? '+' : ''}{pnl.pct.toFixed(1)}% <span className="text-sm">({positive ? '+' : ''}{pnl.sol.toFixed(2)})</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm whitespace-nowrap" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
            NAV {pool.navSol.toFixed(2)}
          </div>
          <Sparkline points={pool.spark.length >= 2 ? pool.spark : [pool.pnl.day.sol, pool.pnl.week.sol, pool.pnl.month.sol, pool.pnl.all.sol]} positive={positive} />
        </div>
      </div>
      <div className="mt-2 text-[11px] font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>
        Depositor slots · {left} of {pool.slots.max} left
      </div>
      <div className="mt-1.5 rounded-full overflow-hidden" style={{ height: 6, background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (pool.slots.used / Math.max(1, pool.slots.max)) * 100)}%`, background: meterColor }}
        />
      </div>
      <Link
        href={`/pools/${pool.id}`}
        className="mt-4 flex items-center justify-center gap-1.5 text-sm font-bold px-4 py-2.5"
        style={
          full
            ? { border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)', borderRadius: 10 }
            : featured
              ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18', borderRadius: 10 }
              : { border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua, #49E6D7)', borderRadius: 10 }
        }
      >
        {full ? 'Full · view pool' : 'Open pool'} <ArrowRight size={15} weight="bold" />
      </Link>
    </article>
  );
}

function PoolSkeleton({ index }: { index: number }) {
  return (
    <div
      className="ep-enter"
      style={{
        borderRadius: 18,
        padding: 22,
        background: 'var(--ep-surface, #1D1F2C)',
        boxShadow: '0 0 0 1px var(--ep-border, #2E313F)',
        animationDelay: `${Math.min(index, 7) * 55}ms`,
      }}
      aria-hidden
    >
      <div className="ep-skel" style={{ width: 120, height: 11 }} />
      <div className="ep-skel mt-3" style={{ width: '70%', height: 26 }} />
      <div className="ep-skel mt-2" style={{ width: '45%', height: 12 }} />
      <div className="flex items-center gap-2 mt-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="ep-skel rounded-full" style={{ width: 28, height: 28, borderRadius: 999 }} />
        ))}
      </div>
      <div className="ep-skel mt-4" style={{ width: '55%', height: 30 }} />
      <div className="ep-skel mt-3" style={{ width: '100%', height: 72 }} />
      <div className="ep-skel mt-3" style={{ width: '100%', height: 6 }} />
      <div className="ep-skel mt-4" style={{ width: 110, height: 36 }} />
    </div>
  );
}

function ComingSoonCard() {
  const [notified, setNotified] = useState(false);
  return (
    <div
      className="flex flex-col items-start justify-center gap-3"
      style={{
        borderRadius: 18,
        padding: 22,
        border: '1px dashed var(--ep-border-strong, #3F424D)',
        minHeight: 280,
      }}
    >
      <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        COMING SOON
      </span>
      <h2 className="font-display text-2xl font-medium" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
        Basket 02
      </h2>
      <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        Next Edgepool basket · algorithm-ranked traders.
      </p>
      <button
        onClick={() => setNotified((n) => !n)}
        className="text-sm font-bold px-4 py-2"
        style={
          notified
            ? { color: 'var(--ep-muted, #9397AB)' }
            : { border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua, #49E6D7)', borderRadius: 10 }
        }
      >
        {notified ? "You'll be notified" : 'Notify me'}
      </button>
    </div>
  );
}

export default function PoolsPage() {  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPools()
      .then((r) => setPools(r.data.filter((p) => p.listing === 'public')))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <SiteHeader active="pools" />
      <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 0' }}>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-medium" style={{ fontSize: 'clamp(30px,4vw,44px)', letterSpacing: '-0.03em', color: 'var(--ep-text, #E9E9ED)' }}>
            Pools
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
            Each pool copies its own basket of ranked onchain traders under fixed risk rules. Signals unlock with a 0.5 SOL deposit.
          </p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg"
              style={
                period === p.key
                  ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }
                  : { color: 'var(--ep-muted, #9397AB)' }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs mt-4" style={{ color: 'var(--ep-neg, #F28881)' }}>{error}</p>}

      <div className="grid gap-4 mt-4 pb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,360px),1fr))' }}>
        {loading
          ? [0, 1, 2, 3, 4].map((i) => <PoolSkeleton key={i} index={i} />)
          : pools.map((p, i) => <PoolCard key={p.id} pool={p} period={period} index={i} />)}
        {!loading && <ComingSoonCard />}
      </div>

      <SiteFooter />
    </div>
    </>
  );
}
