'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  clearSession,
  getAuthMe,
  getPoolDetail,
  getSolPriceUsd,
  getStoredToken,
  loginAccount,
  partnerApply,
  partnerApplyStatus,
  partnerClaim,
  partnerMe,
  partnerPayoutChallenge,
  partnerPayouts,
  partnerPauseTrader,
  partnerPoolTraders,
  partnerRemoveTrader,
  partnerRequestTrader,
  partnerSetPayoutWallet,
  partnerSignals,
  partnerUpdateSettings,
  storeSession,
  type PartnerMe,
  type PoolDetail,
} from '../../lib/api';
import { connectProvider, detectWallets, signWithBrowserWallet, signWithProvider, type InjectedSolanaProvider } from '../../lib/solana';
import { SiteFooter, SiteHeader } from '../../components/SiteHeader';
import { Toaster, toast } from '../../components/Toaster';
import { DownloadSimple, LinkSimple, UsersThree, Wallet } from '@phosphor-icons/react';

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
function downloadShareCard(input: {
  poolName: string;
  handle: string;
  pill: string;
  profitText: string;
  profitSub: string;
  pctText: string;
  pctSub: string;
  link: string;
}): void {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 315;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas unavailable.');
  g.fillStyle = '#161826';
  g.fillRect(0, 0, 600, 315);
  const grad = g.createRadialGradient(480, 40, 10, 480, 40, 340);
  grad.addColorStop(0, 'rgba(73,230,215,0.14)');
  grad.addColorStop(1, 'rgba(73,230,215,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 600, 315);
  g.fillStyle = '#E9E9ED';
  g.font = '700 22px Inter, sans-serif';
  g.fillText('◈ edgepool', 36, 56);
  g.font = '500 11px Inter, sans-serif';
  g.fillStyle = '#49E6D7';
  g.fillText(input.pill, 36, 100);
  g.fillStyle = '#E9E9ED';
  g.font = '500 34px Inter, sans-serif';
  g.fillText(`@${input.handle.slice(0, 20)}`, 36, 148);
  g.fillStyle = '#73DEA4';
  g.font = '700 30px "JetBrains Mono", monospace';
  g.fillText(input.profitText.slice(0, 18), 36, 200);
  g.fillStyle = '#E9E9ED';
  g.fillText(input.pctText.slice(0, 10), 300, 200);
  g.fillStyle = '#9397AB';
  g.font = '400 12px Inter, sans-serif';
  g.fillText(input.profitSub.slice(0, 34), 36, 226);
  g.fillText(input.pctSub.slice(0, 24), 300, 226);
  g.fillStyle = '#81EADE';
  g.font = '400 12px "JetBrains Mono", monospace';
  g.fillText(input.link.slice(0, 44), 36, 272);
  g.fillStyle = '#75798C';
  g.fillText('Past performance does not indicate future results.', 36, 296);
  const a = document.createElement('a');
  a.download = `edgepool-${input.poolName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`;
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
  const [payouts, setPayouts] = useState<{ id: number; vaultId: number; trader: string; amountSol: number; epochId: number | null; kind: string; status: string; createdAt: string }[]>([]);
  const [payoutInput, setPayoutInput] = useState('');
  const [verifying, setVerifying] = useState(false);
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
  const [now, setNow] = useState(Date.now());
  const [detail, setDetail] = useState<PoolDetail | null>(null);
  const [solPx, setSolPx] = useState<number | null>(null);
  const [showManualWallet, setShowManualWallet] = useState(false);
  const [slotDraft, setSlotDraft] = useState('');
  const [ruleVals, setRuleVals] = useState<Record<string, string>>({});
  const [undone, setUndone] = useState<{ wallet: string } | null>(null);

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
    void getPoolDetail(poolId).then((r) => setDetail(r.data)).catch(() => setDetail(null));
    void getSolPriceUsd().then((px) => setSolPx(px)).catch(() => setSolPx(null));
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

  /** Payout-wallet ownership proof: challenge → sign with that wallet → set.
   * Same backend guarantees as before; only the address acquisition changed
   * (wallet connect buttons fill it, manual input stays as fallback). */
  async function verifyWalletFlow(wallet: string, provider?: InjectedSolanaProvider) {
    if (!token || verifying) return;
    const clean = wallet.trim();
    if (clean.length < 32) {
      setMsg('Enter a valid Solana wallet address.');
      return;
    }
    setVerifying(true);
    setMsg(null);
    try {
      const ch = await partnerPayoutChallenge(token, clean);
      const signed = provider
        ? await signWithProvider(provider, ch.data.message)
        : await signWithBrowserWallet(ch.data.message);
      if (signed.wallet !== clean) {
        throw new Error(`Signed with ${signed.wallet.slice(0, 6)}…, but the payout wallet is ${clean.slice(0, 6)}…. Sign with the payout wallet.`);
      }
      await partnerSetPayoutWallet(token, clean, signed.signature);
      setPayoutInput('');
      await load(token);
      setMsg('Payout wallet verified.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  /** Design wallet buttons: connect the named provider, then run the same
   * ownership proof with its address. Falls back to manual input. */
  async function connectPayoutWallet(id: 'phantom' | 'solflare') {
    if (!token || verifying) return;
    const found = detectWallets().find((w) => w.id === id);
    const label = id === 'phantom' ? 'Phantom' : 'Solflare';
    if (!found?.installed || !found.provider) {
      setMsg(`${label} is not installed in this browser — install it or paste the address below.`);
      setShowManualWallet(true);
      return;
    }
    setMsg(null);
    try {
      const addr = await connectProvider(found.provider);
      await verifyWalletFlow(addr, found.provider);
    } catch (e) {
      setMsg((e as Error).message);
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
          {!(token && identity) && (
          <div className="space-y-2.5">
            <h2 className="font-display text-lg font-medium">Sign in</h2>
            <p className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Use the login your Edgepool contact sent you.</p>
            <>
              <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>EMAIL</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" autoComplete="username" className={inputCls} />
              <label className="block text-[11px] font-mono tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>PASSWORD</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" type="password" autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === 'Enter') void signin(); }} className={inputCls} />
              <button onClick={() => void signin()} disabled={busy} className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
                Sign in
              </button>
            </>
          </div>
          )}
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
  const isBasket = pool?.kind === 'basket';
  const traderSharePct = isBasket ? 10 : 15;
  const edgeSharePct = isBasket ? 10 : 5;
  const claimReady = !!token && !!me.payoutWallet && me.payoutWalletVerified && me.fees.claimableSol > 0;
  const claimLabel = !me.payoutWallet
    ? 'Connect wallet to claim'
    : !me.payoutWalletVerified
      ? 'Verify wallet to claim'
      : me.fees.claimableSol > 0
        ? `Claim ${me.fees.claimableSol.toFixed(2)} SOL`
        : 'Nothing to claim';
  const usdToDisplay = (usd: number): string => {
    if (solPx && solPx > 0) {
      const v = usd / solPx;
      return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} SOL`;
    }
    return `${usd >= 0 ? '+' : '−'}$${Math.abs(usd).toFixed(2)}`;
  };
  const slug = (pool?.name ?? 'pool').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const week = detail?.pnl.week ?? null;

  async function claim() {
    if (!token || !claimReady) return;
    try {
      const r = await partnerClaim(token);
      setMsg(`Claimed ${r.data.claimedSol.toFixed(4)} SOL across ${r.data.rows} rows (recorded; auto-paid at checkpoint).`);
      toast(`Claimed ${r.data.claimedSol.toFixed(4)} SOL`);
      await load(token);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  /** Owner writes (pool settings / traders / rules). BE enforces ownership —
   * ADMIN-only paths stay in /terminal. Failures surface the BE message. */
  async function saveSettings(patch: Record<string, unknown>, okMsg: string) {
    if (!token || !pool || busy) return;
    setBusy(true);
    try {
      await partnerUpdateSettings(token, pool.id, patch);
      await load(token);
      setSlotDraft('');
      setMsg(okMsg);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshTraders() {
    if (!token || poolId === null) return;
    try {
      const r = await partnerPoolTraders(token, poolId);
      setTraders(r.data);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function requestTrader() {
    if (!token || !pool || !reqFomo.trim()) return;
    try {
      await partnerRequestTrader(token, pool.id, { fomoHandle: reqFomo.trim() });
      setReqFomo('');
      await load(token);
      setMsg('Trader requested — pending until Edgepool creates the account.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  function sharePreview() {
    if (!pool) return null;
    const wSol = week ? `${week.sol >= 0 ? '+' : ''}${week.sol.toFixed(2)} SOL` : `${pool.navSol.toFixed(2)} SOL`;
    const wPct = week ? `${week.pct >= 0 ? '+' : ''}${week.pct.toFixed(2)}%` : '—';
    return { wSol, wPct };
  }

  return (
    <>
      <SiteHeader active="trader" />
      <div className="mx-auto w-full flex flex-col" style={{ maxWidth: 1240, padding: '28px clamp(16px,4vw,40px) 64px', gap: 16 }}>
        <div className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          <span className="font-mono font-bold" style={{ color: 'var(--ep-text, #E9E9ED)' }}>@{me.handle}</span>
          {' · '}
          {me.payoutWallet
            ? `payout → ${me.payoutWallet.slice(0, 6)}…${me.payoutWallet.slice(-4)}${me.payoutWalletVerified ? ' ✓ verified' : ' · UNVERIFIED'}`
            : 'No payout wallet yet'}
        </div>
        {msg && <p className="text-[11px] break-all" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{msg}</p>}

        {(!me.payoutWallet || !me.payoutWalletVerified) && (
          <div className="flex items-center justify-between gap-4 flex-wrap" style={{ padding: '20px 22px', borderRadius: 16, background: 'rgba(145,132,217,0.12)', boxShadow: '0 0 0 1px var(--ep-violet, #9184D9)' }}>
            <div className="flex items-center gap-3">
              <Wallet size={22} weight="regular" style={{ color: 'var(--ep-violet-100, #D2CEFD)', flexShrink: 0 }} />
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-bold" style={{ color: 'var(--ep-violet-100, #D2CEFD)' }}>
                  {me.payoutWallet ? 'Verify you own this payout wallet' : 'Connect a payout wallet'}
                </span>
                <span className="text-[13px]" style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>
                  Fees are paid here. Auto-payouts start once it&apos;s connected.
                </span>
                {showManualWallet && (
                  <span className="flex gap-2 mt-1 flex-wrap">
                    <input value={payoutInput} onChange={(e) => setPayoutInput(e.target.value)} placeholder="Payout wallet (Base58)"
                      className="flex-1 min-w-[200px] text-xs font-mono px-2.5 py-2 rounded-lg outline-none"
                      style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }} />
                    <button onClick={() => void verifyWalletFlow(payoutInput)} disabled={verifying}
                      className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
                      style={{ background: 'var(--ep-violet, #9184D9)', color: '#0D0F18' }}>
                      {verifying ? 'Verifying…' : 'Verify'}
                    </button>
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void connectPayoutWallet('phantom')} disabled={verifying}
                className="font-medium disabled:opacity-50" style={{ height: 42, padding: '0 18px', borderRadius: 8, fontSize: 14, background: 'var(--ep-violet, #9184D9)', color: '#0D0F18' }}>
                {verifying ? 'Waiting…' : 'Connect Phantom'}
              </button>
              <button onClick={() => void connectPayoutWallet('solflare')} disabled={verifying}
                className="font-medium disabled:opacity-50" style={{ height: 42, padding: '0 18px', borderRadius: 8, fontSize: 14, border: '1px solid var(--ep-violet, #9184D9)', background: 'transparent', color: 'var(--ep-violet-100, #D2CEFD)' }}>
                Solflare
              </button>
            </div>
          </div>
        )}

        <section className="flex flex-wrap items-center" style={{ padding: '22px 24px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', gap: 24 }}>
          <div className="grid" style={{ flex: '2 1 480px', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16 }}>
            {[
              { k: 'Pending', v: `${me.fees.pendingSol.toFixed(2)} SOL`, sub: 'From winning trades' },
              { k: 'Claimable', v: `${me.fees.claimableSol.toFixed(2)} SOL`, sub: 'Settled above HWM', aqua: true },
              { k: 'Paid to date', v: `${me.fees.paidSol.toFixed(2)} SOL`, sub: 'To payout wallet' },
            ].map((f) => (
              <div key={f.k} className="flex flex-col gap-1">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>{f.k}</span>
                <span className="font-mono font-medium whitespace-nowrap" style={{ fontSize: 'clamp(24px,4vw,30px)', color: f.aqua ? 'var(--ep-aqua, #49E6D7)' : 'var(--ep-text, #E9E9ED)' }}>{f.v}</span>
                <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{f.sub}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2" style={{ flex: '1 1 300px' }}>
            <button onClick={() => void claim()} disabled={!claimReady}
              className="w-full font-medium disabled:opacity-100"
              style={claimReady
                ? { height: 46, borderRadius: 10, fontSize: 15, background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }
                : { height: 46, borderRadius: 10, fontSize: 15, background: '#2E313F', color: 'var(--ep-muted, #9397AB)' }}>
              {claimLabel}
            </button>
            <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)', lineHeight: 1.5 }}>
              Auto-paid at each checkpoint
              {me.fees.nextCheckpointAt ? (
                <>, next in <span className="font-mono" style={{ color: 'var(--ep-aqua, #49E6D7)', padding: '1px 6px', borderRadius: 5, background: 'rgba(73,230,215,0.1)' }}>{countdown(me.fees.nextCheckpointAt, now)}</span></>
              ) : '.'} Pending becomes claimable when NAV per share is above its high-water mark.
            </span>
          </div>
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

        <div className="grid items-start ep-trader-grid" style={{ gap: 16 }}>
          <div className="flex flex-col min-w-0" style={{ gap: 16 }}>
            {pool && (
              <section style={{ padding: '20px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="flex justify-between items-start gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>My pool</span>
                    <h2 className="font-display font-medium" style={{ fontSize: 26 }}>{pool.name}</h2>
                    <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                      NAV {pool.navSol.toFixed(2)} SOL ·{' '}
                      {detail ? (
                        <><span className="font-mono" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{detail.navPerShare.toFixed(4)} SOL</span> / share · {detail.navPerShare >= detail.hwmNavPerShare ? 'above HWM' : 'below HWM'}</>
                      ) : (
                        'NAV / share —'
                      )}
                    </span>
                    <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                      Traders in this pool earn <b style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{traderSharePct}%</b> of their own profitable trades. Edgepool takes <b style={{ color: 'var(--ep-violet, #9184D9)' }}>{edgeSharePct}%</b>.
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex rounded-lg overflow-hidden" style={{ boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                      {(['public', 'unlisted'] as const).map((l) => (
                        <button key={l} onClick={() => void saveSettings({ listing: l }, `Listing → ${l}.`)} disabled={busy}
                          className="font-medium capitalize disabled:opacity-50"
                          style={pool.listing === l
                            ? { height: 32, padding: '0 14px', borderRadius: 6, fontSize: 13, background: '#2E313F', color: '#E9E9ED' }
                            : { height: 32, padding: '0 14px', borderRadius: 6, fontSize: 13, background: 'transparent', color: 'var(--ep-muted, #9397AB)' }}>
                          {l}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => void saveSettings({ status: pool.status === 'live' ? 'paused' : 'live' }, pool.status === 'live' ? 'Pool paused — no new positions.' : 'Pool live again.')} disabled={busy}
                      className="font-medium text-xs disabled:opacity-50"
                      style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--ep-amber, #F0BE67)', background: 'transparent', color: 'var(--ep-amber, #F0BE67)' }}>
                      {pool.status === 'live' ? 'Pause pool' : 'Resume pool'}
                    </button>
                    <Link href={`/pools/${pool.id}`} className="text-[13px] font-medium" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
                      View public page ↗
                    </Link>
                  </div>
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,200px),1fr))', gap: 16 }}>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Depositor slots</span>
                    {detail ? (
                      <>
                        <span className="font-mono text-xs">
                          <span style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{Math.max(0, detail.slots.max - detail.slots.used)} of {detail.slots.max} left</span>
                        </span>
                        <div className="rounded-full overflow-hidden" style={{ height: 6, background: '#2E313F' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (detail.slots.used / Math.max(1, detail.slots.max)) * 100).toFixed(1)}%`, background: 'var(--ep-aqua, #49E6D7)' }} />
                        </div>
                        <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>
                          Shown to depositors as slots left. New deposits stop when full; current depositors can still add.
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Max {pool.maxSlots} slots</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Max depositors</span>
                    <span className="flex items-center gap-2">
                      <button onClick={() => void saveSettings({ maxSlots: Math.max(1, pool.maxSlots - 10) }, 'Slots updated.')} disabled={busy}
                        className="font-medium disabled:opacity-50" style={{ width: 38, height: 38, borderRadius: 8, fontSize: 16, border: '1px solid #3F424D', color: 'var(--ep-text, #E9E9ED)' }}>
                        −
                      </button>
                      <input value={slotDraft || String(pool.maxSlots)} onChange={(e) => setSlotDraft(e.target.value.replace(/[^0-9]/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && slotDraft) void saveSettings({ maxSlots: Number(slotDraft) }, 'Slots updated.');
                        }}
                        inputMode="numeric" aria-label="Max depositors"
                        className="text-center font-mono font-medium outline-none" style={{ width: 76, height: 38, borderRadius: 8, fontSize: 16, background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }} />
                      <button onClick={() => void saveSettings({ maxSlots: pool.maxSlots + 10 }, 'Slots updated.')} disabled={busy}
                        className="font-medium disabled:opacity-50" style={{ width: 38, height: 38, borderRadius: 8, fontSize: 16, border: '1px solid #3F424D', color: 'var(--ep-text, #E9E9ED)' }}>
                        +
                      </button>
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>
                      {detail ? `${detail.slots.used} depositors in now.` : 'Configured by Edgepool.'}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <span className="text-[13px]" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
                    Traders · {traders.length} of {pool.maxTraders}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Max traders</span>
                    <span className="flex rounded-lg overflow-hidden" style={{ boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                      {[3, 4, 5].map((n) => (
                        <button key={n} onClick={() => void saveSettings({ maxTraders: n }, `Max traders → ${n}.`)} disabled={busy}
                          className="font-bold disabled:opacity-50"
                          style={pool.maxTraders === n
                            ? { width: 34, height: 32, fontSize: 13, background: '#2E313F', color: '#E9E9ED' }
                            : { width: 34, height: 32, fontSize: 13, background: 'transparent', color: 'var(--ep-muted, #9397AB)' }}>
                          {n}
                        </button>
                      ))}
                    </span>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <div className="grid font-mono uppercase" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) 90px 90px 110px 110px 150px', gap: 12, padding: '8px 4px', fontSize: 10, letterSpacing: '0.08em', color: 'var(--ep-faint, #75798C)', minWidth: 640 }}>
                    <span>Trader</span><span>Status</span><span style={{ textAlign: 'right' }}>Signals 7d</span><span style={{ textAlign: 'right' }}>Profit made</span><span style={{ textAlign: 'right' }}>Fee earned {traderSharePct}%</span><span style={{ textAlign: 'right' }}>Controls</span>
                  </div>
                  {traders.map((t) => (
                    <div key={t.wallet} className="grid items-center text-[13px]" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) 90px 90px 110px 110px 150px', gap: 12, padding: '10px 4px', borderTop: '1px solid var(--ep-border, #2E313F)', minWidth: 640 }}>
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="grid place-items-center font-bold shrink-0" style={{ width: 30, height: 30, borderRadius: '50%', background: '#2B2741', color: '#D2CEFD' }}>
                          {(t.handle || '?').slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex flex-col min-w-0">
                          <span className="font-medium truncate" title={t.wallet}>@{t.handle}</span>
                        </span>
                      </span>
                      <span>
                        <span className="text-[11px] font-bold" style={{ padding: '3px 8px', borderRadius: 6, background: t.isActive ? '#004B45' : '#2E313F', color: t.isActive ? '#BBF6EE' : 'var(--ep-muted, #9397AB)' }}>
                          {t.isActive ? 'Active' : 'Paused'}
                        </span>
                      </span>
                      <span className="font-mono" style={{ textAlign: 'right' }}>{t.signals7d}</span>
                      <span className="font-mono" style={{ textAlign: 'right', color: t.profitUsd >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                        {usdToDisplay(t.profitUsd)}
                      </span>
                      <span className="font-mono" style={{ textAlign: 'right' }}>{t.feeSol.toFixed(2)} SOL</span>
                      <span className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => {
                            if (!token) return;
                            void partnerPauseTrader(token, pool.id, t.wallet, !t.isActive)
                              .then(() => refreshTraders())
                              .catch((e) => setMsg((e as Error).message));
                          }}
                          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
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
                                return refreshTraders();
                              })
                              .catch((e) => setMsg((e as Error).message));
                          }}
                          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
                          style={{ border: '1px solid var(--ep-neg, #F28881)', color: 'var(--ep-neg, #F28881)' }}>
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
                  {traders.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)', padding: '8px 4px' }}>No traders yet.</p>
                  )}
                </div>
                {undone && (
                  <div className="flex items-center justify-between gap-2 text-[11px] rounded-lg px-3 py-2" style={{ background: 'rgba(240,190,103,0.12)', boxShadow: '0 0 0 1px var(--ep-amber, #F0BE67)' }}>
                    <span style={{ color: 'var(--ep-amber, #F0BE67)' }}>Trader removed.</span>
                    <button
                      onClick={() => {
                        if (!token || poolId === null) return;
                        void partnerPauseTrader(token, poolId, undone.wallet, true)
                          .then(() => {
                            setUndone(null);
                            return refreshTraders();
                          })
                          .catch((e) => setMsg((e as Error).message));
                      }}
                      className="font-bold px-2 py-1 rounded-lg"
                      style={{ background: 'var(--ep-amber, #F0BE67)', color: '#0D0F18' }}>
                      Undo
                    </button>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap items-center">
                  <input value={reqFomo} onChange={(e) => setReqFomo(e.target.value)} placeholder="Fomo handle to request"
                    className="min-w-0 text-xs px-2.5 py-2 rounded-lg outline-none" style={{ width: 220, background: 'var(--ep-surface-sunk, #1A1C2A)', border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }} />
                  <button onClick={() => void requestTrader()} disabled={!reqFomo.trim()}
                    className="text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50"
                    style={{ border: '1px dashed var(--ep-violet, #9184D9)', color: 'var(--ep-violet-100, #D2CEFD)' }}>
                    ＋ Request a trader
                  </button>
                </div>
                {me.requests.filter((r) => !pool || r.vaultId === pool.id).map((r) => (
                  <div key={r.id} className="text-[11px] font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>
                    @{r.fomoHandle} · {r.status}
                  </div>
                ))}
              </section>
            )}

            <section style={{ padding: '20px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="flex justify-between items-baseline gap-2 flex-wrap">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Pool rules · custom</span>
                <button onClick={() => {
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
                  void saveSettings({ rulesJson: rules }, 'Pool rules saved — applies to new trades.').then(() => setRuleVals({}));
                }}
                  disabled={busy || Object.keys(ruleVals).length === 0}
                  className="font-medium text-[13px] disabled:opacity-50"
                  style={{ height: 38, padding: '0 16px', borderRadius: 8, border: '1px solid var(--ep-aqua, #49E6D7)', background: 'transparent', color: 'var(--ep-aqua, #49E6D7)' }}>
                  Save rules
                </button>
              </div>
              <span className="text-[13px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>Changes apply to new trades only.</span>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,150px),1fr))', gap: 10 }}>
                {[
                  ['traderCapPctNav', 'Cap per trader', '% NAV'],
                  ['entryNowPct', 'Enter now', '%'],
                  ['limitOffsetPct', 'Limit offset', '%'],
                  ['stopMinPct', 'Stop min', '%'],
                  ['stopMaxPct', 'Stop max', '%'],
                  ['timeStopHours', 'Time stop', 'h'],
                  ['dailyKillSwitchPct', 'Daily kill switch', '%'],
                  ['weeklyLossLimitPct', 'Weekly loss limit', '%'],
                ].map(([key, label, unit]) => (
                  <div key={key as string} className="flex flex-col gap-1" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--ep-surface-sunk, #1A1C2A)' }}>
                    <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{label}</span>
                    <span className="flex items-baseline gap-1.5">
                      <input
                        value={ruleVals[key as string] ?? (pool?.rulesJson?.[key as string] !== undefined && pool?.rulesJson?.[key as string] !== null ? String(pool.rulesJson[key as string]) : '')}
                        onChange={(e) => setRuleVals((v) => ({ ...v, [key as string]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        placeholder="—"
                        inputMode="decimal"
                        aria-label={label as string}
                        className="flex-1 min-w-0 font-mono font-medium outline-none bg-transparent"
                        style={{ fontSize: 18, color: 'var(--ep-text, #E9E9ED)' }}
                      />
                      <span className="text-xs" style={{ color: 'var(--ep-faint, #75798C)' }}>{unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

          </div>

          <div className="flex flex-col min-w-0" style={{ gap: 16 }}>
            <section style={{ padding: '20px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="flex justify-between items-center gap-2">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>
                  {isBasket ? 'Edgepool flagship basket' :(pool?.name ?? 'Basket')}
                </span>
                {(() => {
                  const b = me.basket.find((x) => pool && traders.some((t) => t.wallet === x.wallet));
                  const inB = b?.inBasket ?? me.basket.some((x) => x.inBasket);
                  return inB ? (
                    <span className="text-[11px] font-bold" style={{ padding: '3px 9px', borderRadius: 6, background: '#004B45', color: '#BBF6EE' }}>In basket</span>
                  ) : (
                    <span className="text-[11px] font-mono" style={{ color: 'var(--ep-muted, #9397AB)' }}>Not in basket</span>
                  );
                })()}
              </div>
              {(() => {
                const ranks = me.basket.find((x) => x.ranks && (x.ranks.h24 !== null || x.ranks.d7 !== null || x.ranks.d30 !== null))?.ranks
                  ?? { h24: null, d7: null, d30: null };
                return (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[['24h', ranks.h24], ['7d', ranks.d7], ['30d', ranks.d30]].map(([k, v]) => (
                      <div key={k as string} className="flex flex-col gap-1">
                        <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{k}</span>
                        <span className="font-mono font-medium" style={{ fontSize: 20 }}>#{typeof v === 'number' ? v : '—'}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <span className="text-[13px]" style={{ lineHeight: 1.5, color: 'var(--ep-muted, #9397AB)' }}>
                You&apos;d move out if you drop below #8 on 7d. Picked by algorithm; you earn{' '}
                <b style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{traderSharePct}%</b> of the profit your signals make here, Edgepool takes{' '}
                <b style={{ color: 'var(--ep-violet, #9184D9)' }}>{edgeSharePct}%</b>.
              </span>
            </section>

            <section style={{ padding: '20px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column' }}>
              <div className="flex justify-between items-baseline" style={{ paddingBottom: 6 }}>
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>My signals in my pool</span>
                <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Fee = {traderSharePct}% of profit</span>
              </div>
              {signals.slice(0, 8).map((sg) => {
                const open = sg.profitUsd === null;
                const fee = !open && sg.profitUsd! > 0 ? (sg.profitUsd! * traderSharePct) / 100 : null;
                const p = { t: open ? '···' : usdToDisplay(sg.profitUsd!), s: fee !== null ? usdToDisplay(fee).replace('+', '') : null };
                return (
                  <div key={sg.id} className="grid items-center text-[13px]" style={{ gridTemplateColumns: '1fr auto auto', gap: 14, padding: '9px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium">{sg.token}</span>
                      <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>{open ? 'Open' : 'Closed'} · @{sg.trader}</span>
                    </div>
                    <span className="font-mono" style={{ color: open ? 'var(--ep-text, #E9E9ED)' : sg.profitUsd! >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                      {open ? '···' : p.t}
                    </span>
                    <span className="font-mono" style={{ color: '#CFD3E5', minWidth: 64, textAlign: 'right' }}>{fee === null ? '—' : p.s}</span>
                  </div>
                );
              })}
              {signals.length === 0 && (
                <span style={{ padding: '12px 0', borderTop: '1px solid var(--ep-border, #2E313F)', fontSize: 13, color: 'var(--ep-muted, #9397AB)' }}>No signals yet.</span>
              )}
            </section>

            <section style={{ padding: '20px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column' }}>
              <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)', paddingBottom: 6 }}>Payouts</span>
              {payouts.slice(0, 8).map((py) => (
                <div key={py.id} className="grid items-center text-xs" style={{ gridTemplateColumns: '1fr auto auto', gap: 12, padding: '9px 0', borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                  <div className="flex flex-col gap-[1px]">
                    <span style={{ color: '#CFD3E5' }}>
                      {new Date(py.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {py.epochId !== null && py.epochId !== undefined ? ' · checkpoint' : ''}
                    </span>
                    <span style={{ color: 'var(--ep-faint, #75798C)' }}>
                      {py.status === 'PAID' ? 'Auto-pay' : py.status === 'CLAIMED' ? 'Manual claim' : py.status}
                    </span>
                  </div>
                  <span className="font-mono">{py.amountSol.toFixed(2)} SOL</span>
                  <span className="font-mono" style={{ color: 'var(--ep-faint, #75798C)' }}>#{py.id}</span>
                </div>
              ))}
              {payouts.length === 0 && (
                <span style={{ padding: '12px 0', borderTop: '1px solid var(--ep-border, #2E313F)', fontSize: 13, color: 'var(--ep-muted, #9397AB)' }}>No payouts yet.</span>
              )}
            </section>
          </div>
        </div>

            <section style={{ padding: '20px 22px', borderRadius: 16, background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="grid items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,280px),1fr))', gap: 20 }}>
                <SharePreview handle={me.handle}
                  isBasket={isBasket} weekSol={sharePreview()?.wSol ?? '—'} weekPct={sharePreview()?.wPct ?? '—'} slug={slug} />
                <div className="flex flex-col gap-3">
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Share card for X</span>
                  <span className="text-[15px]" style={{ lineHeight: 1.5, color: '#CFD3E5' }}>
                    Updates from your live numbers. The link points to your pool page; unlisted pools are only reachable through it.
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        if (!pool) return;
                        const pv = sharePreview();
                        try {
                          downloadShareCard({
                            poolName: pool.name, handle: me.handle,
                            pill: isBasket ? 'TRADER IN THE EDGEPOOL FLAGSHIP BASKET' : `PARTNER OF ${pool.name.toUpperCase()}`,
                            profitText: pv?.wSol ?? '—', profitSub: `Pool profit · 7d`,
                            pctText: pv?.wPct ?? '—', pctSub: `Pool NAV / share · 7d`,
                            link: `edgepool · ${slug}`,
                          });
                          setMsg('Share card downloaded.');
                        } catch (e) {
                          setMsg((e as Error).message);
                        }
                      }}
                      className="font-medium flex items-center gap-2" style={{ height: 42, padding: '0 16px', borderRadius: 8, fontSize: 14, border: '1px solid var(--ep-aqua, #49E6D7)', background: 'transparent', color: 'var(--ep-aqua, #49E6D7)' }}>
                      <DownloadSimple size={16} weight="regular" /> Download PNG
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
                      className="font-medium flex items-center gap-2" style={{ height: 42, padding: '0 16px', borderRadius: 8, fontSize: 14, border: '1px solid #3F424D', background: 'transparent', color: 'var(--ep-text, #E9E9ED)' }}>
                      <LinkSimple size={16} weight="regular" /> Copy pool link
                    </button>
                  </div>
                </div>
              </div>
            </section>
      </div>
      <SiteFooter />
    <Toaster />
    </>
  );
}

function SharePreview({ handle, isBasket, weekSol, weekPct, slug }: {
  handle: string; isBasket: boolean; weekSol: string; weekPct: string; slug: string;
}) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 600, borderRadius: 12, background: 'radial-gradient(70% 90% at 80% 40%, #1C1F30 0%, #161826 50%, #0D0F18 100%)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)', padding: '28px 32px 22px', overflow: 'hidden' }}>
      <img src="/brand/motif-flow.svg" alt="" aria-hidden="true"
        style={{ position: 'absolute', right: -160, top: 8, width: 560, opacity: 0.4, pointerEvents: 'none' }} />
      <div className="relative flex flex-col" style={{ gap: 14 }}>
      <img src="/brand/edgepool-horizontal-dark.svg" alt="edgepool" style={{ height: 22, alignSelf: 'flex-start' }} />
      <span className="self-start flex items-center gap-2 font-mono" style={{ fontSize: 11, letterSpacing: '0.1em', padding: '5px 11px', borderRadius: 999, background: 'rgba(73,230,215,0.08)', boxShadow: 'inset 0 0 0 1px rgba(73,230,215,0.5)', color: 'var(--ep-aqua, #49E6D7)' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ep-aqua, #49E6D7)' }} />
        {isBasket ? 'TRADER IN THE EDGEPOOL FLAGSHIP BASKET' : `PARTNER · ${slug.toUpperCase() || 'POOL'}`}
      </span>
      <span className="font-display font-medium" style={{ fontSize: 30, letterSpacing: '-0.02em' }}>@{handle}</span>
      <div className="flex" style={{ gap: 36 }}>
        <div className="flex flex-col gap-1">
          <span className="font-mono font-medium" style={{ fontSize: 26, color: 'var(--ep-profit, #73DEA4)' }}>{weekSol}</span>
          <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Pool profit · 7d</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono font-medium" style={{ fontSize: 26 }}>{weekPct}</span>
          <span className="text-xs" style={{ color: 'var(--ep-muted, #9397AB)' }}>Pool NAV / share · 7d</span>
        </div>
      </div>
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <span className="font-mono text-xs" style={{ color: '#81EADE' }}>edgepool · {slug || 'pool'}</span>
        <span className="text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Past performance does not indicate future results.</span>
      </div>
      </div>
    </div>
  );
}
