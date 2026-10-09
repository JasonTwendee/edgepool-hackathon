'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, LockSimple, PauseCircle, UsersThree, XLogo } from '@phosphor-icons/react';
import {
  getAuthMe,
  getPoolDetail,
  listBots,
  partialCloseDemo,
  queueVaultDeposit,
  depositChallenge,
  replayDemo,
  requestVaultWithdraw,
  resetDemo,
  seedDemo,
  settleVault,
  vaultOrders,
  type PoolDetail,
  type VaultOrderJourney,
} from '../../../lib/api';
import { getStoredToken } from '../../../lib/api';
import { JourneyRail } from '../../../components/JourneyRail';
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
const PERIOD_RANGE: Record<Period, string> = { day: 'last 24 hours', week: 'last 7 days', month: 'last 30 days', all: 'since inception' };
const PERIOD_NAME: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', all: 'since inception' };

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
  // Admin demo console (ADMIN role only; never rendered for the public).
  const [isAdmin, setIsAdmin] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [demoReplay, setDemoReplay] = useState<{ signals: number; fired: number; failed: number; forceClosed: number; settleNavSol: number | null | undefined } | null>(null);
  const [spawnedId, setSpawnedId] = useState<number | null>(null);
  const [journeys, setJourneys] = useState<VaultOrderJourney[]>([]);
  type FlowState = 'wait' | 'run' | 'done' | 'fail';
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowSteps, setFlowSteps] = useState<{ key: string; label: string; state: FlowState; detail: string }[]>([]);

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
    const t = getStoredToken();
    if (t) {
      void getAuthMe(t)
        .then((r) => setIsAdmin(r.data.role === 'ADMIN'))
        .catch(() => setIsAdmin(false));
    }
    const timer = setInterval(() => void refresh(), 180000);
    return () => clearInterval(timer);
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

  async function loadJourneys(vaultId: number) {
    const token = getStoredToken();
    if (!token) return;
    try {
      const r = await vaultOrders(token, vaultId);
      setJourneys(r.data);
    } catch (e) {
      setDemoMsg((e as Error).message);
    }
  }

  async function spawnDemo() {
    const token = getStoredToken();
    if (!token || !pool || demoBusy) return;
    setDemoBusy(true);
    setDemoMsg(null);
    try {
      const r = await seedDemo(token, { name: `pool-${pool.id}`, depositSol: 10, traderCount: 3 });
      setSpawnedId(r.data.vaultId);
      setDemoMsg(`Demo pool #${r.data.vaultId} seeded — open it to run the replay.`);
    } catch (e) {
      setDemoMsg((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  }

  async function replayHere() {
    const token = getStoredToken();
    if (!token || !pool || demoBusy) return;
    setDemoBusy(true);
    setDemoMsg(null);
    try {
      const bots = await listBots();
      const bot = bots.data.filter((b) => b.vaultId === pool.id).sort((a, b) => b.id - a.id)[0];
      if (!bot) throw new Error('This demo pool has no bot — reset and re-seed it from /terminal.');
      const r = await replayDemo(token, { vaultId: pool.id, botId: bot.id, days: 7, limit: 10 });
      setDemoReplay({ signals: r.data.signals, fired: r.data.fired, failed: r.data.failed, forceClosed: r.data.forceClosed, settleNavSol: r.data.settleNavSol });
      setDemoMsg(`Replayed ${r.data.signals} real signals → ${r.data.fired} entered · NAV ${r.data.settleNavSol}.`);
      await refresh();
      await loadJourneys(pool.id);
    } catch (e) {
      setDemoMsg((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  }

  async function resetDemos() {
    const token = getStoredToken();
    if (!token || demoBusy) return;
    setDemoBusy(true);
    try {
      await resetDemo(token);
      setJourneys([]);
      setDemoReplay(null);
      setSpawnedId(null);
      setFlowSteps([]);
      setDemoMsg('Demo pools deleted (audit kept).');
      await refresh();
    } catch (e) {
      setDemoMsg((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  }

  /** Guided full lifecycle on this demo pool: deposit → settle → trade →
   * partial exit → settle → withdraw → settle. One click, each phase renders
   * on the page before the next starts. */
  async function runFullFlow() {
    const token = getStoredToken();
    if (!token || !pool || demoBusy || flowBusy) return;
    setFlowBusy(true);
    setDemoMsg(null);
    const steps: { key: string; label: string; state: 'wait' | 'run' | 'done' | 'fail'; detail: string }[] = [
      { key: 'deposit', label: 'Deposit 2 SOL', state: 'wait', detail: '' },
      { key: 'settle1', label: 'Settle · mint shares', state: 'wait', detail: '' },
      { key: 'replay', label: 'Replay real signals', state: 'wait', detail: '' },
      { key: 'partial', label: 'Partial exit at live price', state: 'wait', detail: '' },
      { key: 'settle2', label: 'Settle · book realized', state: 'wait', detail: '' },
      { key: 'withdraw', label: 'Request withdrawal', state: 'wait', detail: '' },
      { key: 'settle3', label: 'Settle · pay out', state: 'wait', detail: '' },
    ];
    const paint = (key: string, state: 'wait' | 'run' | 'done' | 'fail', detail = '') =>
      setFlowSteps((prev) => prev.map((s) => (s.key === key ? { ...s, state, detail } : s)));
    setFlowSteps(steps);
    const fresh = async (): Promise<PoolDetail> => {
      const r = await getPoolDetail(pool.id);
      setPool(r.data);
      return r.data;
    };
    try {
      // 1. Deposit.
      paint('deposit', 'run');
      const dep = await queueVaultDeposit({ vaultId: pool.id, amountSol: 2 }, token);
      paint('deposit', 'done', `deposit #${dep.data.id} queued · 2 SOL`);
      // 2. Settle the deposit.
      paint('settle1', 'run');
      let cur = await fresh();
      const s1 = await settleVault(token, pool.id, Math.round((cur.navSol + 2) * 1e9) / 1e9);
      paint('settle1', 'done', `epoch #${s1.data.epochId} · price ${s1.data.sharePrice.toFixed(4)}`);
      cur = await fresh();
      await loadJourneys(pool.id);
      // 3. Fire real signals (positions stay open for the visible exit).
      // Same scope as the replay-only button; one retry with a wider net so
      // the guided flow rarely stalls on scope caps.
      paint('replay', 'run');
      const bots = await listBots();
      const bot = bots.data.filter((b) => b.vaultId === pool.id).sort((a, b) => b.id - a.id)[0];
      if (!bot) throw new Error('This demo pool has no bot.');
      let rep = await replayDemo(token, { vaultId: pool.id, botId: bot.id, days: 7, limit: 10, skipClose: true });
      if (rep.data.fired === 0) {
        rep = await replayDemo(token, { vaultId: pool.id, botId: bot.id, days: 7, limit: 25, skipClose: true });
      }
      paint('replay', 'done', `${rep.data.signals} signals · ${rep.data.fired} entered${rep.data.skipped ? ` · ${rep.data.skipped} no-notional skipped` : ''}`);
      cur = await fresh();
      await loadJourneys(pool.id);
      if (rep.data.fired === 0) throw new Error('No signal entered — try again (scope caps rotate).');
      // 4. Partial exit at the live price.
      paint('partial', 'run');
      const pc = await partialCloseDemo(token, { vaultId: pool.id, fraction: 0.4 });
      const solPx = pc.data.solPx > 0 ? pc.data.solPx : 0;
      const realizedSol = solPx > 0 ? pc.data.realizedPnlUsd / solPx : 0;
      paint('partial', 'done', `${pc.data.leg} ${(pc.data.fraction * 100).toFixed(0)}% @ $${pc.data.exitPriceUsd} (${pc.data.realizedPnlUsd >= 0 ? '+' : ''}$${pc.data.realizedPnlUsd})`);
      cur = await fresh();
      await loadJourneys(pool.id);
      // 5. Settle the realized leg.
      paint('settle2', 'run');
      const s2 = await settleVault(token, pool.id, Math.round((cur.navSol + realizedSol) * 1e9) / 1e9);
      paint('settle2', 'done', `epoch #${s2.data.epochId} · NAV ${s2.data.navSol.toFixed(2)}`);
      cur = await fresh();
      // 6. Withdraw half of my shares.
      paint('withdraw', 'run');
      const myShares = cur.myHolding?.shares ?? 0;
      if (myShares <= 0) throw new Error('No shares to withdraw (deposit did not settle?).');
      const wShares = Math.max(0.0001, Math.floor((myShares / 2) * 10000) / 10000);
      const wd = await requestVaultWithdraw({ vaultId: pool.id, shares: wShares }, token);
      paint('withdraw', 'done', `withdrawal #${wd.data.id} queued · ${wShares} shares`);
      // 7. Settle the withdrawal at the full pre-withdrawal NAV (withdrawing
      // shares does not dilute the price — payout = shares × price).
      paint('settle3', 'run');
      const s3 = await settleVault(token, pool.id, cur.navSol);
      const paid = s3.data.settledWithdrawals.find((w) => w.id === wd.data.id);
      paint('settle3', 'done', paid ? `paid ${paid.payoutSol.toFixed(4)} SOL` : 'settled');
      cur = await fresh();
      await loadJourneys(pool.id);
      setDemoMsg(
        `Full lifecycle complete: deposit → trade → partial exit → settle → withdraw. ` +
        `Pool NAV ${cur.navSol.toFixed(2)} · my shares ${cur.myHolding?.shares.toFixed(4) ?? '0.0000'}` +
        (paid ? ` · got ${paid.payoutSol.toFixed(4)} SOL` : ''),
      );
    } catch (e) {
      setFlowSteps((prev) => {
        const running = prev.find((s) => s.state === 'run');
        if (!running) return prev;
        return prev.map((s) => (s.key === running.key ? { ...s, state: 'fail' as const, detail: (e as Error).message } : s));
      });
      setDemoMsg((e as Error).message);
    } finally {
      setFlowBusy(false);
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
  const slotsLeft = Math.max(0, pool.slots.max - pool.slots.used);
  const poolFull = slotsLeft <= 0;
  const isHolder = !!pool.myHolding && pool.myHolding.shares > 0;
  const slotColor = poolFull ? '#F28881' : slotsLeft <= Math.max(5, pool.slots.max * 0.1) ? '#F0BE67' : '#49E6D7';
  const slotLabel = poolFull ? `Full · ${pool.slots.used} / ${pool.slots.max}` : `${slotsLeft} of ${pool.slots.max} left`;
  const slotPct = `${Math.min(100, (pool.slots.used / Math.max(1, pool.slots.max)) * 100).toFixed(1)}%`;
  const slotSub = poolFull
    ? isHolder
      ? 'Pool is full. You can still add to your position.'
      : 'Pool is full. New depositors can join when a slot opens.'
    : `${pool.slots.used} depositors in · capped to protect execution`;
  const full = poolFull;

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
                <Link key={v} href={href} scroll={false} className="font-medium capitalize"
                  style={active ? { background: '#2E313F', color: '#E9E9ED', height: 32, padding: '0 14px', borderRadius: 6, fontSize: 13, display: 'flex', alignItems: 'center' } : { color: 'var(--ep-muted, #9397AB)', height: 32, padding: '0 14px', fontSize: 13, display: 'flex', alignItems: 'center' }}>
                  {v}
                </Link>
              );
            })}
          </div>
        }
      />
      <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }}>
      <Link href="/" className="font-medium flex items-center gap-1.5 self-start" style={{ fontSize: 13, color: 'var(--ep-muted, #9397AB)' }}>
        <ArrowLeft size={15} weight="regular" />
        All pools
      </Link>
      {pool.status === 'paused' && (
        <div className="mt-3 flex items-center gap-2.5 text-[13px]" style={{ padding: '12px 16px', borderRadius: 12, background: '#4A3B1C', color: '#F7DDA9' }}>
          <PauseCircle size={18} weight="regular" />
          The pool owner has paused new trades. Open positions are still managed by the rules.
        </div>
      )}

      {!advanced && (
      <div className="mt-3 flex flex-col gap-3">
        <span className="flex items-center gap-2 font-mono" style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--ep-aqua, #49E6D7)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ep-aqua, #49E6D7)', boxShadow: '0 0 8px var(--ep-aqua, #49E6D7)' }} />
          {pool.status === 'live' ? 'LIVE' : 'PAUSED'} · {isDemo ? 'DEMO' : pool.kind === 'basket' ? 'FLAGSHIP' : 'PARTNER'}
        </span>
        <h1 className="font-display font-medium" style={{ fontSize: 'clamp(30px,4vw,42px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>{pool.name}</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#B2B6CA', maxWidth: 620 }}>
          {isDemo
            ? 'Demo pool · scripted scenario (unlisted)'
            : pool.kind === 'basket'
              ? `Copies ${pool.traders.length} algorithm-ranked Fomo traders with the same entry, sizing and exit rules on every trade.`
              : `Partner pool · @${pool.traders[0]?.handle ?? 'partner'} and invited traders. Each trader earns 15% of the profit their own signals make; Edgepool takes 5%.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {['2% cap per trader', '50% now + 50% limit at −10%', 'Adaptive stop', '−5% daily kill switch'].map((r) => (
            <span key={r} className="text-xs" style={{ padding: '6px 11px', borderRadius: 999, boxShadow: 'inset 0 0 0 1px #3F424D', color: '#CFD3E5' }}>{r}</span>
          ))}
        </div>
      </div>
      )}

      {advanced && pool.advanced ? (
        <div key="advanced" className="ep-fade">
          <AdvancedView
            pool={pool}
            period={period}
            setPeriod={setPeriod}
            periodPnl={pnl}
            msg={msg}
            amount={amount}
            setAmount={setAmount}
            busy={busy}
            onDeposit={() => void deposit()}
          />
        </div>
      ) : (
      <div key="calm" className="ep-fade ep-pool-grid grid mt-5" style={{ gap: 28 }}>
        <div className="min-w-0 flex flex-col" style={{ gap: 22 }}>
          <section className="grid" style={{ padding: '22px 24px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,240px),1fr))', gap: 24 }}>
            <div className="flex flex-col gap-3 min-w-0" style={{ gridColumn: 'span 2' }}>
              <div className="flex justify-between items-center gap-3 flex-wrap">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>
                  Pool PnL · {PERIOD_NAME[period]}
                </span>
                <div className="flex p-[3px] rounded-lg" style={{ background: '#161826', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                  {PERIODS.map((pd) => (
                    <button key={pd.key} onClick={() => setPeriod(pd.key)} className="font-medium"
                      style={period === pd.key ? { height: 28, padding: '0 11px', borderRadius: 6, fontSize: 12, background: '#2E313F', color: '#E9E9ED' } : { height: 28, padding: '0 11px', borderRadius: 6, fontSize: 12, background: 'transparent', color: 'var(--ep-muted, #9397AB)' }}>
                      {pd.label}
                    </button>
                  ))}
                </div>
              </div>
              <div key={period} className="ep-fade flex items-baseline gap-3 flex-wrap">
                <span className="font-mono font-medium" style={{ fontSize: 'clamp(26px,3vw,34px)', color: positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                  {positive ? '+' : ''}{pnl.sol.toFixed(2)} SOL
                </span>
                <span className="font-mono" style={{ fontSize: 16, color: positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                  {positive ? '+' : ''}{pnl.pct.toFixed(2)}%
                </span>
              </div>
              {pts.length > 1 && (
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height: 120 }} aria-hidden>
                  <path d={`${d} L${W},${H} L0,${H} Z`} fill={positive ? 'rgba(73,230,215,0.10)' : 'rgba(242,136,129,0.08)'} />
                  <path d={d} fill="none" stroke={positive ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </svg>
              )}
              <span className="text-xs" style={{ color: 'var(--ep-faint, #75798C)' }}>NAV per share, {PERIOD_RANGE[period]}</span>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Pool NAV</span>
                <span className="font-mono font-medium" style={{ fontSize: 20 }}>{pool.navSol.toFixed(2)} SOL</span>
                <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>NAV / share <span className="font-mono" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{pool.navPerShare.toFixed(4)} SOL</span></span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Today</span>
                <span className="font-mono" style={{ fontSize: 15, color: pool.pnl.day.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                  {pool.pnl.day.sol >= 0 ? '+' : ''}{pool.pnl.day.sol.toFixed(2)} SOL · {pool.pnl.day.sol >= 0 ? '+' : ''}{pool.pnl.day.pct.toFixed(2)}%
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Since inception</span>
                <span className="font-mono" style={{ fontSize: 15, color: pool.pnl.all.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                  {pool.pnl.all.sol >= 0 ? '+' : ''}{pool.pnl.all.sol.toFixed(2)} SOL · {pool.pnl.all.sol >= 0 ? '+' : ''}{pool.pnl.all.pct.toFixed(2)}%
                </span>
              </div>
            </div>
          </section>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,320px),1fr))', gap: 20, alignItems: 'start' }}>
          <section style={{ padding: '18px 20px', borderRadius: 14, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-baseline justify-between gap-2" style={{ paddingBottom: 8 }}>
              <h2 className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Open positions · {pool.openCount}</h2>
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
              <span style={{ padding: '14px 0', borderTop: '1px solid var(--ep-border, #2E313F)', fontSize: 13, color: 'var(--ep-muted, #9397AB)' }}>
                No open positions. This pool is flat, so withdrawals are instant.
              </span>
            ) : (
              pool.openPositions.map((p, i) => {
                const up = (p.unrealizedPct ?? 0) >= 0;
                const sol = p.sizeSol !== null && p.unrealizedPct !== null ? (p.sizeSol * p.unrealizedPct) / 100 : null;
                const stage = p.stage === 'OPEN' ? 'Full size' : p.stage;
                return (
                  <div key={i} className="grid" style={{ gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium" style={{ letterSpacing: locked ? '0.12em' : 0 }}>{locked ? '$••••' : p.token}</span>
                      <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{locked ? 'Trader •' : p.trader} · {stage}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono text-sm" style={{ color: up ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                        {p.unrealizedPct === null ? '—' : `${up ? '+' : ''}${p.unrealizedPct.toFixed(1)}%`}
                      </span>
                      <span className="font-mono" style={{ fontSize: 11, color: 'var(--ep-faint, #75798C)' }}>
                        {sol === null ? '•••' : `${sol >= 0 ? '+' : ''}${sol.toFixed(2)} SOL`}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section style={{ padding: '18px 20px', borderRadius: 14, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="flex justify-between items-center gap-2">
              <span className="flex items-center gap-2 font-mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--ep-aqua, #49E6D7)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ep-aqua, #49E6D7)', boxShadow: '0 0 8px var(--ep-aqua, #49E6D7)' }} />
                LIVE SIGNALS
              </span>
              <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Detect → Qualify → Enter → Manage</span>
            </div>
            {locked && (
              <div className="flex items-center gap-2.5 text-xs" style={{ padding: '12px 14px', borderRadius: 10, background: '#2B2741', color: '#D2CEFD', lineHeight: 1.45 }}>
                <LockSimple size={16} weight="regular" style={{ flexShrink: 0 }} />
                <span className="flex-1">Tokens, contract addresses and entries unlock with a 0.5 SOL deposit.</span>
                <button
                  onClick={() => document.getElementById('deposit-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  className="font-medium shrink-0"
                  style={{ height: 30, padding: '0 12px', borderRadius: 8, fontSize: 12, border: '1px solid #9184D9', background: 'transparent', color: '#D2CEFD', whiteSpace: 'nowrap' }}
                >
                  Unlock
                </button>
              </div>
            )}
            {pool.signals.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No signals in the recent window.</p>
            )}
            {pool.signals.slice(0, 8).map((s, i) => {
              const age = s.ageSec < 60 ? `${Math.floor(s.ageSec)}s` : s.ageSec < 3600 ? `${Math.floor(s.ageSec / 60)}m` : `${Math.floor(s.ageSec / 3600)}h`;
              return (
                <div key={i} className="flex flex-col gap-2 text-[13px]" style={{ padding: '12px 14px', borderRadius: 10, background: '#1A1C2A', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                  <div className="flex justify-between items-center gap-2">
                    <span>
                      <b className="font-medium" style={{ letterSpacing: locked ? '0.12em' : 0 }}>{locked ? '$••••' : s.token}</b>
                      {' '}<span style={{ color: 'var(--ep-muted, #9397AB)' }}>via {locked ? 'Trader •' : s.trader}</span>
                    </span>
                    <span className="font-mono shrink-0" style={{ fontSize: 11, color: 'var(--ep-faint, #75798C)' }}>{age}</span>
                  </div>
                  <div className="flex flex-wrap gap-[5px]">
                    {s.steps.map((st, j) => {
                      const c = STEP_STYLE[st.state] ?? STEP_STYLE.waiting;
                      return (
                        <span key={j} className="text-[11px]" style={{ padding: '3px 7px', borderRadius: 6, background: c.bg, color: c.fg }}>
                          {st.label}
                        </span>
                      );
                    })}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                    {locked ? 'Size, price and contract address hidden' : s.detail || s.note}
                  </span>
                </div>
              );
            })}
          </section>
          </div>

          <section style={{ padding: '18px 20px', borderRadius: 14, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column' }}>
            <div className="flex justify-between items-baseline" style={{ paddingBottom: 8 }}>
              <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Trader basket · {pool.traders.length}</span>
              <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Rank · 24h / 7d / 30d</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%,220px),1fr))', gap: '0 24px' }}>
              {pool.traders.map((t) => (
                <div key={t.wallet} className="flex items-center gap-3 text-sm" style={{ padding: '12px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                  <span className="grid place-items-center font-medium shrink-0" style={{ width: 34, height: 34, borderRadius: '50%', background: '#2B2741', color: '#D2CEFD', fontFamily: "'Inter Tight', sans-serif" }}>
                    {(locked ? 'T' : t.handle || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      @{locked ? 'Trader •' : t.handle} <XLogo size={12} style={{ color: 'var(--ep-faint, #75798C)' }} />
                    </span>
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--ep-muted, #9397AB)' }}>
                      #{t.ranks?.h24 ?? '—'} · #{t.ranks?.d7 ?? '—'} · #{t.ranks?.d30 ?? '—'}
                    </span>
                  </div>
                  <span className="font-mono" style={{ fontSize: 13 }}>
                    {expByWallet[t.wallet] !== undefined ? `${expByWallet[t.wallet].toFixed(1)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col ep-sticky-col" style={{ gap: 16 }}>
          {pool.myHolding && pool.myHolding.shares > 0 && (() => {
            const mh = pool.myHolding!;
            const base = mh.depositedSol - mh.withdrawnSol;
            const pct = base > 0 ? (mh.returnsSol / base) * 100 : 0;
            return (
              <section className="flex flex-col" style={{ padding: '20px 22px', borderRadius: 16, background: '#032D2A', boxShadow: '0 0 0 1px #004B45', gap: 12 }}>
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: '#81EADE' }}>My position</span>
                <div className="flex justify-between items-baseline gap-2 flex-wrap">
                  <span className="font-mono font-medium" style={{ fontSize: 26 }}>{mh.valueSol.toFixed(2)} SOL</span>
                  <span className="font-mono" style={{ fontSize: 14, color: mh.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                    {mh.returnsSol >= 0 ? '+' : ''}{mh.returnsSol.toFixed(2)} SOL · {mh.returnsSol >= 0 ? '+' : ''}{pct.toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 text-xs" style={{ gap: 10 }}>
                  <div className="flex flex-col gap-0.5">
                    <span style={{ color: '#81EADE' }}>Shares</span>
                    <span className="font-mono" style={{ fontSize: 14 }}>{mh.shares.toFixed(4)}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span style={{ color: '#81EADE' }}>Deposited</span>
                    <span className="font-mono" style={{ fontSize: 14 }}>{mh.depositedSol.toFixed(2)} SOL</span>
                  </div>
                </div>
                <Link
                  href="/portfolio"
                  className="block text-center w-full font-medium"
                  style={{ height: 40, lineHeight: '40px', borderRadius: 8, fontSize: 14, border: '1px solid var(--ep-aqua, #49E6D7)', background: 'transparent', color: 'var(--ep-aqua, #49E6D7)' }}
                >
                  Withdraw · {pool.openCount === 0 ? 'instant while flat' : 'queued to checkpoint'}
                </Link>
              </section>
            );
          })()}
          <section id="deposit-panel" className="flex flex-col" style={{ padding: 22, borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', gap: 16 }}>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Pool NAV</span>
              <span className="font-mono font-medium" style={{ fontSize: 26 }}>{pool.navSol.toFixed(2)} SOL</span>
              <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>NAV / share <span className="font-mono" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{pool.navPerShare.toFixed(4)} SOL</span></span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                  <UsersThree size={15} weight="regular" />
                  Depositor slots
                </span>
                <span className="font-mono" style={{ color: slotColor }}>{slotLabel}</span>
              </div>
              <div className="rounded-full overflow-hidden relative" style={{ height: 6, background: '#2E313F' }}>
                <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: slotPct, background: slotColor }} />
              </div>
              <span className="text-[11px]" style={{ color: full && !isHolder ? '#F7C1BC' : 'var(--ep-faint, #75798C)' }}>{slotSub}</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Amount</span>
              <div className="flex items-center gap-2.5" style={{ height: 52, borderRadius: 10, boxShadow: 'inset 0 0 0 1px #3F424D', padding: '0 12px 0 14px' }}>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.50"
                  aria-label="Deposit amount in SOL"
                  inputMode="decimal"
                  className="flex-1 min-w-0 font-mono outline-none bg-transparent"
                  style={{ fontSize: 20, fontWeight: 500, color: 'var(--ep-text, #E9E9ED)' }}
                />
                <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>SOL</span>
                <button onClick={() => setAmount('0.5')} className="font-medium" style={{ height: 26, padding: '0 8px', borderRadius: 6, fontSize: 12, background: '#2E313F', color: '#CFD3E5' }}>
                  Min
                </button>
              </div>
              <span className="text-xs" style={{ color: 'var(--ep-faint, #75798C)' }}>
                ≈ {(Number(amount) > 0 && pool.navPerShare > 0 ? Number(amount) / pool.navPerShare : 0).toFixed(4)} shares · ≈ $—
              </span>
            </div>
            <button
              onClick={() => void deposit()}
              disabled={busy || (full && !isHolder)}
              className="w-full font-medium disabled:opacity-50"
              style={{ height: 52, borderRadius: 10, fontSize: 16, background: full && !isHolder ? '#2E313F' : 'var(--ep-aqua, #49E6D7)', color: full && !isHolder ? 'var(--ep-muted, #9397AB)' : '#0D0F18' }}
            >
              {full && !isHolder ? 'Pool full' : hasWallet ? 'Deposit SOL' : 'Connect wallet to deposit'}
            </button>
            {msg && <p className="text-xs" style={{ color: msg.startsWith('Deposit #') ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>{msg}</p>}
            <span className="text-xs" style={{ lineHeight: 1.45, color: 'var(--ep-muted, #9397AB)' }}>
              {isHolder ? (pool.openCount === 0 ? 'Withdraw instantly while the pool is flat.' : 'Withdrawals settle at the next checkpoint while positions are open.') : 'Minimum 0.5 SOL. Your deposit unlocks live signals.'}
            </span>
            <div className="flex flex-col" style={{ gap: 10, paddingTop: 14, borderTop: '1px solid var(--ep-border, #2E313F)', fontSize: 13 }}>
              {[
                ['Cap per trader', '2% of NAV'],
                ['Daily kill switch', '−5% NAV'],
                ['Fee', `20% above HWM · ${pool.kind === 'basket' ? '10% signal trader, 10% Edgepool' : '15% signal trader, 5% Edgepool'}`],
                ['Withdraw', pool.openCount === 0 ? 'Instant · pool is flat' : 'Queued to next checkpoint'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span style={{ color: 'var(--ep-muted, #9397AB)' }}>{k}</span>
                  <span className="text-right">{v}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      )}
      {isAdmin && (
        <section className="flex flex-col mt-7" style={{ padding: '18px 20px', borderRadius: 14, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-amber, #F0BE67)', gap: 12 }}>
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-amber, #F0BE67)' }}>
              Demo console · admin only
            </span>
            {pool.name.startsWith('demo-') && (
              <button onClick={() => void loadJourneys(pool.id)} disabled={demoBusy} className="font-medium text-xs disabled:opacity-50"
                style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid #3F424D', color: '#CFD3E5' }}>
                Refresh journeys
              </button>
            )}
          </div>
          {pool.name.startsWith('demo-') ? (
            <>
              <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                Replay real ledger BUYs into this demo pool, then watch each signal travel Detect → Qualify → Enter → Manage → Exit below.
                Or run the full lifecycle in one go: deposit → settle → trade → partial exit → settle → withdraw.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void runFullFlow()} disabled={demoBusy || flowBusy}
                  className="font-bold text-xs disabled:opacity-50" style={{ height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
                  {flowBusy ? 'Running flow…' : 'Run full flow'}
                </button>
                <button onClick={() => void replayHere()} disabled={demoBusy || flowBusy}
                  className="font-medium text-xs disabled:opacity-50" style={{ height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13, border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
                  {demoBusy ? 'Running…' : 'Replay signals only'}
                </button>
                <button onClick={() => void resetDemos()} disabled={demoBusy || flowBusy}
                  className="font-medium text-xs disabled:opacity-50" style={{ height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13, border: '1px solid #3F424D', color: '#CFD3E5' }}>
                  Reset demo pools
                </button>
              </div>
              {flowSteps.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg p-3" style={{ background: '#161826' }}>
                  {flowSteps.map((s) => (
                    <div key={s.key} className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="rounded-full shrink-0" style={{
                        width: 8, height: 8,
                        background: s.state === 'done' ? '#73DEA4' : s.state === 'run' ? '#49E6D7' : s.state === 'fail' ? '#F28881' : '#595D6C',
                        boxShadow: s.state === 'run' ? '0 0 8px #49E6D7' : undefined,
                      }} />
                      <span className="w-36 shrink-0" style={{ color: '#A7AABF' }}>{s.label}</span>
                      <span className="break-all" style={{ color: s.state === 'fail' ? '#F28881' : '#CFD3E5' }}>
                        {s.state === 'wait' ? '···' : s.state === 'run' ? 'running…' : s.detail}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {demoReplay && (
                <div className="text-[11px] font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                  signals {demoReplay.signals} · fired {demoReplay.fired} · failed {demoReplay.failed} · closed {demoReplay.forceClosed} · NAV {demoReplay.settleNavSol}
                </div>
              )}
              {journeys.length > 0 && (
                <div className="flex flex-col gap-2">
                  {journeys.slice(0, 10).map((j) => (
                    <JourneyRail key={j.id} j={j} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                Demo runs never write into live pools. Spawn an unlisted demo pool to run the replay there.
              </p>
              <div className="flex gap-2 flex-wrap items-center">
                <button onClick={() => void spawnDemo()} disabled={demoBusy}
                  className="font-bold text-xs disabled:opacity-50" style={{ height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
                  {demoBusy ? 'Seeding…' : 'Spawn demo pool'}
                </button>
                {spawnedId !== null && (
                  <Link href={`/pools/${spawnedId}`} className="font-medium text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
                    Open demo pool #{spawnedId} →
                  </Link>
                )}
              </div>
            </>
          )}
          {demoMsg && <p className="text-[11px] font-mono break-all" style={{ color: 'var(--ep-muted, #9397AB)' }}>{demoMsg}</p>}
        </section>
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
  msg,
  amount,
  setAmount,
  busy,
  onDeposit,
}: {
  pool: PoolDetail;
  period: Period;
  setPeriod: (p: Period) => void;
  periodPnl: { sol: number; pct: number };
  msg: string | null;
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
  const posByKey: Record<string, { u: number | null; s: number | null }> = Object.fromEntries(
    pool.openPositions.map((p) => [`${p.token}|${p.trader}`, { u: p.unrealizedPct, s: p.sizeSol }]),
  );
  const left = Math.max(0, pool.slots.max - pool.slots.used);
  const advFull = left <= 0;
  const slotColor = advFull ? '#F28881' : left <= Math.max(5, pool.slots.max * 0.1) ? '#F0BE67' : '#49E6D7';
  const slotLabel = advFull ? `Full · ${pool.slots.used} / ${pool.slots.max}` : `${left} of ${pool.slots.max} left`;
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
      <div className="flex items-center gap-3.5 flex-wrap">
        <h2 className="font-display font-medium" style={{ fontSize: 'clamp(24px,3vw,28px)', letterSpacing: '-0.02em' }}>{pool.name}</h2>
        <span className="flex items-center gap-1.5 font-mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--ep-aqua, #49E6D7)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ep-aqua, #49E6D7)', boxShadow: '0 0 8px var(--ep-aqua, #49E6D7)' }} />
          {pool.status === 'live' ? 'LIVE' : 'PAUSED'}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-2 text-xs" style={{ padding: '6px 10px', borderRadius: 8, boxShadow: 'inset 0 0 0 1px #3F424D', color: slotColor }}>
          <UsersThree size={15} weight="regular" />
          <span className="font-mono">{slotLabel}</span>
        </span>
        <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Initial strategy settings under validation</span>
      </div>

      <div className="grid items-center" style={{ padding: '16px 20px', borderRadius: 14, background: 'radial-gradient(80% 140% at 0% 0%, rgba(3,45,42,0.7), transparent 70%), var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-aqua, #49E6D7)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,380px),1fr))', gap: 20 }}>
        {held ? (
          <div className="flex items-center flex-wrap" style={{ gap: 28 }}>
            <div className="flex flex-col gap-[3px]">
              <span className="uppercase" style={{ fontSize: 10, letterSpacing: '0.08em', color: '#81EADE' }}>My position</span>
              <span className="font-mono font-medium" style={{ fontSize: 20 }}>{pool.myHolding!.valueSol.toFixed(2)} SOL</span>
            </div>
            <div className="flex flex-col gap-[3px]">
              <span className="uppercase" style={{ fontSize: 10, letterSpacing: '0.08em', color: '#81EADE' }}>My PnL</span>
              <span className="font-mono" style={{ fontSize: 14, color: pool.myHolding!.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                {pool.myHolding!.returnsSol >= 0 ? '+' : ''}{pool.myHolding!.returnsSol.toFixed(2)} SOL
              </span>
            </div>
            <div className="flex flex-col gap-[3px]">
              <span className="uppercase" style={{ fontSize: 10, letterSpacing: '0.08em', color: '#81EADE' }}>Shares</span>
              <span className="font-mono" style={{ fontSize: 14 }}>{pool.myHolding!.shares.toFixed(4)}</span>
            </div>
            <Link href="/portfolio" className="font-medium text-center" style={{ height: 34, lineHeight: '34px', padding: '0 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--ep-aqua, #49E6D7)', background: 'transparent', color: 'var(--ep-aqua, #49E6D7)' }}>
              Withdraw
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            <LockSimple size={24} weight="regular" style={{ color: '#B5ABFC', flexShrink: 0 }} />
            <div className="flex flex-col gap-[3px]">
              <span className="text-[15px] font-medium">Deposit 0.5 SOL or more</span>
              <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Unlocks tokens, traders, sizes and the full execution log.</span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2.5">
            <div className="flex-1 min-w-0 flex items-center gap-2" style={{ height: 46, borderRadius: 10, boxShadow: 'inset 0 0 0 1px #3F424D', background: '#161826', padding: '0 10px 0 12px' }}>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.50"
                aria-label="Deposit amount in SOL"
                inputMode="decimal"
                className="flex-1 min-w-0 font-mono outline-none bg-transparent"
                style={{ fontSize: 17, fontWeight: 500, color: 'var(--ep-text, #E9E9ED)' }}
              />
              <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>SOL</span>
              <button onClick={() => setAmount('0.5')} className="font-medium" style={{ height: 26, padding: '0 8px', borderRadius: 6, fontSize: 12, background: '#2E313F', color: '#CFD3E5' }}>
                Min
              </button>
            </div>
            <button
              onClick={onDeposit}
              disabled={busy}
              className="font-medium whitespace-nowrap disabled:opacity-50"
              style={{ height: 46, padding: '0 20px', borderRadius: 10, fontSize: 15, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}
            >
              Deposit SOL
            </button>
          </div>
          {msg && <span className="text-xs" style={{ color: msg.startsWith('Deposit #') ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>{msg}</span>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,170px),1fr))', gap: 10 }}>
        {[
          ['Pool NAV', `${k.navSol.toFixed(2)} SOL`, 'var(--ep-text, #E9E9ED)'],
          ['NAV / share', k.sharePrice.toFixed(4), 'var(--ep-aqua, #49E6D7)'],
          [`PnL · ${PERIOD_NAME[period]}`, `${periodPnl.sol >= 0 ? '+' : ''}${periodPnl.sol.toFixed(2)} SOL`, periodPnl.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
          ['Unrealized', `${k.unrealizedSol >= 0 ? '+' : ''}${k.unrealizedSol.toFixed(2)} SOL`, k.unrealizedSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
          ['Deployed', `${k.deployedPctNav.toFixed(1)}% NAV`, 'var(--ep-text, #E9E9ED)'],
          ['From HWM', `${k.fromHwmPct >= 0 ? '+' : ''}${k.fromHwmPct.toFixed(1)}%`, k.fromHwmPct >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
        ].map(([label, v, c]) => (
          <div key={label} className="flex flex-col" style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', gap: 4 }}>
            <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>{label}</span>
            <span className="font-mono whitespace-nowrap" style={{ fontSize: 17, color: c as string }}>{v}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl p-4" style={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>NAV per share · {PERIOD_RANGE[period]}</h3>
          <div className="flex p-[3px] rounded-lg" style={{ background: '#161826', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)} className="font-medium"
                style={period === p.key ? { height: 26, padding: '0 11px', borderRadius: 6, fontSize: 12, background: '#2E313F', color: '#E9E9ED' } : { height: 26, padding: '0 11px', borderRadius: 6, fontSize: 12, background: 'transparent', color: 'var(--ep-muted, #9397AB)' }}>
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
        <div className="flex gap-5 flex-wrap text-xs mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          <span>Change <span className="font-mono" style={{ color: chartUp ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>{periodPnl.sol >= 0 ? '+' : ''}{periodPnl.sol.toFixed(2)} ({periodPnl.pct >= 0 ? '+' : ''}{periodPnl.pct.toFixed(1)}%)</span></span>
          <span>Today <span className="font-mono" style={{ color: pool.pnl.day.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>{pool.pnl.day.sol >= 0 ? '+' : ''}{pool.pnl.day.sol.toFixed(2)}</span></span>
          <span>Since inception <span className="font-mono" style={{ color: pool.pnl.all.sol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>{pool.pnl.all.sol >= 0 ? '+' : ''}{pool.pnl.all.sol.toFixed(2)}</span></span>
        </div>
      </div>

      <div className="flex flex-col rounded-2xl p-4" style={{ ...card, gap: 14 }}>
        <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Risk limits</span>
        {[
          { l: 'Daily kill switch', v: `${r.dayPct >= 0 ? '+' : ''}${r.dayPct.toFixed(2)}% / −5%`, neg: r.dayPct < 0, w: r.dayPct < 0 ? `${Math.min(100, (Math.abs(r.dayPct) / 5) * 100).toFixed(0)}%` : '0%' },
          { l: 'Weekly loss limit', v: `${r.weekPct >= 0 ? '+' : ''}${r.weekPct.toFixed(2)}% / −15%`, neg: r.weekPct < 0, w: r.weekPct < 0 ? `${Math.min(100, (Math.abs(r.weekPct) / 15) * 100).toFixed(0)}%` : '0%' },
        ].map((lm) => (
          <div key={lm.l} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px]">
              <span>{lm.l}</span>
              <span className="font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>{lm.v}</span>
            </div>
            <div className="rounded-full overflow-hidden relative" style={{ height: 6, background: '#2E313F' }}>
              <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: lm.w, background: '#F0BE67' }} />
            </div>
            <span className="text-[11px]" style={{ color: lm.neg ? '#F0BE67' : 'var(--ep-profit, #73DEA4)' }}>
              {lm.neg ? `Armed · ${(parseFloat(lm.w) || 0).toFixed(0)}% of limit used` : 'Armed · 0% of limit used'}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-2 text-xs" style={{ gap: 10, paddingTop: 12, borderTop: '1px solid var(--ep-border, #2E313F)' }}>
          <div className="flex flex-col gap-0.5">
            <span style={{ color: 'var(--ep-faint, #75798C)' }}>Signals · 24h</span>
            <span className="font-mono" style={{ fontSize: 14 }}>{r.signals24h}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span style={{ color: 'var(--ep-faint, #75798C)' }}>Emergency exits · 7d</span>
            <span className="font-mono" style={{ fontSize: 14 }}>{r.emergencyExits7d}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <div className="flex justify-between items-center gap-3 flex-wrap" style={{ padding: '14px 20px' }}>
          <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Open positions · {adv.ladder.length}</span>
          {locked && (
            <span className="flex items-center gap-1.5 text-xs" style={{ padding: '4px 10px', borderRadius: 6, background: '#2B2741', color: '#D2CEFD' }}>
              <LockSimple size={14} weight="regular" />
              Unlocks with a 0.5 SOL deposit
            </span>
          )}
          <span className="flex gap-3 text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>
            <span className="flex items-center gap-[5px]"><span style={{ width: 2, height: 10, background: 'var(--ep-neg, #F28881)' }} />Stop</span>
            <span className="flex items-center gap-[5px]"><span style={{ width: 1, height: 10, background: 'var(--ep-muted, #9397AB)' }} />Entry</span>
            <span className="flex items-center gap-[5px]"><span style={{ width: 2, height: 10, background: 'var(--ep-violet, #9184D9)' }} />TP hit</span>
            <span className="flex items-center gap-[5px]"><span style={{ width: 2, height: 10, background: 'var(--ep-ghost, #595D6C)' }} />TP armed</span>
          </span>
        </div>
        {adv.ladder.length === 0 ? (
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--ep-border, #2E313F)', fontSize: 13, color: 'var(--ep-muted, #9397AB)' }}>
            No open positions. This pool is flat.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 1000 }}>
                <div className="grid font-mono uppercase" style={{ gridTemplateColumns: '96px 100px 84px 110px minmax(240px,1fr) 104px 130px 86px', gap: 14, padding: '8px 20px', background: '#1A1C2A', borderTop: '1px solid var(--ep-border, #2E313F)', borderBottom: '1px solid var(--ep-border, #2E313F)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--ep-faint, #75798C)' }}>
                  <span>Token</span><span>Trader</span><span>Size</span><span>Unrealized</span><span style={{ whiteSpace: 'nowrap' }}>Price ladder</span><span>Stop / floor</span><span>Stage</span><span style={{ textAlign: 'right' }}>Time stop</span>
                </div>
                {adv.ladder.map((l, i) => {
                  const pos = posByKey[`${l.token}|${l.trader}`];
                  const u = pos ? pos.u : null;
                  const sizeSol = pos ? pos.s : null;
                  const up = (u ?? 0) >= 0;
                  const pnlSol = u !== null && sizeSol !== null ? (sizeSol * u) / 100 : null;
                  const deadline = new Date(l.createdAt).getTime() + 24 * 3600000 - Date.now();
                  const due = deadline <= 0;
                  const dh = Math.max(0, Math.floor(deadline / 3600000));
                  const dm = Math.max(0, Math.floor((deadline % 3600000) / 60000));
                  return (
                    <div key={i} className="grid items-center text-[13px]" style={{ gridTemplateColumns: '96px 100px 84px 110px minmax(240px,1fr) 104px 130px 86px', gap: 14, padding: '11px 20px', borderBottom: '1px solid #26283A' }}>
                      <span className="font-medium" style={{ letterSpacing: locked ? '0.12em' : 0 }}>{locked ? '$••••' : l.token}</span>
                      <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{locked ? 'Trader •' : l.trader}</span>
                      <span className="font-mono text-xs">{locked || sizeSol === null ? '•••' : `${sizeSol.toFixed(2)} SOL`}</span>
                      <span className="flex flex-col gap-[1px]">
                        <span className="font-mono" style={{ color: up ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                          {u === null ? '—' : `${up ? '+' : ''}${u.toFixed(1)}%`}
                        </span>
                        <span className="font-mono" style={{ fontSize: 10, color: 'var(--ep-faint, #75798C)' }}>
                          {locked || pnlSol === null ? '•••' : `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(2)} SOL`}
                        </span>
                      </span>
                      <LadderBar l={l} up={up} />
                      <span className="font-mono text-xs" style={{ color: '#CFD3E5' }}>
                        {l.trailFloorPct !== null ? `Floor +${l.trailFloorPct.toFixed(0)}%` : `${l.stopPct.toFixed(0)}%`}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{l.stage}</span>
                      <span className="font-mono text-xs text-right" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                        {due ? 'due' : `${dh}h ${dm}m`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--ep-faint, #75798C)' }}>
              Ladder spans the stop to +100%, or to +300% once a position is a runner. Time stop exits after 24h.
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col rounded-2xl p-4" style={{ ...card, gap: 12 }}>
        <div className="flex justify-between items-baseline">
          <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Exposure per trader</span>
          <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>PnL · {PERIOD_NAME[period]}</span>
        </div>
        {adv.exposure.map((e) => (
          <div key={e.trader} className="grid items-center text-xs" style={{ gridTemplateColumns: '90px 1fr 48px 90px', gap: 14 }}>
            <span>{locked ? 'Trader •' : `@${e.trader.slice(0, 8)}`}</span>
            <div className="rounded-full overflow-hidden relative" style={{ height: 6, background: '#2E313F' }}>
              <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${Math.min(100, e.capPct)}%`, background: e.capPct >= 100 ? 'var(--ep-amber, #F0BE67)' : 'var(--ep-aqua, #49E6D7)' }} />
            </div>
            <span className="font-mono text-right">{e.pctNav.toFixed(1)}%</span>
            <span className="font-mono text-right" style={{ color: e.pnlSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
              {e.pnlSol >= 0 ? '+' : ''}{e.pnlSol.toFixed(2)} SOL
            </span>
          </div>
        ))}
        {adv.exposure.length === 0 && <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No exposure.</p>}
        <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Bar is share of the 2% NAV cap. Amber means at cap.</span>
      </div>

      <div className="flex flex-col rounded-2xl p-4" style={card}>
        <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)', paddingBottom: 6 }}>Execution log</span>
        {pool.log.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No executions yet.</p>
        )}
        {pool.log.map((l, i) => (
          <div key={i} className="grid text-xs" style={{ gridTemplateColumns: '62px 1fr', gap: 10, padding: '8px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
            <span className="font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>
              {new Date(l.at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span>
                <span className="font-medium" style={{ color: l.kind === 'skip' ? 'var(--ep-amber, #F0BE67)' : 'var(--ep-violet, #9184D9)' }}>{l.event}</span>
                {' · '}<span style={{ letterSpacing: locked ? '0.12em' : 0 }}>{locked ? '$••••' : l.token}</span>
              </span>
              <span style={{ color: 'var(--ep-muted, #9397AB)' }}>@{locked ? 'Trader •' : l.trader} · {l.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LadderBar({ l, up }: { l: { tp1Pct: number; tp1Hit: boolean; tp2Pct: number; tp2Hit: boolean; stopPct: number; trailFloorPct: number | null; movePct: number | null }; up: boolean }) {
  // Prototype ladder: stop (left edge) → +100%, or +300% once a runner.
  const min = -l.stopPct;
  const max = l.trailFloorPct !== null ? 300 : 100;
  const L = (v: number) => `${(Math.max(0, Math.min(1, (v - min) / (max - min))) * 100).toFixed(1)}%`;
  const move = l.movePct ?? 0;
  const cur = Math.max(min, Math.min(max, move));
  const lo = Math.min(0, cur);
  const hi = Math.max(0, cur);
  const dotColor = up ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)';
  return (
    <div className="relative" style={{ height: 16 }}>
      <div className="absolute left-0 right-0" style={{ top: 7, height: 2, background: 'var(--ep-border, #2E313F)' }} />
      <div className="absolute" style={{ left: L(lo), width: `${(((hi - lo) / (max - min)) * 100).toFixed(1)}%`, top: 7, height: 2, background: dotColor }} />
      <div title={`Stop ${l.stopPct.toFixed(0)}%`} className="absolute" style={{ left: 0, top: 3, width: 2, height: 10, background: 'var(--ep-neg, #F28881)' }} />
      <div title="Entry" className="absolute" style={{ left: L(0), top: 3, width: 1, height: 10, background: 'var(--ep-muted, #9397AB)' }} />
      <div title={`TP1 +${l.tp1Pct.toFixed(0)}%`} className="absolute" style={{ left: L(l.tp1Pct), top: 3, width: 2, height: 10, background: l.tp1Hit ? 'var(--ep-violet, #9184D9)' : 'var(--ep-ghost, #595D6C)' }} />
      <div title={`TP2 +${l.tp2Pct.toFixed(0)}%`} className="absolute" style={{ left: L(l.tp2Pct), top: 3, width: 2, height: 10, background: l.tp2Hit ? 'var(--ep-violet, #9184D9)' : 'var(--ep-ghost, #595D6C)' }} />
      {l.trailFloorPct !== null && (
        <div title={`Runner floor +${l.trailFloorPct.toFixed(0)}%`} className="absolute" style={{ left: L(l.trailFloorPct), top: 1, width: 8, height: 14, marginLeft: -4, borderRadius: 2, border: '1px dashed #B5ABFC' }} />
      )}
      <div title={`Now ${move >= 0 ? '+' : ''}${move.toFixed(1)}%`} className="absolute rounded-full" style={{ left: L(cur), top: 2, width: 12, height: 12, marginLeft: -6, background: dotColor, boxShadow: '0 0 0 3px #1D1F2C' }} />
    </div>
  );
}

