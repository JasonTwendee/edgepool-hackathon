'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChartLineUp, SquaresFour, Storefront, Wallet, X } from '@phosphor-icons/react';
import { LoginModal, restoreSession } from './LoginModal';
import { clearSession, getStoredToken, logout } from '../lib/api';
import type { FundSession } from '../types/fund';

export type SiteNav = 'pools' | 'portfolio' | 'trader';

const NAV: { key: SiteNav; label: string; href: string; Icon: typeof SquaresFour }[] = [
  { key: 'pools', label: 'Pools', href: '/', Icon: SquaresFour },
  { key: 'portfolio', label: 'Portfolio', href: '/portfolio', Icon: ChartLineUp },
  { key: 'trader', label: 'Trader', href: '/trader', Icon: Storefront },
];

function shortAddr(wallet: string | undefined, username?: string | null): string {
  if (username) return username;
  if (!wallet) return '';
  if (wallet.startsWith('cred:')) return wallet.slice(5);
  return `${wallet.slice(0, 4)}…${wallet.slice(-3)}`;
}

/**
 * Shared site chrome (design handoff: 64px sticky header, wallet button,
 * mobile bottom tab bar <760px). viewToggle slot = Calm/Advanced (pool page only).
 */
export function SiteHeader({ active, viewToggle }: { active: SiteNav; viewToggle?: React.ReactNode }) {
  const [session, setSession] = useState<FundSession | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void restoreSession().then(setSession);
  }, []);

  async function logoutNow() {
    const token = getStoredToken();
    try {
      if (token) await logout(token);
    } catch {
      // session row may already be gone — still clear locally.
    }
    clearSession();
    setSession(null);
    setMenuOpen(false);
  }

  const close = useCallback(() => {
    setLoginOpen(false);
    setMenuOpen(false);
  }, []);
  useEffect(() => {
    if (!loginOpen && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen, menuOpen, close]);

  const label = session ? shortAddr(session.user.wallet, session.user.username) : '';

  return (
    <>
      <header
        className="sticky top-0 z-40"
        style={{ height: 64, background: 'rgba(22,24,38,0.9)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--ep-border, #2E313F)' }}
      >
        <div className="h-full flex items-center justify-between gap-2" style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(16px,4vw,40px)' }}>
          <Link href="/" className="flex items-center shrink-0" aria-label="Edgepool home">
            <img src="/brand/edgepool-horizontal-dark.svg" alt="edgepool" className="hidden min-[760px]:block" style={{ height: 26 }} />
            <img src="/brand/edgepool-symbol-dark.svg" alt="edgepool" className="block min-[760px]:hidden" style={{ height: 26 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </Link>
          <nav className="hidden min-[760px]:flex items-center gap-1">
            {NAV.map(({ key, label: l, href, Icon }) => (
              <Link
                key={key}
                href={href}
                className="flex items-center gap-1.5 text-sm font-medium px-3 rounded-lg"
                style={{ height: 36, color: active === key ? 'var(--ep-text, #E9E9ED)' : 'var(--ep-muted, #9397AB)' }}
              >
                <Icon size={17} weight={active === key ? 'fill' : 'regular'} />
                {l}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {viewToggle}
          <div className="relative">
            <button
              onClick={() => (session ? setMenuOpen((o) => !o) : setLoginOpen(true))}
              className="flex items-center gap-2 text-sm font-medium px-3 rounded-lg"
              style={{
                height: 38,
                border: '1px solid var(--ep-border-strong, #3F424D)',
                color: session ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-text, #E9E9ED)',
              }}
            >
              <Wallet size={17} weight="regular" />
              <span className="hidden sm:inline font-mono text-xs">{session ? label : 'Connect wallet'}</span>
            </button>
            {menuOpen && session && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-11 z-50 w-56 rounded-xl p-3 space-y-2"
                  style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border-strong, #3F424D), 0 24px 60px rgba(0,0,0,0.5)' }}
                >
                  <div className="font-mono text-xs break-all" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
                    {session.user.username ?? session.user.wallet}
                  </div>
                  <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                    {session.user.role} · {session.user.wallet.startsWith('cred:') ? 'account login' : `${session.user.wallet.slice(0, 6)}…${session.user.wallet.slice(-4)}`}
                  </div>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setLoginOpen(true);
                    }}
                    className="w-full text-xs font-bold px-3 py-2 rounded-lg"
                    style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}
                  >
                    Switch account
                  </button>
                  <button
                    onClick={() => void logoutNow()}
                    className="w-full text-xs font-bold px-3 py-2 rounded-lg"
                    style={{ background: 'var(--ep-neg, #F28881)', color: '#0D0F18' }}
                  >
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar (<760px) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 min-[760px]:hidden flex items-stretch justify-around"
        style={{ height: 68, background: 'rgba(26,28,42,0.96)', backdropFilter: 'blur(10px)', borderTop: '1px solid var(--ep-border, #2E313F)' }}
      >
        {NAV.map(({ key, label: l, href, Icon }) => (
          <Link
            key={key}
            href={href}
            className="flex flex-col items-center justify-center gap-0.5 flex-1"
            style={{ color: active === key ? 'var(--ep-aqua, #49E6D7)' : 'var(--ep-muted, #9397AB)' }}
          >
            <Icon size={22} weight={active === key ? 'fill' : 'regular'} />
            <span style={{ fontSize: 11 }}>{l}</span>
          </Link>
        ))}
      </nav>

      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(13,15,24,0.72)', backdropFilter: 'blur(6px)' }}
          onClick={close}
        >
          <div className="w-full" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button onClick={close} aria-label="Close" className="p-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                <X size={18} />
              </button>
            </div>
            <LoginModal
              session={session}
              onSession={(s) => {
                setSession(s);
                if (s) close();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

export function SiteFooter() {
  return (
    <footer
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
      style={{ borderTop: '1px solid var(--ep-border, #2E313F)', paddingTop: 16, marginTop: 32, paddingBottom: 32, fontSize: 12, color: 'var(--ep-faint, #75798C)' }}
    >
      <span>Past performance does not indicate future results. Memecoin trading carries a high risk of loss.</span>
      <Link href="/trader" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
        Become a partner trader →
      </Link>
    </footer>
  );
}
