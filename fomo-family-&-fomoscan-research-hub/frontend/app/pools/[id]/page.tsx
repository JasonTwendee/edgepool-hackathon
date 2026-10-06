'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  getAuthMe,
  getPoolDetail,
  queueVaultDeposit,
  type PoolDetail,
} from '../../../lib/api';
import { getStoredToken } from '../../../lib/api';

type Period = 'day' | 'week' | 'month' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

const STEP_STYLE: Record<string, { bg: string; fg: string }> = {
  done: { bg: '#004B45', fg: '#BBF6EE' },
  waiting: { bg: '#2E313F', fg: '#B2B6CA' },
  skipped: { bg: '#4A3B1C', fg: '#F7DDA9' },
  failed: { bg: '#4A3B1C', fg: '#F7DDA9' },
  tp: { bg: '#2B2741', fg: '#D2CEFD' },
  stopped: { bg: '#3A2226', fg: '#F7C1BC' },
};


export default function PoolDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    try {
      const res = await getPoolDetail(id);
      setPool(res.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60000);
    return () => clearInterval(t);
  }, [refresh]);

  async function deposit() {
    if (busy || !pool) return;
    const token = getStoredToken();
    if (!token) {
      setMsg('Sign in first (login wall).');
      return;
    }
    const amt = Number(amount);
    if (!(amt >= 0.5)) {
      setMsg('Minimum deposit is 0.5 SOL.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const me = await getAuthMe(token);
      const res = await queueVaultDeposit({ vaultId: pool.id, depositor: me.data.wallet, amountSol: amt }, token);
      setMsg(`Deposit #${res.data.id} queued — settles at next epoch price.`);
      setAmount('');
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px)' }}>
        <Link href="/" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
        <p className="mt-4 text-sm" style={{ color: 'var(--ep-neg, #F28881)' }}>{error}</p>
      </div>
    );
  }
  if (!pool) {
    return (
      <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px)' }}>
        <p className="text-sm" style={{ color: 'var(--ep-muted, #9397AB)' }}>Loading pool…</p>
      </div>
    );
  }

  const pnl = pool.pnl[period];
  const positive = pnl.sol >= 0;
  const myVal = pool.myHolding?.valueSol ?? 0;
  const locked = pool.masked;
  const pts = pool.navSeries.slice(-60);
  const min = pts.length ? Math.min(...pts.map((p) => p.v)) : 0;
  const max = pts.length ? Math.max(...pts.map((p) => p.v)) : 1;
  const span = max - min || 1;
  const W = 600;
  const H = 120;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - 6 - ((p.v - min) / span) * (H - 12)).toFixed(1)}`).join(' ');

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }}>
      <Link href="/" className="text-sm" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
      {pool.status === 'paused' && (
        <div className="mt-3 text-xs font-bold px-3 py-2 rounded-lg" style={{ background: 'rgba(240,190,103,0.12)', color: 'var(--ep-amber, #F0BE67)', boxShadow: '0 0 0 1px var(--ep-amber, #F0BE67)' }}>
          This pool is paused by the owner — no new positions. Withdrawals still work.
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
          ● {pool.status === 'live' ? 'LIVE' : 'PAUSED'} · {pool.kind === 'basket' ? 'FLAGSHIP' : 'PARTNER'}
        </span>
      </div>
      <h1 className="font-display font-medium" style={{ fontSize: 'clamp(28px,3.5vw,40px)', letterSpacing: '-0.03em' }}>{pool.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        {pool.kind === 'basket' ? 'Edgepool basket · algorithm-picked traders' : 'Partner pool'} · {pool.traders.length} traders · {pool.slots.used}/{pool.slots.max} slots
      </p>
      <div className="flex gap-2 mt-3 flex-wrap">
        {['2% cap per trader', '50% now + 50% limit at −10%', 'Adaptive stop', '−5% daily kill switch'].map((r) => (
          <span key={r} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', color: 'var(--ep-text-3, #B2B6CA)' }}>{r}</span>
        ))}
      </div>

      <div className="grid gap-4 mt-5" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(300px,360px)' }}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} className="text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={period === p.key ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { color: 'var(--ep-muted, #9397AB)' }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="font-mono mt-2" style={{ fontSize: 'clamp(26px,3vw,34px)', color: positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
              {positive ? '+' : ''}{pnl.sol.toFixed(2)} SOL ({positive ? '+' : ''}{pnl.pct.toFixed(1)}%)
            </div>
            {pts.length > 1 && (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2" style={{ height: 120 }} aria-hidden>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--ep-border, #2E313F)" strokeWidth={1} />
                ))}
                <path d={`${d} L${W},${H} L0,${H} Z`} fill={positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'} opacity={0.1} />
                <path d={d} fill="none" stroke={positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'} strokeWidth={2} strokeLinecap="round" />
              </svg>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
              {[
                ['Pool NAV', `${pool.navSol.toFixed(2)} SOL`],
                ['NAV/share', pool.navPerShare.toFixed(4)],
                ['My value', `${myVal.toFixed(4)} SOL`],
                ['Since inception', `${pool.pnl.all.sol >= 0 ? '+' : ''}${pool.pnl.all.sol.toFixed(2)}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg p-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <div className="text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{k}</div>
                  <div className="text-xs font-mono font-bold" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{v}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h2 className="font-display text-base font-medium">Open positions {pool.openCount > 0 && `(${pool.openCount})`}</h2>
            {pool.openPositions.length === 0 ? (
              <p className="text-xs mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                No open positions. This pool is flat, so withdrawals are instant.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {pool.openPositions.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                    <span className="font-bold">{locked ? '$••••' : p.token}</span>
                    <span style={{ color: 'var(--ep-muted, #9397AB)' }}>{locked ? 'Trader •' : p.trader} · {p.stage}</span>
                    <span className="font-mono" style={{ color: (p.unrealizedPct ?? 0) >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                      {locked ? '•••' : p.unrealizedPct === null ? '—' : `${p.unrealizedPct >= 0 ? '+' : ''}${p.unrealizedPct.toFixed(1)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h2 className="font-display text-base font-medium">Live signals</h2>
            <div className="mt-2 space-y-2">
              {pool.signals.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No signals in the recent window.</p>
              )}
              {pool.signals.slice(0, 8).map((s, i) => (
                <div key={i} className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <div className="flex justify-between">
                    <b>{locked ? '$••••' : s.token}</b>
                    <span style={{ color: 'var(--ep-faint, #75798C)' }}>{s.ageSec < 3600 ? `${Math.floor(s.ageSec / 60)}m ago` : `${Math.floor(s.ageSec / 3600)}h ago`}</span>
                  </div>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {s.steps.map((st, j) => {
                      const c = STEP_STYLE[st.state] ?? STEP_STYLE.waiting;
                      return (
                        <span key={j} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.fg }}>
                          {st.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h2 className="font-display text-base font-medium">Trader basket</h2>
            <ul className="mt-2 space-y-2">
              {pool.traders.map((t) => (
                <li key={t.wallet} className="flex items-center justify-between text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <span className="font-bold">@{locked ? 'Trader •' : t.handle}</span>
                  <span className="font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                    {t.rank ? `rank #${t.rank}` : 'unranked'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          {pool.myHolding && pool.myHolding.shares > 0 && (
            <section className="rounded-2xl p-5" style={{ background: 'var(--ep-aqua-deep, #032D2A)', boxShadow: '0 0 0 1px var(--ep-aqua, #49E6D7)' }}>
              <h2 className="font-display text-base font-medium">My position</h2>
              <div className="font-mono text-2xl mt-1">{pool.myHolding.valueSol.toFixed(4)} SOL</div>
              <div className="text-xs font-mono mt-1" style={{ color: 'var(--ep-aqua-100, #BBF6EE)' }}>
                {pool.myHolding.returnsSol >= 0 ? '+' : ''}{pool.myHolding.returnsSol.toFixed(4)} SOL · {pool.myHolding.shares.toFixed(2)} shares · deposited {pool.myHolding.depositedSol.toFixed(2)}
              </div>
            </section>
          )}
          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h2 className="font-display text-base font-medium">Deposit</h2>
            <div className="text-xs font-mono mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              NAV {pool.navSol.toFixed(2)} · {pool.navPerShare.toFixed(4)}/share · {pool.slots.used}/{pool.slots.max} slots
            </div>
            <div className="flex gap-2 mt-3">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                inputMode="decimal"
                className="flex-1 min-w-0 font-mono text-xl px-3 py-2 rounded-lg outline-none"
                style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}
              />
              <button onClick={() => setAmount('0.5')} className="text-xs font-bold px-3 rounded-lg" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                Min
              </button>
            </div>
            <button
              onClick={() => void deposit()}
              disabled={busy}
              className="w-full mt-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}
            >
              Deposit SOL
            </button>
            {msg && <p className="text-[11px] mt-2" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}
            <ul className="text-[11px] mt-3 space-y-1" style={{ color: 'var(--ep-faint, #75798C)' }}>
              <li>· 2% cap per trader</li>
              <li>· −5% daily kill switch</li>
              <li>· 20% fee on new profit above HWM, no management fee</li>
              <li>· {pool.openCount === 0 ? 'Pool is flat — withdrawals are instant' : 'Withdrawals queue and settle at checkpoint'}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

