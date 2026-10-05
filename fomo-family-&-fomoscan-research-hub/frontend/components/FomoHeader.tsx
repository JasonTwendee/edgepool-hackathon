'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { TrackedWallet } from '../types/onchain';
import type { WalletPnl } from '../lib/api';
import { formatUsd } from '../lib/format';
import { WalletAvatar } from './WalletAvatar';

interface Props {
  wallets: TrackedWallet[];
  pnlMap: Record<string, WalletPnl>;
  onSelectWallet: (address: string) => void;
  /** Selected wallet holdings USD (real) — shown as crypto balance. */
  cryptoValueUsd: number | null;
  /** Live-trade alert bell (wired by parent). */
  bell: React.ReactNode;
  liveConnected: boolean;
}

export function FomoHeader({ wallets, pnlMap, onSelectWallet, cryptoValueUsd, bell, liveConnected }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Global "/" focuses search (DESIGN.md §7.2).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return wallets
      .filter(
        (w) =>
          w.label.toLowerCase().includes(q) ||
          w.handle.toLowerCase().includes(q) ||
          w.address.toLowerCase().includes(q),
      )
      .slice(0, 7);
  }, [wallets, query]);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setQuery(text.trim());
        inputRef.current?.focus();
      }
    } catch {
      inputRef.current?.focus();
    }
  }

  return (
    <header className="h-14 shrink-0 w-full bg-[#161826] border-b border-[#3F424D] px-4 flex items-center gap-3 relative z-40">
      {/* Brand */}
      {/* Brand lockup (official horizontal-dark, no effects per misuse rules) */}
      <a href="/" className="flex items-center shrink-0" title="edgepool">
        <img src="/brand/edgepool-horizontal-dark.svg" alt="edgepool" className="h-[26px] w-auto" />
      </a>

      {/* Smart search pill */}
      <div ref={boxRef} className="max-w-xl w-full mx-auto relative hidden sm:block">
        <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[#161826] border border-transparent focus-within:border-[#49E6D7]/40 focus-within:bg-[#161826] transition-all">
          <MagnifyingGlass size={16} className="text-[#75798C] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search for tokens or traders..."
            className="text-xs text-[#E9E9ED] placeholder-[#75798C] bg-transparent outline-none flex-1 min-w-0"
          />
          <button
            onClick={pasteFromClipboard}
            title="Paste from clipboard"
            className="text-[10px] text-[#9397AB] font-semibold px-2 py-0.5 rounded-full bg-[#3F424D] hover:text-[#E9E9ED] transition-colors shrink-0"
          >
            Paste
          </button>
          <kbd className="w-5 h-5 flex items-center justify-center text-[11px] text-[#75798C] bg-[#3F424D] rounded-full font-mono shrink-0">
            /
          </kbd>
        </div>

        {focused && query.trim() && (
          <div className="absolute top-11 left-0 right-0 bg-[#232532] border border-[#3F424D] rounded-lg shadow-2xl shadow-black/60 p-2 z-50">
            {results.length === 0 ? (
              <p className="text-[11px] text-[#75798C] px-2.5 py-2">
                No tracked trader matches — paste a Solana address in the sidebar to track it.
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto scrollbar-thin">
                {results.map((w) => {
                  const pnl = pnlMap[w.address];
                  const value = pnl && pnl.pairs > 0 ? pnl.realizedPnlUsd : w.totalPnlUsd;
                  return (
                    <li key={w.address}>
                      <button
                        onClick={() => {
                          onSelectWallet(w.address);
                          setQuery('');
                          setFocused(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#232532] transition-colors text-left"
                      >
                        <WalletAvatar label={w.label} avatarUrl={w.avatar} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold text-[#E9E9ED] truncate">{w.label}</span>
                          <span className="block text-[11px] text-[#75798C] font-mono truncate">@{w.handle}</span>
                        </span>
                        <span className={`text-xs font-mono font-extrabold ${(value ?? 0) >= 0 ? 'text-[#73DEA4]' : 'text-[#F28881]'}`}>
                          {value === undefined || value === null ? '—' : formatUsd(value)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Account & balances */}
      <div className="ml-auto flex items-center gap-3">
        <span className={`hidden md:flex items-center gap-1.5 text-[11px] font-mono font-semibold ${liveConnected ? 'text-[#49E6D7]' : 'text-[#75798C]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${liveConnected ? 'bg-[#49E6D7] animate-pulse' : 'bg-[#595D6C]'}`} />
          {liveConnected ? 'Live' : 'Sync'}
        </span>
        {bell}
        <div className="text-right leading-tight">
          <div className="text-xs font-mono font-bold text-[#E9E9ED]">$0.00 cash</div>
          <button className="text-[10px] text-[#49E6D7] hover:text-[#81EADE] cursor-pointer font-medium" title="Demo balance — deposits are out of scope">
            Deposit more
          </button>
        </div>
        <div className="h-7 w-[1px] bg-[#3F424D]" />
        <div className="text-right leading-tight">
          <div className="text-xs font-mono font-bold text-[#E9E9ED]">{cryptoValueUsd === null ? '—' : formatUsd(cryptoValueUsd)}</div>
          <div className="text-[10px] font-mono text-[#75798C]">tracked</div>
        </div>
        <img
          src="/brand/edgepool-avatar.svg"
          alt="Demo account"
          title="Demo account"
          className="w-8 h-8 rounded-full cursor-pointer"
        />
      </div>
    </header>
  );
}
