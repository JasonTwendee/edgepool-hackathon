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
      <div className="w-full rounded-2xl p-5 space-y-3" style={{ maxWidth: 440, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-medium">Withdraw · {poolName}</h2>
        <div className="text-[11px] font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          {maxShares.toFixed(4)} shares available
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          inputMode="decimal"
          className="w-full font-mono text-xl px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}
        />
        <div className="flex gap-2">
          {[0.25, 0.5, 1].map((f) => (
            <button key={f} onClick={() => setAmount(((maxShares * sharePrice * f) || 0).toFixed(4))}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
              style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
              {f === 1 ? 'Max' : `${f * 100}%`}
            </button>
          ))}
        </div>
        <div className="text-[11px] font-mono space-y-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          <div className="flex justify-between"><span>Shares burned</span><span>{shares.toFixed(4)}</span></div>
          <div className="flex justify-between"><span>Est. SOL out</span><span>{sol.toFixed(4)}</span></div>
          <div className="flex justify-between"><span>Mode</span><span>{flat ? 'Instant' : 'Queued · settles at checkpoint'}</span></div>
        </div>
        {err && <p className="text-[11px]" style={{ color: 'var(--ep-neg, #F28881)' }}>{err}</p>}
        <button onClick={() => void submit()} disabled={busy}
          className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
          {flat ? 'Withdraw now' : 'Request withdrawal'}
        </button>
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

  const refresh = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setError('NOT_CONNECTED');
      return;
    }
    try {
      const res = await getPortfolioOverview(token);
      setData(res.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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

  const W = 600;
  const H = 120;
  const vs = curve.map((p) => p.v);
  const min = vs.length ? Math.min(...vs) : 0;
  const max = vs.length ? Math.max(...vs) : 1;
  const span = max - min || 1;
  const d = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, curve.length - 1)) * W).toFixed(1)},${(H - 6 - ((p.v - min) / span) * (H - 12)).toFixed(1)}`).join(' ');

  if (error === 'NOT_CONNECTED') {
    return (
      <div className="mx-auto w-full text-center" style={{ maxWidth: 1240, padding: '80px clamp(16px,4vw,40px)' }}>
        <h1 className="font-display font-medium" style={{ fontSize: 'clamp(28px,3.5vw,40px)' }}>Portfolio</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>Connect your wallet or sign in to see your positions.</p>
        <Link href="/terminal" className="inline-block mt-4 text-sm font-bold px-4 py-2 rounded-lg" style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
          Sign in
        </Link>
      </div>
    );
  }

  const empty = data && data.pools.length === 0;
  const pnlPct = data && data.totalDepositedSol - data.totalWithdrawnSol > 0
    ? (data.returnsSol / (data.totalDepositedSol - data.totalWithdrawnSol)) * 100
    : 0;

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }}>
      <h1 className="font-display font-medium" style={{ fontSize: 'clamp(28px,3.5vw,40px)', letterSpacing: '-0.03em' }}>Portfolio</h1>
      {error && <p className="text-xs mt-2" style={{ color: 'var(--ep-neg, #F28881)' }}>{error}</p>}
      {msg && <p className="text-xs mt-2" style={{ color: 'var(--ep-aqua-100, #BBF6EE)' }}>{msg}</p>}

      {empty ? (
        <div className="text-center mt-10">
          <div className="font-mono" style={{ fontSize: 'clamp(30px,4vw,40px)' }}>0.00 SOL</div>
          <p className="text-sm mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>No deposits yet</p>
          <Link href="/" className="inline-block mt-4 text-sm font-bold px-4 py-2 rounded-lg" style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
            Browse pools
          </Link>
        </div>
      ) : (
        data && (
          <>
            <div className="font-mono mt-2" style={{ fontSize: 'clamp(30px,4vw,40px)' }}>
              {data.totalValueSol.toFixed(4)} <span className="text-lg">SOL</span>
            </div>
            <div className="text-xs" style={{ color: 'var(--ep-ghost, #595D6C)' }}>≈ $—</div>
            <div className="font-mono text-sm mt-1" style={{ color: data.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
              {data.returnsSol >= 0 ? '+' : ''}{data.returnsSol.toFixed(4)} SOL ({pnlPct.toFixed(1)}%)
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
              Deposited {data.totalDepositedSol.toFixed(2)} · Withdrawn {data.totalWithdrawnSol.toFixed(2)}
            </div>

            <div className="flex gap-1 mt-3">
              {(['value', 'pnl'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className="text-xs font-bold px-3 py-1.5 rounded-lg capitalize"
                  style={tab === t ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { color: 'var(--ep-muted, #9397AB)' }}>
                  {t === 'value' ? 'Value' : 'PnL'}
                </button>
              ))}
            </div>
            {curve.length > 1 && (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2" style={{ height: 120 }} aria-hidden>
                <path d={`${d} L${W},${H} L0,${H} Z`} fill="var(--ep-aqua, #49E6D7)" opacity={0.1} />
                <path d={d} fill="none" stroke="var(--ep-aqua, #49E6D7)" strokeWidth={2} strokeLinecap="round" />
              </svg>
            )}

            <h2 className="font-display text-base font-medium mt-6">My pools</h2>
            <div className="space-y-2 mt-2">
              {data.pools.map((p) => (
                <div key={p.vaultId} className="rounded-2xl p-4" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Link href={`/pools/${p.vaultId}`} className="font-bold text-sm">{p.poolName}</Link>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>{p.kind}</span>
                    <span className="font-mono text-sm font-bold">{p.valueSol.toFixed(4)} SOL</span>
                    <span className="font-mono text-xs" style={{ color: p.returnsSol >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                      {p.returnsSol >= 0 ? '+' : ''}{p.returnsSol.toFixed(4)}
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                      {p.flat ? 'Flat · instant exit' : `${p.openCount} open · queued exit`}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setExpanded(expanded === p.vaultId ? null : p.vaultId)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                        Detail
                      </button>
                      <button onClick={() => setWd({ poolId: p.vaultId, poolName: p.poolName, maxShares: p.shares, sharePrice: p.valueSol > 0 && p.shares > 0 ? p.valueSol / p.shares : 1, flat: p.flat })}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua, #49E6D7)' }}>
                        Withdraw
                      </button>
                    </div>
                  </div>
                  {expanded === p.vaultId && (
                    <div className="mt-2 text-[11px] font-mono rounded-lg p-2.5 space-y-1" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', color: 'var(--ep-text-3, #B2B6CA)' }}>
                      <div className="flex justify-between"><span>Cash-flow PnL</span><span>{p.returnsSol.toFixed(4)} SOL</span></div>
                      <div className="flex justify-between"><span>Share-price PnL</span><span>{p.depositedSol > 0 ? (((p.valueSol + p.withdrawnSol) / p.depositedSol - 1) * 100).toFixed(1) : '0.0'}%</span></div>
                      <div className="flex justify-between"><span>Shares / Deposited / Withdrawn</span><span>{p.shares.toFixed(2)} / {p.depositedSol.toFixed(2)} / {p.withdrawnSol.toFixed(2)}</span></div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {data.exposures.length > 0 && (
              <>
                <h2 className="font-display text-base font-medium mt-6">Open positions across pools</h2>
                <ul className="mt-2 space-y-2">
                  {data.exposures.slice(0, 20).map((e, i) => (
                    <li key={i} className="flex items-center justify-between text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                      <span className="font-bold">{e.token}</span>
                      <span style={{ color: 'var(--ep-muted, #9397AB)' }}>{e.poolName}</span>
                      <span className="font-mono">{e.mySizeSol.toFixed(4)} SOL</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {data.pending.length > 0 && (
              <>
                <h2 className="font-display text-base font-medium mt-6">Pending withdrawals</h2>
                <ul className="mt-2 space-y-2">
                  {data.pending.map((q) => (
                    <PendingRow key={q.id} q={q} onCancel={refresh} />
                  ))}
                </ul>
              </>
            )}

            <h2 className="font-display text-base font-medium mt-6">History</h2>
            <div className="mt-2 rounded-2xl overflow-hidden" style={{ boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', color: 'var(--ep-faint, #75798C)' }}>
                    <th className="text-left font-medium px-3 py-2">Date</th>
                    <th className="text-left font-medium px-3 py-2">Type</th>
                    <th className="text-left font-medium px-3 py-2">Pool</th>
                    <th className="text-right font-medium px-3 py-2">SOL</th>
                    <th className="text-right font-medium px-3 py-2">Shares</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.slice(0, 50).map((h, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--ep-row-rule, #26283A)' }}>
                      <td className="px-3 py-2 font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>{h.date.slice(0, 10)}</td>
                      <td className="px-3 py-2">{h.type}</td>
                      <td className="px-3 py-2">{h.poolName}</td>
                      <td className="px-3 py-2 text-right font-mono">{h.amountSol.toFixed(4)}</td>
                      <td className="px-3 py-2 text-right font-mono">{h.sharesDelta >= 0 ? '+' : ''}{h.sharesDelta.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {wd && (
        <WithdrawModal
          poolId={wd.poolId} poolName={wd.poolName} maxShares={wd.maxShares} sharePrice={wd.sharePrice} flat={wd.flat}
          onClose={() => setWd(null)}
          onDone={(m) => {
            setMsg(m);
            void refresh();
          }}
        />
      )}

      <div className="mt-6">
        <Link href="/" className="text-sm" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
        <span className="text-sm mx-2" style={{ color: 'var(--ep-ghost, #595D6C)' }}>·</span>
        <Link href="/terminal" className="text-sm" style={{ color: 'var(--ep-muted, #9397AB)' }}>Terminal</Link>
      </div>
    </div>
  );
}

function PendingRow({ q, onCancel }: { q: PortfolioOverview['pending'][number]; onCancel: () => void }) {
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
    <li className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
      <span className="font-mono">#{q.id} · {q.poolName} · {q.shares.toFixed(2)} shares</span>
      <span className="flex items-center gap-2">
        <span className="font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>{label}</span>
        <button onClick={() => void cancel()} className="text-[11px] font-bold px-2 py-1 rounded-lg" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
          Cancel
        </button>
      </span>
    </li>
  );
}
