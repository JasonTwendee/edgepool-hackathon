'use client';

import { useState } from 'react';
import { LockKey, User, Wallet } from '@phosphor-icons/react';
import {
  getAuthMe,
  issueAuthNonce,
  loginAccount,
  storeSession,
  verifyAuthSignature,
} from '../lib/api';
import { connectProvider, detectWallets, signWithProvider } from '../lib/solana';
import type { AuthNonce, FundSession } from '../types/fund';
import type { DetectedWallet, InjectedSolanaProvider } from '../lib/solana';

interface Props {
  session: FundSession | null;
  onSession: (s: FundSession | null) => void;
}

const inputCls =
  'w-full text-sm bg-[#0D0F18] border border-[#3F424D] rounded-lg pl-9 pr-3 py-2.5 text-[#E9E9ED] placeholder:text-[#4A4D5E] outline-none focus:border-[#E9E9ED]';

/**
 * Global login gate modal (Edgepool dark card).
 * Account (username/password) first + Connect-wallet below. All-English.
 * Password reset does not exist yet — Forgot shows an inline notice.
 */
export function LoginModal({ session, onSession }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [wallet, setWallet] = useState('');
  const [nonce, setNonce] = useState<AuthNonce | null>(null);
  const [signature, setSignature] = useState('');
  const [showWallet, setShowWallet] = useState(false);
  const [detected, setDetected] = useState<DetectedWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function openWalletPicker() {
    setDetected(detectWallets());
    setShowWallet(true);
  }

  async function handleAccount() {
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await loginAccount({ username: username.trim(), password });
      storeSession(res.data);
      onSession({ token: res.data.token, user: res.data.user, expiresAt: res.data.expiresAt });
      setPassword('');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleBrowserLogin() {
    if (busy) return;
    const first = detectWallets().find((d) => d.installed && d.provider);
    if (!first?.provider) {
      openWalletPicker();
      setMsg('No Solana wallet found in this browser. Install Phantom or OKX Wallet, or use paste-signature below.');
      return;
    }
    await handleProviderLogin(first.label, first.provider);
  }

  /** One-click wallet login: connect → sign login message → verify. */
  async function handleProviderLogin(label: string, provider: InjectedSolanaProvider) {
    if (busy) return;
    setBusy(true);
    setMsg(`Waiting for ${label} — approve the connection and signature…`);
    try {
      const address = await connectProvider(provider);
      const res = await issueAuthNonce(address);
      const { signature: sig } = await signWithProvider(provider, res.data.message);
      const verified = await verifyAuthSignature(res.data.wallet, sig);
      storeSession(verified.data);
      onSession({ token: verified.data.token, user: verified.data.user, expiresAt: verified.data.expiresAt });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleManualVerify() {
    if (busy || !nonce || !signature.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await verifyAuthSignature(nonce.wallet, signature.trim());
      storeSession(res.data);
      onSession({ token: res.data.token, user: res.data.user, expiresAt: res.data.expiresAt });
      setNonce(null);
      setSignature('');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleNonce() {
    if (busy || !wallet.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await issueAuthNonce(wallet.trim());
      setNonce(res.data);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (session) return null;

  return (
    <div className="w-full rounded-2xl bg-[#14161D] border border-[#2A2D38] p-6 space-y-4 shadow-2xl">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-bold text-[#E9E9ED]">
          Sign in to your account
        </h2>
        <p className="text-[11px] tracking-wide text-[#75798C]">
          NO ACCOUNT YET? CONTACT YOUR ADMINISTRATOR.
        </p>
      </div>

      <div className="space-y-2.5">
        <div>
          <label className="text-[11px] font-medium text-[#A7AABF]">Username</label>
          <div className="relative mt-1">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#595D6C]" />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. edge_trader"
              autoComplete="username"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-[#A7AABF]">Password</label>
            <button
              onClick={() => setMsg('Password reset is not available in this build — contact an admin.')}
              className="text-[11px] text-[#75798C] hover:text-[#E9E9ED]"
            >
              Forgot?
            </button>
          </div>
          <div className="relative mt-1">
            <LockKey size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#595D6C]" />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              type="password"
              autoComplete="current-password"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAccount(); }}
              className={inputCls}
            />
          </div>
        </div>
        <button
          onClick={() => void handleAccount()}
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-[#E9E9ED] hover:bg-white text-[#161826] text-sm font-bold transition-colors disabled:opacity-50"
        >
          Sign in
        </button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 border-t border-[#2A2D38]" />
        <span className="text-[10px] tracking-widest text-[#595D6C] font-medium">OR SIGN IN WITH</span>
        <div className="flex-1 border-t border-[#2A2D38]" />
      </div>

      <button
        onClick={() => (showWallet ? void handleBrowserLogin() : openWalletPicker())}
        disabled={busy}
        className="w-full py-2.5 px-3 rounded-lg bg-[#232532] hover:bg-[#2A2D38] border border-[#3F424D] text-xs font-bold text-[#E9E9ED] flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
      >
        <Wallet size={15} /> Connect wallet
      </button>

      {showWallet && (
        <div className="space-y-2 rounded-lg bg-[#0D0F18] border border-[#2A2D38] p-3">
          {detected.filter((d) => d.installed && d.provider).map((d) => (
            <button
              key={d.id}
              onClick={() => d.provider && void handleProviderLogin(d.label, d.provider)}
              disabled={busy}
              className="w-full py-2 px-3 rounded-lg bg-[#232532] hover:bg-[#2A2D38] border border-[#3F424D] text-xs font-bold text-[#E9E9ED] transition-colors disabled:opacity-50"
            >
              Continue with {d.label}
            </button>
          ))}
          {detected.filter((d) => !d.installed).map((d) => (
            <a
              key={d.id}
              href={d.installUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full py-2 px-3 rounded-lg border border-[#2A2D38] text-[11px] text-[#75798C] hover:text-[#E9E9ED] text-center transition-colors"
            >
              Install {d.label}
            </a>
          ))}
          <div className="text-[10px] text-[#4A4D5E] text-center">or paste manually below</div>
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Wallet address (Base58)"
            className="w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E] outline-none focus:border-[#E9E9ED]"
          />
          <button
            onClick={() => void (nonce ? handleManualVerify() : handleNonce())}
            disabled={busy}
            className="text-[11px] font-bold text-[#161826] bg-[#E9E9ED] rounded-lg px-2.5 py-1.5 disabled:opacity-50"
          >
            {nonce ? 'Verify & sign in' : 'Get login message'}
          </button>
          {nonce && (
            <div className="text-[10px] font-mono text-[#75798C] break-all">
              Sign this message, then paste the signature:
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Paste Base58 signature"
                className="mt-1 w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E] outline-none focus:border-[#E9E9ED]"
              />
            </div>
          )}
        </div>
      )}

      {msg && <div className="text-[11px] text-[#A7AABF] break-all">{msg}</div>}

      <p className="text-center text-[10px] text-[#4A4D5E]">
        Sandbox build — simulated execution, no real funds move.
      </p>
    </div>
  );
}

/** Lightweight session check for flows that only need the stored token. */
export async function restoreSession(): Promise<FundSession | null> {
  try {
    const { getStoredToken } = await import('../lib/api');
    const token = getStoredToken();
    if (!token) return null;
    const res = await getAuthMe(token);
    return { token, user: res.data, expiresAt: '' };
  } catch {
    return null;
  }
}
