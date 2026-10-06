'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listPools, type PoolSummary } from '../lib/api';

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

function PoolCard({ pool, period }: { pool: PoolSummary; period: Period }) {
  const featured = pool.kind === 'basket';
  const pnl = pool.pnl[period];
  const positive = pnl.sol >= 0;
  const slotsLeft = Math.max(0, pool.slots.max - pool.slots.used);
  const full = slotsLeft <= 0 && !pool.myHolding;
  // 4-point sparkline from period PnL (P1; full NAV series lands in P2 detail).
  const pts = [pool.pnl.day.sol, pool.pnl.week.sol, pool.pnl.month.sol, pool.pnl.all.sol];
  return (
    <article
      style={{
        borderRadius: 18,
        padding: 22,
        background: 'var(--ep-surface, #1D1F2C)',
        boxShadow: featured
          ? '0 0 0 1px var(--ep-aqua, #49E6D7), inset 0 0 60px rgba(3,45,42,0.75)'
          : '0 0 0 1px var(--ep-border, #2E313F)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
          {pool.status === 'live' ? 'LIVE' : 'PAUSED'} · {featured ? 'FLAGSHIP' : 'PARTNER'}
        </span>
        {pool.myHolding && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
            You hold {pool.myHolding.valueSol.toFixed(2)} SOL
          </span>
        )}
      </div>
      <h2 className="font-display text-2xl font-medium mt-2" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
        {pool.name}
      </h2>
      <p className="text-xs mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        {featured ? 'Edgepool basket · algorithm-picked traders' : 'Partner pool'}
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
          {pool.traders.length} traders
        </span>
      </div>
      <div className="flex items-end justify-between mt-3">
        <div className="font-mono text-2xl" style={{ color: positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
          {positive ? '+' : ''}{pnl.sol.toFixed(2)} <span className="text-sm">({positive ? '+' : ''}{pnl.pct.toFixed(1)}%)</span>
        </div>
        <Sparkline points={pts} positive={positive} />
      </div>
      <div className="mt-2 text-[11px] font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>
        NAV {pool.navSol.toFixed(2)} SOL · {pool.slots.used}/{pool.slots.max} slots
      </div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (pool.slots.used / Math.max(1, pool.slots.max)) * 100)}%`, background: full ? 'var(--ep-neg, #F28881)' : 'var(--ep-aqua, #49E6D7)' }}
        />
      </div>
      <Link
        href={`/pools/${pool.id}`}
        className="mt-4 inline-block text-sm font-bold px-4 py-2 rounded-lg"
        style={
          full
            ? { border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }
            : featured
              ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }
              : { border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua, #49E6D7)' }
        }
      >
        {full ? 'Full · view pool' : 'Open pool →'}
      </Link>
    </article>
  );
}

export default function PoolsPage() {
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPools()
      .then((r) => setPools(r.data.filter((p) => p.listing === 'public')))
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 0' }}>
      <header className="sticky top-0 z-40 -mx-[clamp(16px,4vw,40px)] px-[clamp(16px,4vw,40px)]" style={{ height: 64, background: 'rgba(22,24,38,0.9)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--ep-border, #2E313F)' }}>
        <div className="h-full flex items-center justify-between" style={{ maxWidth: 1240, margin: '0 auto' }}>
          <img src="/brand/edgepool-horizontal-dark.svg" alt="edgepool" style={{ height: 26 }} />
          <nav className="flex items-center gap-1">
            <span className="text-sm font-medium px-3 h-9 flex items-center" style={{ color: 'var(--ep-text, #E9E9ED)' }}>Pools</span>
            <span className="text-sm px-3 h-9 hidden sm:flex items-center" style={{ color: 'var(--ep-muted, #9397AB)' }} title="Coming in P3">Portfolio</span>
            <span className="text-sm px-3 h-9 hidden sm:flex items-center" style={{ color: 'var(--ep-muted, #9397AB)' }} title="Coming in P4">Trader</span>
            <Link href="/terminal" className="text-sm px-3 h-9 hidden sm:flex items-center" style={{ color: 'var(--ep-muted, #9397AB)' }} title="Operator terminal (admin)">Terminal</Link>
          </nav>
        </div>
      </header>

      <h1 className="font-display font-medium" style={{ fontSize: 'clamp(30px,4vw,44px)', letterSpacing: '-0.03em', color: 'var(--ep-text, #E9E9ED)' }}>
        Pools
      </h1>
      <p className="text-sm mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        Each pool copies its own basket of ranked onchain traders under fixed risk rules. Signals unlock with a 0.5 SOL deposit.
      </p>

      <div className="flex gap-1 mt-4">
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

      {error && <p className="text-xs mt-4" style={{ color: 'var(--ep-neg, #F28881)' }}>{error}</p>}

      <div className="grid gap-4 mt-4 pb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,360px),1fr))' }}>
        {pools.map((p) => (
          <PoolCard key={p.id} pool={p} period={period} />
        ))}
      </div>

      <footer className="text-xs pb-8" style={{ color: 'var(--ep-faint, #75798C)' }}>
        Past performance does not indicate future results. Memecoin trading carries a high risk of loss.
      </footer>
    </div>
  );
}
