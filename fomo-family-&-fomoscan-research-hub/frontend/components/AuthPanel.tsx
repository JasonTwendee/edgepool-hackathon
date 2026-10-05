'use client';

import { useState } from 'react';
import { Key, SignOut, Wallet } from '@phosphor-icons/react';
import {
  clearSession,
  getAuthMe,
  issueAuthNonce,
  loginAccount,
  logout as logoutRequest,
  storeSession,
  verifyAuthSignature,
} from '../lib/api';
import { connectProvider, detectWallets, signWithProvider } from '../lib/solana';
import type { AuthNonce, FundSession } from '../types/fund';

interface Props {
  session: FundSession | null;
  onSession: (s: FundSession | null) => void;
}

export function AuthPanel({ session, onSession }: Props) {
  // Account tab first: public visitors log in with username/password, no wallet needed.
  const [tab, setTab] = useState<'wallet' | 'account'>('account');
  // Operator token shortcut is dev-only (hidden unless explicitly enabled at build).
  const showDevShortcut = process.env.NEXT_PUBLIC_SHOW_DEV_LOGIN === '1';
  const [wallet, setWallet] = useState('');
  const [nonce, setNonce] = useState<AuthNonce | null>(null);
  const [signature, setSignature] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleNonce() {
    if (busy || !wallet.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await issueAuthNonce(wallet.trim());
      setNonce(res.data);
      setMsg('Sign the message below with your wallet (Phantom dapp / CLI / script), then paste the Base58 signature.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (busy || !nonce || !signature.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await verifyAuthSignature(nonce.wallet, signature.trim());
      storeSession(res.data);
      onSession({ token: res.data.token, user: res.data.user, expiresAt: res.data.expiresAt });
      setNonce(null);
      setSignature('');
      setMsg(`Logged in as ${res.data.user.wallet.slice(0, 8)}… (${res.data.user.role}).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTokenLogin() {
    if (busy || !tokenInput.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await getAuthMe(tokenInput.trim());
      const stored = { token: tokenInput.trim(), user: res.data, expiresAt: '' };
      storeSession({ token: stored.token, user: stored.user, expiresAt: stored.expiresAt });
      onSession(stored);
      setTokenInput('');
      setMsg(`Token accepted (${res.data.role}).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutRequest(session?.token);
    } catch {
      // BE logout is best-effort; always clear the local copy.
    }
    clearSession();
    onSession(null);
    setMsg('Logged out — token cleared.');
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
      setMsg(`Signed in (${res.data.user.role}).`);
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
      setMsg('No Solana wallet found in this browser. Install Phantom or OKX Wallet, or use paste-signature below.');
      return;
    }
    setBusy(true);
    setMsg(`Waiting for ${first.label} — approve the connection and signature…`);
    try {
      const address = await connectProvider(first.provider);
      const res = await issueAuthNonce(address);
      const { signature } = await signWithProvider(first.provider, res.data.message);
      const verified = await verifyAuthSignature(res.data.wallet, signature);
      storeSession(verified.data);
      onSession({ token: verified.data.token, user: verified.data.user, expiresAt: verified.data.expiresAt });
      setMsg(`Logged in as ${verified.data.user.wallet.slice(0, 8)}… (${verified.data.user.role}).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4 space-y-3">
      <h3 className="font-display text-sm font-medium text-[#E9E9ED] flex items-center gap-1.5">
        <Key size={16} className="text-[#49E6D7]" />
        Fund login
      </h3>

      {session ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-mono text-[#E9E9ED] truncate" title={session.user.username ?? session.user.wallet}>
              {session.user.username ? `@${session.user.username}` : `${session.user.wallet.slice(0, 6)}…${session.user.wallet.slice(-4)}`}
            </div>
            <div className="text-[10px] font-bold tracking-widest text-[#49E6D7]">{session.user.role}</div>
          </div>
          <button
            onClick={() => void handleLogout()}
            title="Log out"
            className="shrink-0 text-xs flex items-center gap-1 text-[#75798C] hover:text-[#E9E9ED] border border-[#3F424D] rounded-lg px-2.5 py-1.5"
          >
            <SignOut size={14} /> Log out
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            {(['wallet', 'account'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 border ${
                  tab === t ? 'bg-[#49E6D7] text-[#161826] border-[#49E6D7]' : 'text-[#A7AABF] border-[#3F424D]'
                }`}
              >
                {t === 'wallet' ? 'Wallet' : 'Account'}
              </button>
            ))}
          </div>
          {tab === 'account' ? (
            <div className="space-y-2">
              <div className="text-[11px] text-[#75798C]">No account yet? Contact your administrator.</div>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username (a-z, 0-9, _)"
                className="w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (8+ chars)"
                type="password"
                className="w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]"
              />
              <button
                onClick={() => void handleAccount()}
                disabled={busy}
                className="text-xs font-bold text-[#161826] bg-[#49E6D7] rounded-lg px-2.5 py-1.5 disabled:opacity-50"
              >
                Sign in
              </button>
            </div>
          ) : (
          <div className="space-y-2">
          <button
            onClick={() => void handleBrowserLogin()}
            disabled={busy}
            className="w-full text-xs font-bold flex items-center justify-center gap-1.5 text-[#161826] bg-[#49E6D7] rounded-lg px-2.5 py-2 disabled:opacity-50"
          >
            <Wallet size={14} /> Sign in with browser wallet
          </button>
          <div className="text-[10px] text-[#75798C] font-medium">…or manual flow:</div>
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Wallet address (Base58)"
            className="w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]"
          />
          <button
            onClick={() => void handleNonce()}
            disabled={busy}
            className="text-xs font-bold text-[#161826] bg-[#49E6D7] rounded-lg px-2.5 py-1.5 disabled:opacity-50"
          >
            1 · Get login message
          </button>
          {nonce && (
            <div className="space-y-2">
              <pre className="text-[11px] font-mono text-[#A7AABF] bg-[#161826] border border-[#3F424D] rounded-lg p-2 whitespace-pre-wrap break-all">
                {nonce.message}
              </pre>
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Paste Base58 signature"
                className="w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]"
              />
              <button
                onClick={() => void handleVerify()}
                disabled={busy}
                className="text-xs font-bold text-[#161826] bg-[#49E6D7] rounded-lg px-2.5 py-1.5 disabled:opacity-50"
              >
                2 · Verify & log in
              </button>
            </div>
          )}
          {showDevShortcut && (
          <div className="pt-1 border-t border-[#3F424D] space-y-2">
            <div className="text-[10px] text-[#75798C] font-medium">Operator shortcut (dev only)</div>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste session token"
              type="password"
              className="w-full text-xs font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]"
            />
            <button
              onClick={() => void handleTokenLogin()}
              disabled={busy}
              className="text-xs text-[#A7AABF] hover:text-[#E9E9ED] border border-[#3F424D] rounded-lg px-2.5 py-1.5 disabled:opacity-50"
            >
              Use token
            </button>
          </div>
          )}
          </div>
          )}
        </div>
      )}
      {msg && <div className="text-[11px] text-[#A7AABF] break-all">{msg}</div>}
    </section>
  );
}
