'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { LockKey, XLogo } from '@phosphor-icons/react';
import {
  getPoolDetail,
  queueVaultDeposit,
  depositChallenge,
  type PoolDetail,
} from '../../../lib/api';
import { getStoredToken } from '../../../lib/api';
import { connectBrowserWallet, getInjectedProvider, signWithBrowserWallet } from '../../../lib/solana';
import { SiteFooter, SiteHeader } from '../../../components/SiteHeader';
import { Toaster, toast } from '../../../components/Toaster';

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
  const search = useSearchParams();
  const id = Number(params.id);
  const advanced = search.get('view') === 'advanced';
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);

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
    setHasWallet(getInjectedProvider() !== null);
    const t = setInterval(() => void refresh(), 180000);
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
      // Wallet-signed flow (demo custody bridge): the wallet signs a BE
      // challenge; BE books paper against the verified wallet. No funds move
      // on-chain. Falls back to a session deposit when no wallet is installed.
      let message: string | undefined;
      let signature: string | undefined;
      let signedBy: string | null = null;
      try {
        const wallet = await connectBrowserWallet();
        const ch = await depositChallenge({ vaultId: pool.id, amountSol: amt, wallet }, token);
        const sig = await signWithBrowserWallet(ch.data.message);
        message = ch.data.message;
        signature = sig.signature;
        signedBy = sig.wallet;
      } catch (e) {
        setMsg(`Wallet signing unavailable (${(e as Error).message}) — continuing as a session deposit.`);
      }
      const res = await queueVaultDeposit({ vaultId: pool.id, amountSol: amt, message, signature }, token);
      setMsg(
        `Deposit #${res.data.id} queued — settles at next epoch price.` +
          (signedBy ? ` Signed by ${signedBy.slice(0, 4)}…${signedBy.slice(-4)} (paper, no funds moved).` : ''),
      );
      toast(`Deposited ${amt.toFixed(2)} SOL · signals unlocked`);
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
      <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }} aria-hidden>
        <div className="ep-skel" style={{ width: 90, height: 14 }} />
        <div className="ep-skel mt-4" style={{ width: 180, height: 12 }} />
        <div className="ep-skel mt-3" style={{ width: 'min(420px,80%)', height: 38 }} />
        <div className="ep-skel mt-2" style={{ width: 'min(560px,90%)', height: 14 }} />
        <div className="flex gap-2 mt-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ep-skel" style={{ width: 150, height: 24, borderRadius: 999 }} />
          ))}
        </div>
        <div className="ep-skel mt-5" style={{ width: 'min(300px,60%)', height: 40 }} />
        <div className="ep-skel mt-2" style={{ width: '100%', height: 120 }} />
        <div className="ep-pool-grid grid gap-4 mt-4">
          <div className="ep-skel" style={{ height: 220 }} />
          <div className="ep-skel" style={{ height: 220 }} />
        </div>
      </div>
    );
  }

  const pnl = pool.pnl[period];
  const positive = pnl.sol >= 0;
  const locked = pool.masked;
  const isDemo = pool.name.startsWith('demo-');
  const pts = pool.navSeries.slice(-60);
  const min = pts.length ? Math.min(...pts.map((p) => p.v)) : 0;
  const max = pts.length ? Math.max(...pts.map((p) => p.v)) : 1;
  const span = max - min || 1;
  const W = 600;
  const H = 120;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - 6 - ((p.v - min) / span) * (H - 12)).toFixed(1)}`).join(' ');
  const expByWallet: Record<string, number> = Object.fromEntries(pool.exposure.map((e) => [e.trader, e.pctNav]));

  return (
    <>
      <SiteHeader
        active="pools"
        viewToggle={
          <div className="flex rounded-lg overflow-hidden" style={{ boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            {(['calm', 'advanced'] as const).map((v) => {
              const active = (v === 'advanced') === advanced;
              const href = v === 'advanced' ? `/pools/${id}?view=advanced` : `/pools/${id}`;
              return (
                <Link key={v} href={href} scroll={false} className="text-xs font-bold px-3 py-1.5 capitalize"
                  style={active ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18', height: 38, display: 'flex', alignItems: 'center' } : { color: 'var(--ep-muted, #9397AB)', height: 38, display: 'flex', alignItems: 'center' }}>
                  {v}
                </Link>
              );
            })}
          </div>
        }
      />
      <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }}>
      <Link href="/" className="text-sm" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
      {pool.status === 'paused' && (
        <div className="mt-3 text-xs font-bold px-3 py-2 rounded-lg" style={{ background: 'rgba(240,190,103,0.12)', color: 'var(--ep-amber, #F0BE67)', boxShadow: '0 0 0 1px var(--ep-amber, #F0BE67)' }}>
          This pool is paused by the owner — no new positions. Withdrawals still work.
        </div>
      )}

      {!advanced && (
      <>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
          ● {pool.status === 'live' ? 'LIVE' : 'PAUSED'} · {isDemo ? 'DEMO' : pool.kind === 'basket' ? 'FLAGSHIP' : 'PARTNER'}
        </span>
      </div>
      <h1 className="font-display font-medium" style={{ fontSize: 'clamp(28px,3.5vw,40px)', letterSpacing: '-0.03em' }}>{pool.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        {isDemo
          ? 'Demo pool · scripted scenario (unlisted)'
          : pool.kind === 'basket'
            ? `Copies ${pool.traders.length} algorithm-ranked Fomo traders with the same entry, sizing and exit rules on every trade.`
            : 'Partner pool'} · {pool.traders.length} traders · {pool.slots.used}/{pool.slots.max} slots
      </p>
      <div className="flex gap-2 mt-3 flex-wrap">
        {['2% cap per trader', 'Immediate entry · 1% NAV size', 'TP1 +60% · stop −30%', '−5% daily kill switch'].map((r) => (
          <span key={r} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', color: 'var(--ep-text-3, #B2B6CA)' }}>{r}</span>
        ))}
      </div>
      </>
      )}

      {advanced && pool.advanced ? (
        <div key="advanced" className="ep-fade">
          <AdvancedView
            pool={pool}
            period={period}
            setPeriod={setPeriod}
            periodPnl={pnl}
            amount={amount}
            setAmount={setAmount}
            busy={busy}
            onDeposit={() => void deposit()}
          />
        </div>
      ) : (
      <div key="calm" className="ep-fade ep-pool-grid grid gap-4 mt-5">
        <div className="space-y-4 min-w-0">
          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <div className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>
              POOL PNL · THIS {period.toUpperCase()}
            </div>
            <div className="flex gap-1 mt-2">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} className="text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={period === p.key ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { color: 'var(--ep-muted, #9397AB)' }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div key={period} className="ep-fade font-mono mt-2" style={{ fontSize: 'clamp(26px,3vw,34px)', color: positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
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
                ['Pool NAV', `${pool.navSol.toFixed(2)} SOL`, 'var(--ep-text, #E9E9ED)'],
                ['NAV/share', pool.navPerShare.toFixed(4), 'var(--ep-aqua, #49E6D7)'],
                ['Today', `${pool.pnl.day.sol >= 0 ? '+' : ''}${pool.pnl.day.sol.toFixed(2)}`, pool.pnl.day.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
                ['Since inception', `${pool.pnl.all.sol >= 0 ? '+' : ''}${pool.pnl.all.sol.toFixed(2)}`, pool.pnl.all.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
              ].map(([k, v, c]) => (
                <div key={k} className="rounded-lg p-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <div className="text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{k}</div>
                  <div className="text-xs font-mono font-bold whitespace-nowrap" style={{ color: c as string }}>{v}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>OPEN POSITIONS{pool.openCount > 0 && ` · ${pool.openCount}`}</h2>
              {(() => {
                const tot = pool.openPositions.reduce((s, p) => s + (p.sizeSol ?? 0) * (p.unrealizedPct ?? 0) / 100, 0);
                const has = pool.openPositions.some((p) => p.sizeSol !== null && p.unrealizedPct !== null);
                if (!has) return null;
                return (
                  <span className="font-mono text-[11px]" style={{ color: tot >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                    {tot >= 0 ? '+' : ''}{tot.toFixed(2)} SOL unrealized
                  </span>
                );
              })()}
            </div>
            {pool.openPositions.length === 0 ? (
              <p className="text-xs mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                No open positions. This pool is flat, so withdrawals are instant.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {pool.openPositions.map((p, i) => {
                  const up = (p.unrealizedPct ?? 0) >= 0;
                  const sol = p.sizeSol !== null && p.unrealizedPct !== null ? (p.sizeSol * p.unrealizedPct) / 100 : null;
                  return (
                    <li key={i} className="rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold">{locked ? '$••••' : p.token}</span>
                        <span className="font-mono" style={{ color: up ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                          {p.unrealizedPct === null ? '—' : `${up ? '+' : ''}${p.unrealizedPct.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] mt-0.5" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                        <span>{locked ? 'Trader •' : p.trader} · Full size</span>
                        <span className="font-mono">{sol === null ? '•••' : `${sol >= 0 ? '+' : ''}${sol.toFixed(2)} SOL`}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>Live signals</h2>
            <div className="mt-2 space-y-2">
              {locked && (
                <div className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <LockKey size={18} style={{ color: 'var(--ep-muted, #9397AB)', flexShrink: 0 }} />
                  <p className="text-[11px] flex-1" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
                    Tokens, contract addresses and entries unlock with a 0.5 SOL deposit.
                  </p>
                  <button
                    onClick={() => document.getElementById('deposit-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0"
                    style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}
                  >
                    Unlock
                  </button>
                </div>
              )}
              {pool.signals.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No signals in the recent window.</p>
              )}
              {pool.signals.slice(0, 8).map((s, i) => (
                <div key={i} className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <div className="flex justify-between gap-2">
                    <b>{locked ? '$••••' : s.token} <span className="font-normal" style={{ color: 'var(--ep-muted, #9397AB)' }}>via {locked ? 'Trader •' : s.trader}</span></b>
                    <span className="shrink-0" style={{ color: 'var(--ep-faint, #75798C)' }}>{s.ageSec < 3600 ? `${Math.floor(s.ageSec / 60)}m` : `${Math.floor(s.ageSec / 3600)}h`}</span>
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
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                    {locked ? 'Size, price and contract address hidden' : s.detail || s.note}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>TRADER BASKET · {pool.traders.length}</h2>
              <span className="font-mono text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Rank · 24h / 7d / 30d</span>
            </div>
            <ul className="mt-2 space-y-2">
              {pool.traders.map((t) => (
                <li key={t.wallet} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                  <span className="font-bold flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: 'var(--ep-violet-tint, #2B2741)', color: 'var(--ep-violet-100, #D2CEFD)' }}>
                      {(locked ? 'T' : t.handle || '?').slice(0, 1).toUpperCase()}
                    </span>
                    @{locked ? 'Trader •' : t.handle} <XLogo size={12} style={{ color: 'var(--ep-faint, #75798C)' }} />
                  </span>
                  <span className="text-right">
                    <span className="font-mono" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
                      #{t.ranks?.h24 ?? '—'} · #{t.ranks?.d7 ?? '—'} · #{t.ranks?.d30 ?? '—'}
                    </span>
                    <span className="font-mono block" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                      {expByWallet[t.wallet] !== undefined ? `${expByWallet[t.wallet].toFixed(1)}% NAV` : 'no exposure'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4 ep-sticky-col">
          {pool.myHolding && pool.myHolding.shares > 0 && (
            <section className="rounded-2xl p-5" style={{ background: 'var(--ep-aqua-deep, #032D2A)', boxShadow: '0 0 0 1px var(--ep-aqua, #49E6D7)' }}>
              <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>My position</h2>
              <div className="font-mono text-2xl mt-1">{pool.myHolding.valueSol.toFixed(4)} SOL</div>
              <div className="text-xs font-mono mt-1" style={{ color: 'var(--ep-aqua-100, #BBF6EE)' }}>
                {pool.myHolding.returnsSol >= 0 ? '+' : ''}{pool.myHolding.returnsSol.toFixed(4)} SOL · {pool.myHolding.shares.toFixed(2)} shares · deposited {pool.myHolding.depositedSol.toFixed(2)}
              </div>
              <Link
                href="/portfolio"
                className="block text-center w-full mt-3 py-2 rounded-lg text-xs font-bold"
                style={{ border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua-100, #BBF6EE)' }}
              >
                Withdraw · {pool.openCount === 0 ? 'instant' : 'queued to checkpoint'}
              </Link>
            </section>
          )}
          <section id="deposit-panel" className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>Deposit</h2>
            <div className="text-xs font-mono mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              NAV {pool.navSol.toFixed(2)} · {pool.navPerShare.toFixed(4)}/share · {pool.slots.used}/{pool.slots.max} slots
            </div>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, (pool.slots.used / Math.max(1, pool.slots.max)) * 100)}%`, background: 'var(--ep-aqua, #49E6D7)' }}
              />
            </div>
            <div className="text-[11px] font-mono mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              {pool.slots.used} depositors in · capped to protect execution
            </div>
            <label className="block text-[11px] font-mono mt-3 tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>
              AMOUNT
            </label>
            <div className="flex gap-2 mt-1.5">
              <div className="flex-1 min-w-0 flex items-center gap-1 rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)' }}>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="flex-1 min-w-0 font-mono text-xl outline-none bg-transparent"
                  style={{ color: 'var(--ep-text, #E9E9ED)' }}
                />
                <span className="font-mono text-xs" style={{ color: 'var(--ep-faint, #75798C)' }}>SOL</span>
              </div>
              <button onClick={() => setAmount('0.5')} className="text-xs font-bold px-3 rounded-lg" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                Min
              </button>
            </div>
            <div className="text-[11px] font-mono mt-1.5" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              ≈ {(Number(amount) > 0 && pool.navPerShare > 0 ? Number(amount) / pool.navPerShare : 0).toFixed(2)} shares · ≈ $—
            </div>
            <button
              onClick={() => void deposit()}
              disabled={busy}
              className="w-full mt-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}
            >
              {hasWallet ? 'Deposit SOL' : 'Connect wallet to deposit'}
            </button>
            {msg && <p className="text-[11px] mt-2" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}
            <p className="text-[11px] mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              Minimum 0.5 SOL. Your deposit unlocks live signals.
            </p>
            <ul className="text-[11px] mt-3 space-y-1" style={{ color: 'var(--ep-faint, #75798C)' }}>
              <li>· 2% cap per trader</li>
              <li>· −5% daily kill switch</li>
              <li>· 20% fee on new profit above HWM, no management fee</li>
              <li>· {pool.openCount === 0 ? 'Pool is flat — withdrawals are instant' : 'Withdrawals queue and settle at checkpoint'}</li>
            </ul>
          </section>
        </div>
      </div>
      )}
      <SiteFooter />
    </div>
    <Toaster />
    </>
  );
}

function AdvancedView({
  pool,
  period,
  setPeriod,
  periodPnl,
  amount,
  setAmount,
  busy,
  onDeposit,
}: {
  pool: PoolDetail;
  period: Period;
  setPeriod: (p: Period) => void;
  periodPnl: { sol: number; pct: number };
  amount: string;
  setAmount: (v: string) => void;
  busy: boolean;
  onDeposit: () => void;
}) {
  const adv = pool.advanced;
  if (!adv) return null;
  const locked =
    !pool.myHolding ||
    pool.myHolding.valueSol + pool.myHolding.queuedDeposits.reduce((s, q) => s + q.amountSol, 0) < 0.5;
  const card: React.CSSProperties = { background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' };
  const k = adv.kpis;
  const r = adv.risk;
  const held = pool.myHolding && pool.myHolding.shares > 0;
  const unrealByKey: Record<string, number | null> = Object.fromEntries(
    pool.openPositions.map((p) => [`${p.token}|${p.trader}`, p.unrealizedPct]),
  );
  const left = Math.max(0, pool.slots.max - pool.slots.used);
  const series = pool.navSeries.slice(-60);
  const smin = series.length ? Math.min(...series.map((p) => p.v)) : 0;
  const smax = series.length ? Math.max(...series.map((p) => p.v)) : 1;
  const sspan = smax - smin || 1;
  const CW = 600;
  const CH = 150;
  const cd = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, series.length - 1)) * CW).toFixed(1)},${(CH - 6 - ((p.v - smin) / sspan) * (CH - 12)).toFixed(1)}`).join(' ');
  const chartUp = periodPnl.sol >= 0;
  return (
    <div className="space-y-4 mt-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-lg font-medium">{pool.name}</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', color: 'var(--ep-muted, #9397AB)' }}>
            {left} of {pool.slots.max} left
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
            {pool.status === 'live' ? 'LIVE' : 'PAUSED'} · Initial strategy settings under validation
          </span>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ ...card, border: '1px solid var(--ep-aqua, #49E6D7)' }}>
        {held ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              ['My position', `${pool.myHolding!.valueSol.toFixed(4)} SOL`],
              ['My PnL', `${pool.myHolding!.returnsSol >= 0 ? '+' : ''}${pool.myHolding!.returnsSol.toFixed(4)}`],
              ['Shares', pool.myHolding!.shares.toFixed(2)],
              ['Withdraw', 'available'],
            ].map(([label, v]) => (
              <div key={label}>
                <div className="text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{label}</div>
                <div className="text-sm font-mono font-bold">{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm flex-1 min-w-[200px]" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
              Deposit 0.5 SOL or more to unlock signals and open a position.
            </div>
            <div className="flex gap-2 items-center">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                inputMode="decimal"
                className="w-28 font-mono text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}
              />
              <button
                onClick={onDeposit}
                disabled={busy}
                className="text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}
              >
                Deposit SOL
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))' }}>
        {[
          ['Pool NAV', `${k.navSol.toFixed(2)} SOL`, 'var(--ep-text, #E9E9ED)'],
          ['NAV/share', k.sharePrice.toFixed(4), 'var(--ep-aqua, #49E6D7)'],
          ['PnL · period', `${periodPnl.sol >= 0 ? '+' : ''}${periodPnl.sol.toFixed(2)} (${periodPnl.pct >= 0 ? '+' : ''}${periodPnl.pct.toFixed(1)}%)`, periodPnl.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
          ['Unrealized', `${k.unrealizedSol >= 0 ? '+' : ''}${k.unrealizedSol.toFixed(4)}`, k.unrealizedSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
          ['Deployed % NAV', `${k.deployedPctNav.toFixed(1)}%`, 'var(--ep-text, #E9E9ED)'],
          ['From HWM', `${k.fromHwmPct >= 0 ? '+' : ''}${k.fromHwmPct.toFixed(1)}%`, k.fromHwmPct >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
        ].map(([label, v, c]) => (
          <div key={label} className="rounded-2xl p-3" style={card}>
            <div className="font-mono text-[11px] tracking-widest text-left" style={{ color: 'var(--ep-faint, #75798C)' }}>{(label as string).toUpperCase()}</div>
            <div className="font-mono font-bold mt-1 text-left whitespace-nowrap" style={{ fontSize: 20, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl p-4" style={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>NAV PER SHARE</h3>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)} className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                style={period === p.key ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { color: 'var(--ep-muted, #9397AB)' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {series.length > 1 && (
          <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full mt-2" style={{ height: 150 }} aria-hidden>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={0} x2={CW} y1={CH * f} y2={CH * f} stroke="var(--ep-border, #2E313F)" strokeWidth={1} />
            ))}
            <path d={`${cd} L${CW},${CH} L0,${CH} Z`} fill={chartUp ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'} opacity={0.1} />
            <path d={cd} fill="none" stroke={chartUp ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'} strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
          {[
            ['Change', `${periodPnl.sol >= 0 ? '+' : ''}${periodPnl.sol.toFixed(2)}`],
            ['Today', `${pool.pnl.day.sol >= 0 ? '+' : ''}${pool.pnl.day.sol.toFixed(2)}`],
            ['Since inception', `${pool.pnl.all.sol >= 0 ? '+' : ''}${pool.pnl.all.sol.toFixed(2)}`],
          ].map(([label, v]) => (
            <div key={label}>
              <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>{label.toUpperCase()}</div>
              <div className="font-mono text-xs font-bold mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={card}>
        <h3 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>RISK LIMITS</h3>
        {[
          ['Daily kill switch −5%', r.dayUsedPct, `${r.dayPct >= 0 ? '+' : ''}${r.dayPct.toFixed(1)}% today`],
          ['Weekly loss limit −15%', r.weekUsedPct, `${r.weekPct >= 0 ? '+' : ''}${r.weekPct.toFixed(1)}% week`],
        ].map(([label, used, note]) => (
          <div key={label as string} className="mt-2">
            <div className="flex justify-between text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              <span>{label}</span><span className="font-mono">{note as string}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Number(used))}%`, background: Number(used) > 80 ? 'var(--ep-amber, #F0BE67)' : 'var(--ep-aqua, #49E6D7)' }} />
            </div>
          </div>
        ))}
        <div className="text-[11px] font-mono mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          Armed · {r.dayUsedPct.toFixed(0)}% of daily limit used · Signals 24h: {r.signals24h} · Emergency exits 7d: {r.emergencyExits7d}
        </div>
      </div>

      <div className="rounded-2xl p-4 overflow-x-auto" style={card}>
        <h3 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>POSITIONS</h3>
        <table className="w-full text-xs mt-2" style={{ minWidth: 1000 }}>
          <thead>
            <tr style={{ color: 'var(--ep-faint, #75798C)' }}>
              {['Token', 'Trader', 'Size', 'Unrealized', 'Price ladder', 'Stop/floor', 'Stage', 'Time stop'].map((h) => (
                <th key={h} className="text-left font-medium px-2 py-1.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {adv.ladder.map((l, i) => {
              const u = unrealByKey[`${l.token}|${l.trader}`];
              const deadline = new Date(l.createdAt).getTime() + 24 * 3600000 - Date.now();
              const due = deadline <= 0;
              const dh = Math.max(0, Math.floor(deadline / 3600000));
              const dm = Math.max(0, Math.floor((deadline % 3600000) / 60000));
              return (
              <tr key={i} style={{ borderTop: '1px solid var(--ep-row-rule, #26283A)' }}>
                <td className="px-2 py-2 font-bold">{locked ? '$••••' : l.token}</td>
                <td className="px-2 py-2 font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>{locked ? 'Trader •' : l.trader}</td>
                <td className="px-2 py-2 font-mono">{locked || l.sizeSol === null ? '•••' : `${l.sizeSol.toFixed(2)}`}</td>
                <td className="px-2 py-2 font-mono" style={{ color: (u ?? 0) >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                  {u === undefined || u === null ? '—' : `${u >= 0 ? '+' : ''}${u.toFixed(1)}%`}
                </td>
                <td className="px-2 py-2" style={{ minWidth: 240 }}>
                  <LadderBar l={l} />
                </td>
                <td className="px-2 py-2 font-mono" style={{ color: 'var(--ep-neg, #F28881)' }}>
                  {l.trailFloorPct !== null ? `floor +${l.trailFloorPct.toFixed(0)}%` : `${l.stopPct.toFixed(0)}%`}
                </td>
                <td className="px-2 py-2 font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>{l.stage}</td>
                <td className="px-2 py-2 font-mono" style={{ color: due ? 'var(--ep-amber, #F0BE67)' : 'var(--ep-muted, #9397AB)' }}>
                  {due ? 'due' : `${dh}h ${dm}m`}
                </td>
              </tr>
              );
            })}
            {adv.ladder.length === 0 && (
              <tr><td colSpan={8} className="px-2 py-4 text-center" style={{ color: 'var(--ep-muted, #9397AB)' }}>No open positions — pool is flat.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl p-4" style={card}>
        <h3 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>EXPOSURE PER TRADER <span style={{ color: 'var(--ep-faint, #75798C)' }}>(share of 2% cap)</span></h3>
        <div className="mt-2 space-y-2">
          {adv.exposure.map((e) => (
            <div key={e.trader}>
              <div className="flex justify-between text-[11px] font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                <span>{locked ? 'Trader •' : `${e.trader.slice(0, 8)}…`}</span><span>{e.pctNav.toFixed(2)}% NAV · {e.pnlSol >= 0 ? '+' : ''}{e.pnlSol.toFixed(2)}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, e.capPct)}%`, background: e.capPct >= 100 ? 'var(--ep-amber, #F0BE67)' : 'var(--ep-aqua, #49E6D7)' }} />
              </div>
            </div>
          ))}
          {adv.exposure.length === 0 && <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No exposure.</p>}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={card}>
        <h3 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>EXECUTION LOG</h3>
        <div className="mt-2 space-y-1 font-mono text-[11px] max-h-48 overflow-y-auto">
          {pool.log.length === 0 && (
            <p style={{ color: 'var(--ep-muted, #9397AB)' }}>No executions yet.</p>
          )}
          {pool.log.map((l, i) => (
            <div key={i} className="flex gap-2 whitespace-nowrap" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
              <span style={{ color: 'var(--ep-faint, #75798C)' }}>
                {new Date(l.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="font-bold" style={{ color: l.kind === 'skip' ? 'var(--ep-amber, #F0BE67)' : 'var(--ep-violet-100, #D2CEFD)' }}>
                {l.event.toUpperCase()}
              </span>
              <span className="font-bold">{locked ? '$••••' : l.token}</span>
              <span style={{ color: 'var(--ep-muted, #9397AB)' }}>@{locked ? 'Trader •' : l.trader}</span>
              <span className="truncate">{l.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LadderBar({ l }: { l: { tp1Pct: number; tp1Hit: boolean; tp2Pct: number; tp2Hit: boolean; stopPct: number; trailFloorPct: number | null; movePct: number | null } }) {
  // Range: stop (left) → +300% (right). Ticks positioned by %.
  const RANGE_MIN = -50;
  const RANGE_MAX = 300;
  const pos = (pct: number) => Math.min(100, Math.max(0, ((pct - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)) * 100));
  const cur = l.movePct ?? 0;
  return (
    <div className="relative h-5" style={{ minWidth: 220 }}>
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px]" style={{ background: 'var(--ep-border, #2E313F)' }} />
      <div title={`Stop ${l.stopPct.toFixed(0)}%`} className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3" style={{ left: `${pos(l.stopPct)}%`, background: 'var(--ep-neg, #F28881)' }} />
      <div title="Entry" className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3" style={{ left: `${pos(0)}%`, background: 'var(--ep-muted, #9397AB)' }} />
      <div title={`TP1 +${l.tp1Pct.toFixed(0)}%`} className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3" style={{ left: `${pos(l.tp1Pct)}%`, background: l.tp1Hit ? 'var(--ep-violet, #9184D9)' : 'var(--ep-ghost, #595D6C)' }} />
      <div title={`TP2 +${l.tp2Pct.toFixed(0)}%`} className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3" style={{ left: `${pos(l.tp2Pct)}%`, background: l.tp2Hit ? 'var(--ep-violet, #9184D9)' : 'var(--ep-ghost, #595D6C)' }} />
      {l.trailFloorPct !== null && (
        <div title={`Runner floor +${l.trailFloorPct.toFixed(0)}%`} className="absolute top-1/2 -translate-y-1/2 h-[2px] border-t border-dashed" style={{ left: `${pos(l.trailFloorPct)}%`, width: `${100 - pos(l.trailFloorPct)}%`, borderColor: 'var(--ep-violet, #9184D9)' }} />
      )}
      <div title={`Now ${cur >= 0 ? '+' : ''}${cur.toFixed(1)}%`} className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2" style={{ left: `calc(${pos(cur)}% - 6px)`, background: 'var(--ep-aqua, #49E6D7)', borderColor: 'var(--ep-abyss, #0D0F18)' }} />
    </div>
  );
}

