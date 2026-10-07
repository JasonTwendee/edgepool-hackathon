'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  clearSession,
  getAuthMe,
  getStoredToken,
  loginAccount,
  partnerApply,
  partnerApplyStatus,
  partnerClaim,
  partnerMe,
  partnerPauseTrader,
  partnerPayoutChallenge,
  partnerPayouts,
  partnerPoolTraders,
  partnerRemoveTrader,
  partnerRequestTrader,
  partnerSetPayoutWallet,
  partnerSignals,
  partnerUpdateSettings,
  storeSession,
  type PartnerMe,
} from '../../lib/api';
import { signWithBrowserWallet } from '../../lib/solana';
import { SiteFooter, SiteHeader } from '../../components/SiteHeader';
import { Toaster, toast } from '../../components/Toaster';

const inputCls =
  'w-full text-sm bg-[#0D0F18] border border-[#3F424D] rounded-lg px-3 py-2.5 text-[#E9E9ED] placeholder:text-[#4A4D5E] outline-none focus:border-[#E9E9ED]';

function countdown(iso: string, now: number): string {
  const cd = Math.max(0, new Date(iso).getTime() - now);
  if (cd <= 0) return 'settling…';
  const h = Math.floor(cd / 3600000);
  const m = Math.floor((cd % 3600000) / 60000);
  const s = Math.floor((cd % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

/** Render the 600×315 X share card on canvas and trigger a PNG download. */
function downloadShareCard(poolName: string, navSol: number, poolId: number): void {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 315;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas unavailable.');
  g.fillStyle = '#161826';
  g.fillRect(0, 0, 600, 315);
  const grad = g.createRadialGradient(520, 40, 10, 520, 40, 320);
  grad.addColorStop(0, 'rgba(73,230,215,0.25)');
  grad.addColorStop(1, 'rgba(73,230,215,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 600, 315);
  g.fillStyle = '#49E6D7';
  g.font = '700 34px Inter, sans-serif';
  g.fillText('◈ edgepool', 40, 70);
  g.fillStyle = '#E9E9ED';
  g.font = '500 40px Inter, sans-serif';
  const name = poolName.length > 26 ? `${poolName.slice(0, 25)}…` : poolName;
  g.fillText(name, 40, 140);
  g.fillStyle = '#73DEA4';
  g.font = '700 44px JetBrains Mono, monospace';
  g.fillText(`${navSol.toFixed(2)} SOL`, 40, 210);
  g.fillStyle = '#9397AB';
  g.font = '400 20px Inter, sans-serif';
  g.fillText(`edgepool-dev · /pools/${poolId}`, 40, 260);
  const a = document.createElement('a');
  a.download = `edgepool-pool-${poolId}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

/** Registration popup: partner application intake. */
function ApplyModal({ onClose, onApplied }: { onClose: () => void; onApplied: (wallet: string) => void }) {
  const [fomo, setFomo] = useState('');
  const [x, setX] = useState('');
  const [wallet, setWallet] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await partnerApply({ fomoHandle: fomo.trim(), xHandle: x.trim() || undefined, wallet: wallet.trim(), contact: contact.trim() });
      try {
        localStorage.setItem('edgepool.applyWallet', wallet.trim());
      } catch {
        // private mode — state still works for this tab.
      }
      onApplied(wallet.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(13,15,24,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div className="w-full rounded-2xl p-6 space-y-2.5" style={{ maxWidth: 440, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-medium">Apply as a partner</h2>
        <p className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Tell us where to find your track record. Applications are reviewed by the Edgepool team.</p>
        <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>FOMO HANDLE</label>
        <input value={fomo} onChange={(e) => setFomo(e.target.value)} placeholder="@yourhandle" className={inputCls} />
        <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>X HANDLE</label>
        <input value={x} onChange={(e) => setX(e.target.value)} placeholder="@yourhandle (optional)" className={inputCls} />
        <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>TRADING WALLET</label>
        <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Base58 address (32+ chars)" className={`${inputCls} font-mono`} />
        <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>CONTACT</label>
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or Telegram" className={inputCls} />
        {err && <p className="text-[11px]" style={{ color: 'var(--ep-neg, #F28881)' }}>{err}</p>}
        <button onClick={() => void submit()} disabled={busy} className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
          Submit application
        </button>
      </div>
    </div>
  );
}

/** Post-apply status: what the applicant sees while Edgepool reviews. */
function PendingView({ wallet, onReset }: { wallet: string; onReset: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(() => {
    setBusy(true);
    partnerApplyStatus(wallet)
      .then((r) => setStatus(r.data.status))
      .catch(() => setStatus(null))
      .finally(() => setBusy(false));
  }, [wallet]);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <div className="rounded-2xl p-8 text-center space-y-3" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
      <div className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-amber, #F0BE67)' }}>APPLICATION RECEIVED</div>
      <h2 className="font-display text-xl font-medium">Your request is under review.</h2>
      <p className="text-xs font-mono break-all" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        {wallet.slice(0, 8)}…{wallet.slice(-6)} · status: {busy ? 'checking…' : (status ?? 'pending')}
      </p>
      <p className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
        {status === 'approved'
          ? 'Approved — sign in with the account the Edgepool team created for you.'
          : status === 'rejected'
            ? 'This application was not approved — contact the Edgepool team.'
            : 'The Edgepool team reviews every application by hand. Come back soon.'}
      </p>
      <div className="flex gap-2 justify-center flex-wrap">
        <button onClick={check} disabled={busy} className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
          style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
          Refresh status
        </button>
        <button onClick={onReset} className="text-xs font-bold px-3 py-2 rounded-lg"
          style={{ color: 'var(--ep-muted, #9397AB)' }}>
          Use a different wallet
        </button>
      </div>
    </div>
  );
}

export default function TraderPage() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [poolId, setPoolId] = useState<number | null>(null);
  const [traders, setTraders] = useState<{ wallet: string; handle: string; isActive: boolean; weightBps: number; signals7d: number; profitUsd: number; feeSol: number }[]>([]);
  const [signals, setSignals] = useState<{ id: number; token: string; trader: string; status: string; profitUsd: number | null }[]>([]);
  const [payouts, setPayouts] = useState<{ id: number; trader: string; amountSol: number; status: string; createdAt: string }[]>([]);
  const [payoutInput, setPayoutInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [poolName, setPoolName] = useState('');
  const [maxSlots, setMaxSlots] = useState('');
  const [reqFomo, setReqFomo] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [appliedWallet, setAppliedWallet] = useState<string | null>(() => {
    try {
      return localStorage.getItem('edgepool.applyWallet');
    } catch {
      return null;
    }
  });
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ username: string | null; role: string } | null>(null);
  const [ruleVals, setRuleVals] = useState<Record<string, string>>({});
  const [undone, setUndone] = useState<{ wallet: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (t: string) => {
    const res = await partnerMe(t);
    setMe(res.data);
    if (res.data.pools.length > 0 && poolId === null) setPoolId(res.data.pools[0].id);
  }, [poolId]);

  useEffect(() => {
    const sync = () => {
      const t = getStoredToken();
      setToken(t);
      if (t) {
        void load(t).catch(() => undefined);
        void getAuthMe(t)
          .then((r) => setIdentity({ username: r.data.username ?? null, role: r.data.role }))
          .catch(() => setIdentity(null));
      } else {
        setIdentity(null);
        setMe(null);
      }
    };
    sync();
    window.addEventListener('edgepool:session', sync);
    return () => window.removeEventListener('edgepool:session', sync);
  }, [load]);

  useEffect(() => {
    if (!token || poolId === null) return;
    void partnerPoolTraders(token, poolId).then((r) => setTraders(r.data)).catch(() => undefined);
    void partnerSignals(token, poolId).then((r) => setSignals(r.data)).catch(() => undefined);
    void partnerPayouts(token).then((r) => setPayouts(r.data)).catch(() => undefined);
  }, [token, poolId]);

  useEffect(() => {
    if (!me?.fees.nextCheckpointAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [me?.fees.nextCheckpointAt]);

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
    if (appliedWallet) {
      return (
        <>
          <SiteHeader active="trader" />
          <div className="mx-auto w-full" style={{ maxWidth: 1000, padding: '28px clamp(16px,4vw,40px) 64px' }}>
            <PendingView
              wallet={appliedWallet}
              onReset={() => {
                setAppliedWallet(null);
                try {
                  localStorage.removeItem('edgepool.applyWallet');
                } catch {
                  // ignore
                }
              }}
            />
            <SiteFooter />
          </div>
        </>
      );
    }
    return (
      <>
        <SiteHeader active="trader" />
        <div className="mx-auto w-full" style={{ maxWidth: 1000, padding: '28px clamp(16px,4vw,40px) 64px' }}>
        <div className="grid gap-0 md:grid-cols-2 rounded-2xl overflow-hidden" style={{ borderRadius: 18, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <div
          className="p-8 flex flex-col justify-center gap-3"
          style={{
            background: 'radial-gradient(circle at top right, rgba(73,230,215,0.16), rgba(73,230,215,0) 55%), var(--ep-violet-tint, #2B2741)',
          }}
        >
          <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-violet-100, #D2CEFD)' }}>
            PARTNER TRADERS
          </span>
          <h1 className="font-display font-medium" style={{ fontSize: 'clamp(26px,3vw,36px)' }}>Run your own copy pool.</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
            Bring traders you trust. Every trader earns 15% of the profit their own signals make for the pool.
          </p>
          <p className="text-[11px] font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>
            Invite only. Accounts are created by the Edgepool team.
          </p>
        </div>
        <div className="p-6 space-y-3">
          {token && identity ? (
            <div className="rounded-lg px-3 py-2.5 space-y-2" style={{ background: 'rgba(240,190,103,0.08)', boxShadow: '0 0 0 1px var(--ep-amber, #F0BE67)' }}>
              <p className="text-[11px] font-bold" style={{ color: 'var(--ep-amber, #F0BE67)' }}>
                You&apos;re not a partner.
              </p>
              <p className="text-[11px]" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
                Signed in as {identity.username ?? 'wallet'} ({identity.role}). This portal is for partner traders only.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setApplyOpen(true)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--ep-amber, #F0BE67)', color: '#0D0F18' }}>
                  Register as a partner
                </button>
                <button
                  onClick={() => {
                    clearSession();
                    setToken(null);
                    setMe(null);
                    setIdentity(null);
                  }}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
                  style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2.5 space-y-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <p className="text-[11px] font-bold" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
                Partner area — sign in or register below.
              </p>
              <button onClick={() => setApplyOpen(true)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
                style={{ border: '1px solid var(--ep-violet, #9184D9)', color: 'var(--ep-violet-100, #D2CEFD)' }}>
                Apply to become a partner
              </button>
            </div>
          )}
          <div className="space-y-2.5">
            <h2 className="font-display text-lg font-medium">Sign in</h2>
            <p className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Use the login your Edgepool contact sent you.</p>
            <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>EMAIL</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" autoComplete="username" className={inputCls} />
            <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>PASSWORD</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" type="password" autoComplete="current-password"
              onKeyDown={(e) => { if (e.key === 'Enter') void signin(); }} className={inputCls} />
            <button onClick={() => void signin()} disabled={busy} className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
              Sign in
            </button>
          </div>
          {msg && <p className="text-[11px] break-all" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}
          <Link href="/" className="text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
        </div>
        </div>
        <SiteFooter />
        </div>
        {applyOpen && (
          <ApplyModal
            onClose={() => setApplyOpen(false)}
            onApplied={(w) => {
              setAppliedWallet(w);
              setApplyOpen(false);
            }}
          />
        )}
      </>
    );
  }

  const pool = me.pools.find((p) => p.id === poolId) ?? me.pools[0] ?? null;

  return (
    <>
      <SiteHeader active="trader" />
      <div className="mx-auto w-full space-y-4" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="font-mono text-sm font-bold">@{me.handle}</span>
          <span className="text-[11px] font-mono ml-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>
            {me.payoutWallet
              ? `payout → ${me.payoutWallet.slice(0, 6)}…${me.payoutWallet.slice(-4)}${me.payoutWalletVerified ? ' ✓ verified' : ' · UNVERIFIED'}`
              : 'no payout wallet'}
          </span>
        </div>
        <Link href="/" className="text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>← All pools</Link>
      </div>
      {msg && <p className="text-[11px]" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}

      {(!me.payoutWallet || !me.payoutWalletVerified) && (
        <div className="rounded-2xl p-4 flex flex-wrap items-center gap-2" style={{ background: 'rgba(145,132,217,0.12)', boxShadow: '0 0 0 1px var(--ep-violet, #9184D9)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--ep-violet-100, #D2CEFD)' }}>
            {me.payoutWallet ? 'Verify you own this payout wallet to claim fees.' : 'Connect a payout wallet to claim fees.'}
          </span>
          <input value={payoutInput} onChange={(e) => setPayoutInput(e.target.value)} placeholder="Payout wallet (Base58)"
            className="flex-1 min-w-[200px] text-xs font-mono px-2.5 py-2 rounded-lg outline-none"
            style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }} />
          <button
            disabled={verifying}
            onClick={() => {
              if (!token || !payoutInput.trim() || verifying) return;
              setVerifying(true);
              setMsg(null);
              const wallet = payoutInput.trim();
              void (async () => {
                // 1. Challenge bound to (session user, wallet).
                const ch = await partnerPayoutChallenge(token, wallet);
                // 2. Sign with the payout wallet itself (browser wallet must hold that key).
                const signed = await signWithBrowserWallet(ch.data.message);
                if (signed.wallet !== wallet) throw new Error(`Signed with ${signed.wallet.slice(0, 6)}…, but the payout wallet is ${wallet.slice(0, 6)}…. Sign with the payout wallet.`);
                // 3. Submit proof → wallet saved as verified.
                await partnerSetPayoutWallet(token, wallet, signed.signature);
                setPayoutInput('');
                await load(token);
                setMsg('Payout wallet verified.');
              })()
                .catch((e) => setMsg((e as Error).message))
                .finally(() => setVerifying(false));
            }}
            className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50" style={{ background: 'var(--ep-violet, #9184D9)', color: '#0D0F18' }}>
            {verifying ? 'Verifying…' : me.payoutWallet ? 'Verify' : 'Connect'}
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
            disabled={!token || !me.payoutWallet || !me.payoutWalletVerified || me.fees.claimableSol <= 0}
            onClick={() => {
              if (!token) return;
              void partnerClaim(token).then((r) => {
                setMsg(`Claimed ${r.data.claimedSol.toFixed(4)} SOL across ${r.data.rows} rows (recorded; auto-paid at checkpoint).`);
                toast(`Claimed ${r.data.claimedSol.toFixed(4)} SOL`);
                return load(token);
              }).catch((e) => setMsg((e as Error).message));
            }}
            className="text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
            Claim
          </button>
          <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>
            Auto-paid at each checkpoint
            {me.fees.nextCheckpointAt ? `, next in ${countdown(me.fees.nextCheckpointAt, now)}` : '.'}
          </span>
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
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Max traders</span>
              {[3, 4, 5].map((n) => (
                <button key={n} onClick={() => void saveSettings({ maxTraders: n }, `Max traders → ${n}.`)}
                  disabled={busy} className="text-xs font-bold px-2.5 py-2 rounded-lg disabled:opacity-50"
                  style={pool.maxTraders === n ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                  {n}
                </button>
              ))}
            </div>
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
                <button
                  onClick={() => {
                    if (!token) return;
                    void partnerRemoveTrader(token, pool.id, t.wallet)
                      .then(() => {
                        setUndone({ wallet: t.wallet });
                        setTimeout(() => setUndone((u) => (u && u.wallet === t.wallet ? null : u)), 8000);
                        return partnerPoolTraders(token, pool.id).then((r) => setTraders(r.data));
                      })
                      .catch((e) => setMsg((e as Error).message));
                  }}
                  className="text-[11px] font-bold px-2 py-1 rounded-lg"
                  style={{ border: '1px solid var(--ep-neg, #F28881)', color: 'var(--ep-neg, #F28881)' }}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {undone && (
            <div className="flex items-center justify-between gap-2 text-[11px] rounded-lg px-3 py-2" style={{ background: 'rgba(240,190,103,0.12)', boxShadow: '0 0 0 1px var(--ep-amber, #F0BE67)' }}>
              <span style={{ color: 'var(--ep-amber, #F0BE67)' }}>Trader removed.</span>
              <button
                onClick={() => {
                  if (!token || poolId === null) return;
                  void partnerPauseTrader(token, poolId, undone.wallet, true)
                    .then(() => {
                      setUndone(null);
                      return partnerPoolTraders(token, poolId).then((r) => setTraders(r.data));
                    })
                    .catch((e) => setMsg((e as Error).message));
                }}
                className="font-bold px-2 py-1 rounded-lg"
                style={{ background: 'var(--ep-amber, #F0BE67)', color: '#0D0F18' }}>
                Undo
              </button>
            </div>
          )}
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

      {pool && (
      <section className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>POOL RULES · CUSTOM</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['traderCapPctNav', 'Cap % NAV'],
            ['entryNowPct', 'Entry % now'],
            ['limitOffsetPct', 'Limit offset %'],
            ['stopMinPct', 'Stop min %'],
            ['stopMaxPct', 'Stop max %'],
            ['timeStopHours', 'Time stop h'],
            ['dailyKillSwitchPct', 'Daily kill %'],
            ['weeklyLossLimitPct', 'Weekly loss %'],
          ].map(([k, label]) => (
            <div key={k}>
              <div className="text-[10px] font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>{label}</div>
              <input
                value={ruleVals[k] ?? (pool?.rulesJson?.[k] !== undefined && pool?.rulesJson?.[k] !== null ? String(pool.rulesJson[k]) : '')}
                onChange={(e) => setRuleVals((v) => ({ ...v, [k]: e.target.value.replace(/[^0-9.]/g, '') }))}
                placeholder="—"
                inputMode="decimal"
                className="w-full mt-0.5 text-xs font-mono px-2 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            const rules: Record<string, number> = {};
            for (const [k, v] of Object.entries(ruleVals)) {
              if (v.trim() === '') continue;
              const n = Number(v);
              if (!Number.isFinite(n)) {
                setMsg(`Rule ${k} must be a number.`);
                return;
              }
              rules[k] = n;
            }
            void saveSettings({ rulesJson: rules }, 'Pool rules saved.').then(() => setRuleVals({}));
          }}
          disabled={busy || Object.keys(ruleVals).length === 0}
          className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
          style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
          Save rules
        </button>
      </section>
      )}

      <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>EDGEPOOL BASKET STATUS</h2>
        <div className="mt-2 space-y-1.5">
          {me.basket.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>None of your traders are tracked yet.</p>
          )}
          {me.basket.map((b) => (
            <div key={b.wallet} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
              <span className="font-bold font-mono">@{b.handle}</span>
              <span className="font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                {b.inBasket ? 'In basket' : 'Not in basket'} · #{b.ranks?.h24 ?? '—'} · #{b.ranks?.d7 ?? '—'} · #{b.ranks?.d30 ?? '—'}
              </span>
            </div>
          ))}
          <p className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
            You&apos;d move out if you drop below #8 on 7d. Picked by algorithm; you earn <b style={{ color: 'var(--ep-aqua, #49E6D7)' }}>10%</b> of the profit your signals make here, Edgepool takes <b style={{ color: 'var(--ep-violet, #9184D9)' }}>10%</b>.
          </p>
        </div>
      </section>

      <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>SHARE CARD FOR X</h2>
        <p className="text-[11px] mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>600×315 PNG for posts + copyable pool link.</p>
        <div className="flex gap-2 mt-2 flex-wrap">
          <button
            onClick={() => {
              if (!pool) return;
              try {
                downloadShareCard(pool.name, pool.navSol, pool.id);
                setMsg('Share card downloaded.');
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
            className="text-xs font-bold px-3 py-2 rounded-lg"
            style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
            Download PNG
          </button>
          <button
            onClick={() => {
              if (!pool) return;
              const url = `${window.location.origin}/pools/${pool.id}`;
              void navigator.clipboard.writeText(url).then(
                () => setMsg('Pool link copied.'),
                () => setMsg('Copy failed — link: ' + url),
              );
            }}
            className="text-xs font-bold px-3 py-2 rounded-lg"
            style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
            Copy pool link
          </button>
        </div>
      </section>

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
      <SiteFooter />
    </div>
    <Toaster />
    </>
  );
}
