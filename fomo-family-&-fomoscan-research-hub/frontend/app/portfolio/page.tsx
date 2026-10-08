'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelWithdrawal,
  getPortfolioOverview,
  getStoredToken,
  requestVaultWithdraw,
  withdrawChallenge,
  type PortfolioOverview,
} from '../../lib/api';
import { connectBrowserWallet, signWithBrowserWallet } from '../../lib/solana';
import { CaretDown, CaretUp, LockSimple, X } from '@phosphor-icons/react';
import { LoginModal, restoreSession } from '../../components/LoginModal';
import { SiteFooter, SiteHeader } from '../../components/SiteHeader';
import { Toaster, toast } from '../../components/Toaster';
import type { FundSession } from '../../types/fund';

function WithdrawModal({
  poolId,
  poolName,
  maxShares,
  sharePrice,
  flat,
  onClose,
  onDone,
}: {
  poolId: number;
  poolName: string;
  maxShares: number;
  sharePrice: number;
  flat: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sol = Number(amount) || 0;
  const shares = sharePrice > 0 ? sol / sharePrice : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    const token = getStoredToken();
    if (!token) {
      setErr('Sign in first.');
      return;
    }
    if (!(sol > 0)) {
      setErr('Enter an amount.');
      return;
    }
    if (shares - maxShares > 1e-9) {
      setErr('More than available.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Wallet-signed flow (demo custody bridge): sign a BE challenge so the
      // withdrawal is booked against the verified wallet. No funds move
      // on-chain. Falls back to a session withdrawal when no wallet installed.
      let message: string | undefined;
      let signature: string | undefined;
      try {
        const wallet = await connectBrowserWallet();
        const ch = await withdrawChallenge({ vaultId: poolId, shares, wallet }, token);
        const sig = await signWithBrowserWallet(ch.data.message);
        message = ch.data.message;
        signature = sig.signature;
      } catch (e) {
        setErr(`Wallet signing unavailable (${(e as Error).message}) — continuing as a session withdrawal.`);
      }
      const res = await requestVaultWithdraw({ vaultId: poolId, shares, message, signature }, token);
      onDone(`Withdraw #${res.data.id} ${flat ? 'settled instantly' : 'queued — settles at checkpoint'}.`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(13,15,24,0.72)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="w-full flex flex-col" role="dialog" aria-modal="true" aria-label="Withdraw" style={{ maxWidth: 440, padding: 24, borderRadius: 18, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px #3F424D, 0 24px 60px rgba(0,0,0,0.5)', gap: 14 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <span className="font-display font-medium" style={{ fontSize: 22 }}>Withdraw</span>
          <button onClick={onClose} aria-label="Close" className="grid place-items-center" style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #3F424D', background: 'transparent', color: '#CFD3E5' }}>
            <X size={16} weight="regular" />
          </button>
        </div>
        <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>{poolName} · {maxShares.toFixed(4)} SOL available</span>
        <div className="flex items-center gap-2" style={{ height: 54, borderRadius: 10, boxShadow: 'inset 0 0 0 1px #3F424D', background: '#161826', padding: '0 14px' }}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            aria-label="Withdraw amount in SOL"
            inputMode="decimal"
            className="flex-1 min-w-0 font-mono outline-none bg-transparent"
            style={{ fontSize: 20, fontWeight: 500, color: 'var(--ep-text, #E9E9ED)' }}
          />
          <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>SOL</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0.25, 0.5, 1].map((f) => (
            <button key={f} onClick={() => setAmount(((maxShares * sharePrice * f) || 0).toFixed(2))}
              className="font-medium" style={{ height: 34, borderRadius: 8, fontSize: 13, border: '1px solid #3F424D', background: 'transparent', color: '#CFD3E5' }}>
              {f === 1 ? 'Max' : `${f * 100}%`}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-[13px]" style={{ padding: '12px 14px', borderRadius: 10, background: '#161826' }}>
          <div className="flex justify-between"><span style={{ color: 'var(--ep-muted, #9397AB)' }}>Shares burned</span><span className="font-mono">{shares.toFixed(4)}</span></div>
          <div className="flex justify-between"><span style={{ color: 'var(--ep-muted, #9397AB)' }}>Est. SOL out</span><span className="font-mono">{sol > 0 ? sol.toFixed(2) + ' SOL' : '0.00 SOL'}</span></div>
          <div className="flex justify-between"><span style={{ color: 'var(--ep-muted, #9397AB)' }}>≈ USDC</span><span className="font-mono">$—</span></div>
        </div>
        <span className="text-[13px]" style={{ lineHeight: 1.45, color: '#CFD3E5' }}>
          {flat ? 'Instant · this pool is flat, so SOL is sent now.' : 'Queued · settles at the next checkpoint.'}
        </span>
        {err && <span className="text-xs" style={{ color: 'var(--ep-neg, #F28881)' }}>{err}</span>}
        <button onClick={() => void submit()} disabled={busy}
          className="w-full font-medium disabled:opacity-50"
          style={{ height: 50, borderRadius: 10, fontSize: 15, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
          {flat ? 'Withdraw now' : 'Request withdrawal'}
        </button>
      </div>
    </div>
  );
}

function LoginOverlay({ onClose, onSession }: { onClose: () => void; onSession: () => void }) {
  const [session, setSession] = useState<FundSession | null>(null);
  useEffect(() => {
    void restoreSession().then((s) => {
      if (s) {
        setSession(s);
        onSession();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(13,15,24,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div className="w-full" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <LoginModal
          session={session}
          onSession={(s) => {
            setSession(s);
            if (s) onSession();
          }}
        />
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'value' | 'pnl'>('value');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [wd, setWd] = useState<{ poolId: number; poolName: string; maxShares: number; sharePrice: number; flat: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setError('NOT_CONNECTED');
      setLoading(false);
      return;
    }
    try {
      const res = await getPortfolioOverview(token);
      setData(res.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 180000);
    return () => clearInterval(t);
  }, [refresh]);

  const curve = useMemo(() => {
    if (!data) return [];
    let cum = 0;
    return data.history
      .slice()
      .reverse()
      .map((h) => {
        if (h.type === 'deposit') cum += h.amountSol;
        else if (h.type === 'withdrawal_settled') cum -= h.amountSol;
        return { t: new Date(h.date).getTime(), v: tab === 'value' ? cum : cum - data.totalDepositedSol + data.totalWithdrawnSol };
      });
  }, [data, tab]);

  const W = 300;
  const H = 100;
  const vs = curve.map((p) => p.v);
  const min = vs.length ? Math.min(...vs) : 0;
  const max = vs.length ? Math.max(...vs) : 1;
  const span = max - min || 1;
  const d = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, curve.length - 1)) * W).toFixed(1)},${(92 - ((p.v - min) / span) * 80).toFixed(1)}`).join(' ');

  if (error === 'NOT_CONNECTED') {
    return (
      <>
        <SiteHeader active="portfolio" />
        <div className="mx-auto w-full flex flex-col" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px', gap: 24 }}>
          <h1 className="font-display font-medium" style={{ fontSize: 'clamp(30px,4vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>Portfolio</h1>
          <div className="grid items-center" style={{ padding: 'clamp(24px,4vw,48px)', borderRadius: 18, background: 'radial-gradient(60% 120% at 100% 0%, rgba(3,45,42,0.7), transparent 65%), var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,320px),1fr))', gap: 32 }}>
            <div className="flex flex-col gap-3">
              <span className="font-display font-medium" style={{ fontSize: 'clamp(22px,3vw,30px)', letterSpacing: '-0.02em' }}>Connect a wallet to see your pools</span>
              <span className="text-[15px]" style={{ lineHeight: 1.5, color: 'var(--ep-muted, #9397AB)' }}>Your value, PnL, positions and withdrawals live here once you&apos;ve deposited into a pool.</span>
            </div>
            <button onClick={() => setLoginOpen(true)} className="font-medium" style={{ height: 50, borderRadius: 10, fontSize: 15, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
              Connect wallet
            </button>
          </div>
          <SiteFooter />
        </div>
        {loginOpen && (
          <LoginOverlay onClose={() => setLoginOpen(false)} onSession={() => { setLoginOpen(false); void refresh(); }} />
        )}
      </>
    );
  }

  const empty = data && data.pools.length === 0;
  const pnlPct = data && data.totalDepositedSol - data.totalWithdrawnSol > 0
    ? (data.returnsSol / (data.totalDepositedSol - data.totalWithdrawnSol)) * 100
    : 0;

  return (
    <>
      <SiteHeader active="portfolio" />
      <div className="mx-auto w-full flex flex-col" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px', gap: 24 }}>
      <h1 className="font-display font-medium" style={{ fontSize: 'clamp(30px,4vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>Portfolio</h1>
      {error && <p className="text-xs mt-2" style={{ color: 'var(--ep-neg, #F28881)' }}>{error}</p>}
      {msg && <p className="text-xs mt-2" style={{ color: 'var(--ep-aqua-100, #BBF6EE)' }}>{msg}</p>}

      {empty ? (
        <div className="flex justify-between items-center gap-6 flex-wrap" style={{ padding: 'clamp(24px,4vw,48px)', borderRadius: 18, border: '1px dashed #3F424D' }}>
          <div className="flex flex-col gap-2.5">
            <span className="font-mono font-medium" style={{ fontSize: 32 }}>0.00 SOL</span>
            <span className="font-display font-medium" style={{ fontSize: 22 }}>No deposits yet</span>
            <span className="text-[15px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Pick a pool and deposit 0.5 SOL or more to unlock its live signals.</span>
          </div>
          <Link href="/" className="font-medium flex items-center" style={{ height: 50, padding: '0 24px', borderRadius: 10, fontSize: 15, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
            Browse pools →
          </Link>
        </div>
      ) : loading && !data ? (
        <div className="ep-enter" aria-hidden>
          <div className="ep-skel mt-2" style={{ width: 'min(320px,70%)', height: 44 }} />
          <div className="ep-skel mt-2" style={{ width: 180, height: 14 }} />
          <div className="ep-skel mt-2" style={{ width: 240, height: 14 }} />
          <div className="ep-skel mt-4" style={{ width: '100%', height: 120 }} />
          <div className="ep-skel mt-6" style={{ width: '100%', height: 76 }} />
          <div className="ep-skel mt-3" style={{ width: '100%', height: 76 }} />
        </div>
      ) : (
        data && (
          <div className="flex flex-col" style={{ gap: 24 }}>
            <div className="grid items-center" style={{ padding: '24px 28px', borderRadius: 18, background: 'radial-gradient(60% 120% at 0% 0%, rgba(3,45,42,0.6), transparent 65%), var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,320px),1fr))', gap: 32 }}>
              <div className="flex flex-col gap-3">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Total value</span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono font-medium" style={{ fontSize: 'clamp(30px,4vw,40px)', letterSpacing: '-0.02em' }}>{data.totalValueSol.toFixed(2)} SOL</span>
                  <span className="font-mono" style={{ fontSize: 13, color: 'var(--ep-ghost, #595D6C)' }}>≈ $—</span>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono" style={{ fontSize: 20, color: data.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                    {data.returnsSol >= 0 ? '+' : ''}{data.returnsSol.toFixed(2)} SOL
                  </span>
                  <span className="font-mono" style={{ fontSize: 15, color: data.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </span>
                  <span className="text-xs" style={{ color: 'var(--ep-faint, #75798C)' }}>total PnL</span>
                </div>
                <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                  Deposited {data.totalDepositedSol.toFixed(2)} SOL · Withdrawn {data.totalWithdrawnSol.toFixed(2)} SOL
                </span>
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>
                    {tab === 'value' ? 'Portfolio value · since first deposit' : 'Total PnL · since first deposit'}
                  </span>
                  <div className="flex p-[3px] rounded-lg" style={{ background: '#161826', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                    {(['value', 'pnl'] as const).map((t) => (
                      <button key={t} onClick={() => setTab(t)} className="font-medium capitalize"
                        style={tab === t ? { height: 28, padding: '0 14px', borderRadius: 6, fontSize: 12, background: '#2E313F', color: '#E9E9ED' } : { height: 28, padding: '0 14px', borderRadius: 6, fontSize: 12, background: 'transparent', color: 'var(--ep-muted, #9397AB)' }}>
                        {t === 'value' ? 'Value' : 'PnL'}
                      </button>
                    ))}
                  </div>
                </div>
                {curve.length > 1 && (
                  <svg key={tab} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ep-fade w-full block" style={{ height: 130 }} aria-hidden>
                    <path d={`M0 25H${W}M0 50H${W}M0 75H${W}`} stroke="#2E313F" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <path d={`${d} L${W},${H} L0,${H} Z`} fill="rgba(73,230,215,0.09)" />
                    <path d={d} fill="none" stroke="#49E6D7" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>

            <div className="overflow-hidden" style={{ borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
              <div className="font-mono text-[11px] tracking-widest uppercase" style={{ padding: '16px 22px', color: 'var(--ep-faint, #75798C)' }}>My pools</div>
              {data.pools.map((p) => {
                const qSol = data.pending.filter((q) => q.poolId === p.vaultId).reduce((a, q) => a + q.shares, 0) * p.sharePrice;
                const isFlat = p.flat && qSol <= 0;
                const status = qSol > 0 ? `${qSol.toFixed(2)} SOL queued` : isFlat ? 'Flat · instant exit' : `${p.openCount} open · queued exit`;
                const stGreen = isFlat && qSol <= 0;
                const open = expanded === p.vaultId;
                return (
                  <div key={p.vaultId} style={{ borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                    <div className="grid items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,150px),1fr))', gap: '12px 18px', padding: '16px 22px', fontSize: 13 }}>
                      <span className="flex flex-col gap-0.5" style={{ gridColumn: 'span 2' }}>
                        <Link href={`/pools/${p.vaultId}`} className="font-medium" style={{ fontSize: 15, color: 'var(--ep-text, #E9E9ED)' }}>{p.poolName}</Link>
                        <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{p.kind === 'basket' ? 'Edgepool basket · algorithm-ranked' : `Partner pool · @${p.poolName.replace(/^Edgepool /, '')}`}</span>
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono">{p.valueSol.toFixed(2)} SOL</span>
                        <span className="font-mono" style={{ fontSize: 11, color: 'var(--ep-ghost, #595D6C)' }}>≈ $—</span>
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono" style={{ color: p.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                          {p.returnsSol >= 0 ? '+' : ''}{p.returnsSol.toFixed(2)} SOL
                        </span>
                        <span className="font-mono" style={{ fontSize: 11, color: 'var(--ep-muted, #9397AB)' }}>
                          {p.sharePricePct >= 0 ? '+' : ''}{p.sharePricePct.toFixed(1)}% share price
                        </span>
                      </span>
                      <span className="justify-self-start text-[11px]" style={{ padding: '4px 8px', borderRadius: 6, background: stGreen ? '#004B45' : '#2E313F', color: stGreen ? '#BBF6EE' : '#CFD3E5' }}>
                        {status}
                      </span>
                      <span className="flex justify-end gap-2">
                        <button onClick={() => setExpanded(open ? null : p.vaultId)}
                          className="font-medium flex items-center gap-1.5" style={{ height: 34, padding: '0 12px', borderRadius: 8, fontSize: 12, border: '1px solid #3F424D', background: 'transparent', color: '#CFD3E5' }}>
                          Detail {open ? <CaretUp size={13} weight="regular" /> : <CaretDown size={13} weight="regular" />}
                        </button>
                        <button onClick={() => setWd({ poolId: p.vaultId, poolName: p.poolName, maxShares: p.shares, sharePrice: p.sharePrice > 0 ? p.sharePrice : 1, flat: p.flat })}
                          className="font-medium" style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 12, border: '1px solid var(--ep-aqua, #49E6D7)', background: 'transparent', color: 'var(--ep-aqua, #49E6D7)' }}>
                          Withdraw
                        </button>
                      </span>
                    </div>
                    {open && (
                      <div className="grid text-xs" style={{ margin: '0 22px 16px', padding: '14px 18px', borderRadius: 10, background: '#161826', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,260px),1fr))', gap: '16px 24px' }}>
                        <div className="flex flex-col gap-1">
                          <span style={{ color: 'var(--ep-faint, #75798C)' }}>Cash-flow PnL · value − deposited + withdrawn</span>
                          <span className="font-mono" style={{ fontSize: 13, color: '#CFD3E5' }}>
                            {p.valueSol.toFixed(2)} − {p.depositedSol.toFixed(2)} + {p.withdrawnSol.toFixed(2)} = {p.returnsSol >= 0 ? '+' : ''}{p.returnsSol.toFixed(2)} SOL
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span style={{ color: 'var(--ep-faint, #75798C)' }}>Share-price PnL · avg entry → now</span>
                          <span className="font-mono" style={{ fontSize: 13, color: '#CFD3E5' }}>
                            {p.avgEntrySol.toFixed(4)} → {p.sharePrice.toFixed(4)} SOL ({p.sharePricePct >= 0 ? '+' : ''}{p.sharePricePct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,420px),1fr))', gap: 20 }}>
              <div style={{ padding: '18px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column' }}>
                <div className="flex justify-between items-baseline gap-2 flex-wrap" style={{ paddingBottom: 8 }}>
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Open positions across pools</span>
                  <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>My exposure = my share of the pool</span>
                </div>
                {data.pools.filter((pl) => pl.valueSol < 0.5 && data.exposures.some((e) => e.poolId === pl.vaultId)).map((pl) => (
                  <div key={pl.vaultId} className="flex items-center gap-2 text-xs" style={{ marginBottom: 8, padding: '9px 12px', borderRadius: 8, background: '#2B2741', color: '#D2CEFD' }}>
                    <LockSimple size={14} weight="regular" />
                    Hold 0.5 SOL or more in {pl.poolName.replace(/^Edgepool /, '')} to see its tokens.
                  </div>
                ))}
                {data.exposures.length === 0 && (
                  <span style={{ padding: '12px 0', borderTop: '1px solid var(--ep-border, #2E313F)', fontSize: 13, color: 'var(--ep-muted, #9397AB)' }}>
                    None of your pools have open positions right now.
                  </span>
                )}
                {data.exposures.slice(0, 20).map((e, i) => {
                  const masked = (data.pools.find((pl) => pl.vaultId === e.poolId)?.valueSol ?? 0) < 0.5;
                  const up = (e.unrealizedPct ?? 0) >= 0;
                  return (
                    <div key={i} className="grid items-center text-[13px]" style={{ gridTemplateColumns: '1fr auto', gap: 12, padding: '10px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium" style={{ letterSpacing: masked ? '0.12em' : 0 }}>{masked ? '$••••' : e.token}</span>
                        <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                          {e.poolName.replace(/^Edgepool /, '')} · my exposure {masked ? '•••' : `${e.mySizeSol.toFixed(4)} SOL`}
                        </span>
                      </div>
                      <span className="font-mono" style={{ color: up ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                        {e.unrealizedPct === null || e.unrealizedPct === undefined ? '—' : `${up ? '+' : ''}${e.unrealizedPct.toFixed(1)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col" style={{ gap: 20 }}>
                <div style={{ padding: '18px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Pending withdrawals</span>
                  {data.pending.length === 0 && (
                    <span className="text-[13px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Nothing queued. Pools that are flat pay out instantly.</span>
                  )}
                  {data.pending.map((q) => {
                    const pl = data.pools.find((pp) => pp.vaultId === q.poolId);
                    return (
                      <PendingRow
                        key={q.id}
                        q={q}
                        poolName={pl?.poolName ?? q.poolName}
                        estSol={q.shares * (pl?.sharePrice ?? 1)}
                        onCancel={refresh}
                      />
                    );
                  })}
                </div>

                <div style={{ padding: '18px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column' }}>
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)', paddingBottom: 6 }}>Deposit and withdrawal history</span>
                  {data.history.slice(0, 20).map((h, i) => {
                    const flat = data.pools.find((pl) => pl.vaultId === h.poolId)?.flat ?? false;
                    const label = h.type === 'deposit' ? 'Deposit' : h.type === 'withdrawal_settled' ? (flat ? 'Withdrawal · instant' : 'Withdrawal') : h.type === 'withdrawal_cancelled' ? 'Withdrawal · cancelled' : 'Withdrawal · queued';
                    const amt = h.type === 'deposit' ? h.amountSol : -h.amountSol;
                    return (
                      <div key={i} className="grid items-center text-xs" style={{ gridTemplateColumns: '56px 1fr auto', gap: 12, padding: '9px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                        <span style={{ color: 'var(--ep-faint, #75798C)' }}>
                          {new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="flex flex-col gap-[1px]">
                          <span>{label}</span>
                          <span style={{ color: 'var(--ep-faint, #75798C)' }}>{h.poolName.replace(/^Edgepool /, '')}{h.tx && h.tx !== '—' ? ` · ${h.tx}` : ''}</span>
                        </span>
                        <span className="flex flex-col items-end gap-[1px]">
                          <span className="font-mono">{amt >= 0 ? '+' : '−'}{Math.abs(amt).toFixed(2)} SOL</span>
                          <span className="font-mono" style={{ fontSize: 11, color: 'var(--ep-muted, #9397AB)' }}>
                            {h.sharesDelta >= 0 ? '+' : ''}{h.sharesDelta.toFixed(4)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {wd && (
        <WithdrawModal
          poolId={wd.poolId} poolName={wd.poolName} maxShares={wd.maxShares} sharePrice={wd.sharePrice} flat={wd.flat}
          onClose={() => setWd(null)}
          onDone={(m) => {
            setMsg(m);
            toast(m);
            void refresh();
          }}
        />
      )}

      <SiteFooter />
    </div>
    <Toaster />
    </>
  );
}

function PendingRow({ q, poolName, estSol, onCancel }: { q: PortfolioOverview['pending'][number]; poolName: string; estSol: number; onCancel: () => void }) {
  const target = q.nextCheckpointAt ? new Date(q.nextCheckpointAt).getTime() : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const cd = target ? Math.max(0, target - now) : null;
  const label = cd === null ? '—' : cd <= 0 ? 'settling…' : `${Math.floor(cd / 3600000)}h ${Math.floor((cd % 3600000) / 60000)}m ${Math.floor((cd % 60000) / 1000)}s`;

  async function cancel() {
    const token = getStoredToken();
    if (!token) return;
    await cancelWithdrawal(q.id, token);
    onCancel();
  }

  return (
    <div className="flex justify-between items-center gap-3 flex-wrap text-[13px]" style={{ padding: '12px 14px', borderRadius: 10, background: '#161826' }}>
      <span><b className="font-medium">{estSol.toFixed(2)} SOL</b> <span style={{ color: 'var(--ep-muted, #9397AB)' }}>· {poolName.replace(/^Edgepool /, '')}</span></span>
      <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        Settles in <span className="font-mono" style={{ color: 'var(--ep-aqua, #49E6D7)', padding: '1px 6px', borderRadius: 5, background: 'rgba(73,230,215,0.1)' }}>{label}</span>
      </span>
      <button onClick={() => void cancel()} className="font-medium text-xs" style={{ height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid #3F424D', background: 'transparent', color: '#CFD3E5' }}>
        Cancel
      </button>
    </div>
  );
}
