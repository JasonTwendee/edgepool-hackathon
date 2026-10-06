'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  getStoredToken,
  loginAccount,
  partnerApply,
  partnerClaim,
  partnerMe,
  partnerPauseTrader,
  partnerPayouts,
  partnerPoolTraders,
  partnerRequestTrader,
  partnerSetPayoutWallet,
  partnerSignals,
  partnerUpdateSettings,
  storeSession,
  type PartnerMe,
} from '../../lib/api';

const inputCls =
  'w-full text-sm bg-[#0D0F18] border border-[#3F424D] rounded-lg px-3 py-2.5 text-[#E9E9ED] placeholder:text-[#4A4D5E] outline-none focus:border-[#E9E9ED]';

export default function TraderPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<'signin' | 'apply'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fomo, setFomo] = useState('');
  const [x, setX] = useState('');
  const [wallet, setWallet] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [poolId, setPoolId] = useState<number | null>(null);
  const [traders, setTraders] = useState<{ wallet: string; handle: string; isActive: boolean; weightBps: number; signals7d: number; profitUsd: number; feeSol: number }[]>([]);
  const [signals, setSignals] = useState<{ id: number; token: string; trader: string; status: string; profitUsd: number | null }[]>([]);
  const [payouts, setPayouts] = useState<{ id: number; trader: string; amountSol: number; status: string; createdAt: string }[]>([]);
  const [payoutInput, setPayoutInput] = useState('');
  const [poolName, setPoolName] = useState('');
  const [maxSlots, setMaxSlots] = useState('');
  const [reqFomo, setReqFomo] = useState('');

  const load = useCallback(async (t: string) => {
    const res = await partnerMe(t);
    setMe(res.data);
    if (res.data.pools.length > 0 && poolId === null) setPoolId(res.data.pools[0].id);
  }, [poolId]);

  useEffect(() => {
    const t = getStoredToken();
    if (t) {
      setToken(t);
      void load(t).catch(() => undefined);
    }
  }, [load]);

  useEffect(() => {
    if (!token || poolId === null) return;
    void partnerPoolTraders(token, poolId).then((r) => setTraders(r.data)).catch(() => undefined);
    void partnerSignals(token, poolId).then((r) => setSignals(r.data)).catch(() => undefined);
    void partnerPayouts(token).then((r) => setPayouts(r.data)).catch(() => undefined);
  }, [token, poolId]);

  async function signin() {
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await loginAccount({ username: username.trim(), password });
      storeSession(res.data);
      setToken(res.data.token);
      await load(res.data.token);
      setMsg(`Signed in (${res.data.user.role}).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await partnerApply({ fomoHandle: fomo.trim(), xHandle: x.trim() || undefined, wallet: wallet.trim(), contact: contact.trim() });
      setMsg(`Application #${res.data.id} received — the Edgepool team will review it.`);
      setFomo('');
      setX('');
      setWallet('');
      setContact('');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(patch: Record<string, unknown>, okMsg: string) {
    if (!token || poolId === null) return;
    setBusy(true);
    setMsg(null);
    try {
      await partnerUpdateSettings(token, poolId, patch);
      if (token) await load(token);
      setMsg(okMsg);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token || !me) {
    return (
      <div className="mx-auto w-full grid gap-6 md:grid-cols-2" style={{ maxWidth: 1000, padding: '28px clamp(16px,4vw,40px) 64px' }}>
        <div className="rounded-2xl p-8 flex flex-col justify-center" style={{ background: 'var(--ep-violet-tint, #2B2741)' }}>
          <h1 className="font-display font-medium" style={{ fontSize: 'clamp(26px,3vw,36px)' }}>Run your own copy pool.</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
            Partner pools earn 15% of their own profitable trades. Edgepool takes 5%.
          </p>
        </div>
        <div className="rounded-2xl p-6 space-y-3" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
          <div className="flex gap-2">
            {(['signin', 'apply'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setMsg(null); }} className="text-xs font-bold px-3 py-1.5 rounded-lg capitalize"
                style={tab === t ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { color: 'var(--ep-muted, #9397AB)' }}>
                {t === 'signin' ? 'Sign in' : 'Apply'}
              </button>
            ))}
          </div>
          {tab === 'signin' ? (
            <div className="space-y-2.5">
              <p className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Use the login your Edgepool contact sent you. Accounts are created manually — no self-sign-up.</p>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" className={inputCls} />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === 'Enter') void signin(); }} className={inputCls} />
              <button onClick={() => void signin()} disabled={busy} className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--ep-text, #E9E9ED)', color: '#161826' }}>
                Sign in
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <input value={fomo} onChange={(e) => setFomo(e.target.value)} placeholder="Fomo handle" className={inputCls} />
              <input value={x} onChange={(e) => setX(e.target.value)} placeholder="X handle (optional)" className={inputCls} />
              <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Trading wallet (Base58)" className={`${inputCls} font-mono`} />
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or Telegram" className={inputCls} />
              <button onClick={() => void apply()} disabled={busy} className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--ep-text, #E9E9ED)', color: '#161826' }}>
                Submit application
              </button>
            </div>
          )}
          {msg && <p className="text-[11px] break-all" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}
          <Link href="/" className="text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
        </div>
      </div>
    );
  }

  const pool = me.pools.find((p) => p.id === poolId) ?? me.pools[0] ?? null;

  return (
    <div className="mx-auto w-full space-y-4" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="font-mono text-sm font-bold">@{me.handle}</span>
          <span className="text-[11px] font-mono ml-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
            {me.payoutWallet ? `payout → ${me.payoutWallet.slice(0, 6)}…${me.payoutWallet.slice(-4)}` : 'no payout wallet'}
          </span>
        </div>
        <Link href="/" className="text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
      </div>
      {msg && <p className="text-[11px]" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}

      {!me.payoutWallet && (
        <div className="rounded-2xl p-4 flex flex-wrap items-center gap-2" style={{ background: 'rgba(145,132,217,0.12)', boxShadow: '0 0 0 1px var(--ep-violet, #9184D9)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--ep-violet-100, #D2CEFD)' }}>Connect a payout wallet to claim fees.</span>
          <input value={payoutInput} onChange={(e) => setPayoutInput(e.target.value)} placeholder="Payout wallet (Base58)"
            className="flex-1 min-w-[200px] text-xs font-mono px-2.5 py-2 rounded-lg outline-none"
            style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }} />
          <button
            onClick={() => {
              if (!token || !payoutInput.trim()) return;
              void partnerSetPayoutWallet(token, payoutInput.trim())
                .then(() => {
                  setPayoutInput('');
                  return load(token);
                })
                .then(() => setMsg('Payout wallet connected.'))
                .catch((e) => setMsg((e as Error).message));
            }}
            className="text-xs font-bold px-3 py-2 rounded-lg" style={{ background: 'var(--ep-violet, #9184D9)', color: '#0D0F18' }}>
            Connect
          </button>
        </div>
      )}

      <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-display text-base font-medium">Fees</h2>
        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
          {[
            ['Pending', `${me.fees.pendingSol.toFixed(4)} SOL`],
            ['Claimable', `${me.fees.claimableSol.toFixed(4)} SOL`],
            ['Paid to date', `${me.fees.paidSol.toFixed(4)} SOL`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg p-2.5" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <div className="text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{k}</div>
              <div className="text-sm font-mono font-bold">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            disabled={!token || !me.payoutWallet || me.fees.claimableSol <= 0}
            onClick={() => {
              if (!token) return;
              void partnerClaim(token).then((r) => {
                setMsg(`Claimed ${r.data.claimedSol.toFixed(4)} SOL across ${r.data.rows} rows (recorded; auto-paid at checkpoint).`);
                return load(token);
              }).catch((e) => setMsg((e as Error).message));
            }}
            className="text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
            Claim
          </button>
          <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Auto-paid at each checkpoint.</span>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          Traders in this pool earn <b style={{ color: 'var(--ep-aqua, #49E6D7)' }}>15%</b> of their own profitable trades. Edgepool takes <b style={{ color: 'var(--ep-violet, #9184D9)' }}>5%</b>.
        </p>
      </section>

      {me.pools.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {me.pools.map((p) => (
            <button key={p.id} onClick={() => setPoolId(p.id)} className="text-xs font-bold px-3 py-1.5 rounded-lg"
              style={pool?.id === p.id ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {pool && (
        <section className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
          <h2 className="font-display text-base font-medium">My pool · {pool.name}</h2>
          <div className="text-xs font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
            NAV {pool.navSol.toFixed(2)} SOL · {pool.status} · {pool.listing}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={poolName} onChange={(e) => setPoolName(e.target.value)} placeholder="Pool name" className={inputCls} />
            <input value={maxSlots} onChange={(e) => setMaxSlots(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Max slots" inputMode="numeric" className={inputCls} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => void saveSettings({ name: poolName || undefined }, 'Pool renamed.').then(() => setPoolName(''))}
              disabled={busy || !poolName.trim()} className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
              Rename
            </button>
            <button onClick={() => void saveSettings({ status: pool.status === 'live' ? 'paused' : 'live' }, pool.status === 'live' ? 'Pool paused.' : 'Pool live.')}
              disabled={busy} className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--ep-amber, #F0BE67)', color: 'var(--ep-amber, #F0BE67)' }}>
              {pool.status === 'live' ? 'Pause pool' : 'Resume pool'}
            </button>
            <button onClick={() => void saveSettings({ listing: pool.listing === 'public' ? 'unlisted' : 'public' }, 'Listing updated.')}
              disabled={busy} className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
              Make {pool.listing === 'public' ? 'unlisted' : 'public'}
            </button>
            <button onClick={() => maxSlots && void saveSettings({ maxSlots: Number(maxSlots) }, 'Slots updated.').then(() => setMaxSlots(''))}
              disabled={busy || !maxSlots} className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
              Set slots
            </button>
            <Link href={`/pools/${pool.id}`} className="text-xs font-bold px-3 py-2 rounded-lg" style={{ border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua, #49E6D7)' }}>
              View public page
            </Link>
          </div>

          <h3 className="font-display text-sm font-medium pt-1">Traders</h3>
          <ul className="space-y-2">
            {traders.map((t) => (
              <li key={t.wallet} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2 flex-wrap" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                <span className="font-bold font-mono" title={t.wallet}>@{t.handle}</span>
                <span className="font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                  {t.isActive ? 'active' : 'paused'} · {t.signals7d} signals 7d · {t.profitUsd >= 0 ? '+' : ''}{t.profitUsd} · fee {t.feeSol.toFixed(4)}
                </span>
                <button
                  onClick={() => {
                    if (!token) return;
                    void partnerPauseTrader(token, pool.id, t.wallet, !t.isActive)
                      .then(() => partnerPoolTraders(token, pool.id).then((r) => setTraders(r.data)))
                      .catch((e) => setMsg((e as Error).message));
                  }}
                  className="text-[11px] font-bold px-2 py-1 rounded-lg"
                  style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                  {t.isActive ? 'Pause' : 'Resume'}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input value={reqFomo} onChange={(e) => setReqFomo(e.target.value)} placeholder="Request trader (Fomo handle)"
              className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-lg outline-none"
              style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }} />
            <button
              onClick={() => {
                if (!token || !reqFomo.trim()) return;
                void partnerRequestTrader(token, pool.id, { fomoHandle: reqFomo.trim() })
                  .then(() => {
                    setReqFomo('');
                    return load(token);
                  })
                  .then(() => setMsg('Trader requested — pending until Edgepool creates the account.'))
                  .catch((e) => setMsg((e as Error).message));
              }}
              className="text-xs font-bold px-3 py-2 rounded-lg shrink-0"
              style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
              Request
            </button>
          </div>
          {me.requests.filter((r) => r.vaultId === pool.id).map((r) => (
            <div key={r.id} className="text-[11px] font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>
              @{r.fomoHandle} · {r.status}
            </div>
          ))}
        </section>
      )}

      <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-display text-base font-medium">My signals in my pool</h2>
        <ul className="mt-2 space-y-1.5">
          {signals.slice(0, 15).map((s) => (
            <li key={s.id} className="flex items-center justify-between text-xs font-mono rounded-lg px-3 py-1.5" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <span>#{s.id} · {s.token} · {s.trader} · {s.status}</span>
              <span style={{ color: (s.profitUsd ?? 0) >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                {s.profitUsd === null ? 'open' : `${s.profitUsd >= 0 ? '+' : ''}${s.profitUsd}`}
              </span>
            </li>
          ))}
          {signals.length === 0 && <li className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No signals yet.</li>}
        </ul>
      </section>

      <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-display text-base font-medium">Payouts</h2>
        <ul className="mt-2 space-y-1.5">
          {payouts.slice(0, 20).map((p) => (
            <li key={p.id} className="flex items-center justify-between text-xs font-mono rounded-lg px-3 py-1.5" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <span>#{p.id} · {p.trader.slice(0, 6)}…{p.trader.slice(-4)} · {p.status}</span>
              <span>{p.amountSol.toFixed(4)} SOL</span>
            </li>
          ))}
          {payouts.length === 0 && <li className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>No payouts yet.</li>}
        </ul>
      </section>

      <div>
        <Link href="/" className="text-sm" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
      </div>
    </div>
  );
}
