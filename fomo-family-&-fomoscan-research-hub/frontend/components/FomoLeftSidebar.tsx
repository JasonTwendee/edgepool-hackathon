'use client';

import { useState } from 'react';
import { Bell, CaretDoubleLeft, Coins, Newspaper, Trophy } from '@phosphor-icons/react';
import type { TrackedWallet } from '../types/onchain';
import type { WalletPnl } from '../lib/api';
import { formatUsdSigned, shortAddress } from '../lib/format';
import { WalletAvatar } from './WalletAvatar';

interface Props {
  wallets: TrackedWallet[];
  pnlMap: Record<string, WalletPnl>;
  selectedAddress: string | null;
  onSelect: (address: string) => void;
  loading: boolean;
  showRight: boolean;
  showTicker: boolean;
  onToggleRight: () => void;
  onToggleTicker: () => void;
}

/** Live value first (realized pairs), then leaderboard snapshot, then local seed. */
function displayPnl(w: TrackedWallet, pnlMap: Record<string, WalletPnl>): { value?: number; winRate?: number; live: boolean; fomoRank?: number } {
  const p = pnlMap[w.address];
  if (p && p.pairs > 0) {
    return { value: p.realizedPnlUsd, winRate: p.winRate ?? undefined, live: true, fomoRank: w.fomoRank ?? undefined };
  }
  if (w.fomoPnlUsd !== null && w.fomoPnlUsd !== undefined) {
    return { value: w.fomoPnlUsd, winRate: w.winRate, live: false, fomoRank: w.fomoRank ?? undefined };
  }
  return { value: w.totalPnlUsd, winRate: w.winRate, live: false };
}

const TABS = [
  { key: 'alerts', label: 'Alerts', icon: Bell },
  { key: 'tokens', label: 'Tokens', icon: Coins },
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'feed', label: 'Feed', icon: Newspaper },
] as const;

function rankBadge(i: number) {
  if (i === 0) return <span className="text-base text-[#F0BE67] leading-none" title="Top 1">👑</span>;
  if (i === 1) return <span className="text-base leading-none" title="Top 2">🥈</span>;
  if (i === 2) return <span className="text-base leading-none" title="Top 3">🥉</span>;
  return <span className="text-xs font-mono font-bold text-[#75798C]">{i + 1}.</span>;
}

export function FomoLeftSidebar({
  wallets,
  pnlMap,
  selectedAddress,
  onSelect,
  loading,
  showRight,
  showTicker,
  onToggleRight,
  onToggleTicker,
}: Props) {
  const [activeTab, setActiveTab] = useState<string>('leaderboard');
  const [compact, setCompact] = useState(false);

  // Leaderboard order = official FomoScan rank first (nulls last, then by
  // displayed PnL). The badge always shows the same source as the sort, so
  // numbers are dense and never a mix of two ranking systems.
  const sorted = [...wallets]
    .filter((w) => w.isActive !== false)
    .sort((a, b) => {
      const ra = a.fomoRank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.fomoRank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (displayPnl(b, pnlMap).value ?? 0) - (displayPnl(a, pnlMap).value ?? 0);
    });
  const selectedRank = selectedAddress ? sorted.findIndex((w) => w.address === selectedAddress) : -1;
  const selectedShown = selectedAddress ? sorted[selectedRank] : undefined;
  const selectedPnl = selectedShown ? displayPnl(selectedShown, pnlMap) : undefined;

  return (
    <aside className="w-full lg:w-[330px] shrink-0 bg-[#0D0F18] border-b lg:border-b-0 lg:border-r border-[#3F424D] lg:h-full lg:overflow-y-auto scrollbar-thin">
      <div className="p-4 space-y-4">
        {/* Top tabs */}
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                title={active ? t.label : `${t.label} (soon)`}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors ${
                  active ? 'bg-[#232532] text-[#E9E9ED] font-bold' : 'text-[#9397AB] hover:text-[#E9E9ED] font-medium'
                }`}
              >
                <Icon size={14} />
                <span className={t.key === 'alerts' ? '' : 'hidden xl:inline'}>{t.key === 'alerts' ? '' : t.label}</span>
                {t.key !== 'leaderboard' && (
                  <span className="text-[8px] font-bold px-1 rounded bg-[#3F424D] text-[#75798C]">soon</span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => setCompact((v) => !v)}
            title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            className="ml-auto p-1.5 rounded-lg text-[#75798C] hover:text-[#E9E9ED] transition-colors"
          >
            <CaretDoubleLeft size={16} className={`transition-transform ${compact ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {!compact && (
          <>
            {/* Your rank (real) */}
            <div className="p-2.5 rounded-lg bg-[#232532] border border-[#3F424D] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img
                  src="/brand/edgepool-avatar.svg"
                  alt="Your rank"
                  className="w-7 h-7 rounded-full shrink-0"
                />
                <div>
                  <div className="text-[11px] text-[#9397AB] font-medium">Your rank</div>
                  <div className="text-xs font-mono font-bold text-[#E9E9ED]">
                    {selectedRank >= 0 ? `# ${selectedRank + 1}` : '# --'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-[#9397AB] font-medium">PnL</div>
                <div className={`text-xs font-mono font-bold ${(selectedPnl?.value ?? 0) >= 0 ? 'text-[#73DEA4]' : 'text-[#F28881]'}`}>
                  {selectedPnl?.value === undefined ? '--' : formatUsdSigned(selectedPnl.value)}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Tracked wallets (auto-rotated from the verified leaderboard) */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#E9E9ED]">
            Tracked Wallets{' '}
            <span className="ml-1 text-[11px] font-semibold text-[#9397AB]">{wallets.length}</span>
          </h2>
          <span className="text-[10px] text-[#595D6C] font-medium" title="Top traders rotate in automatically">
            auto top
          </span>
        </div>

        {/* Leaderboard list (real wallets) */}
        {loading && wallets.length === 0 ? (
          <p className="text-xs text-[#75798C]">Loading wallets…</p>
        ) : (
          <ol className="space-y-1.5">
            {sorted.map((w, i) => {
              const active = w.address === selectedAddress;
              const shown = displayPnl(w, pnlMap);
              const pnlTitle = shown.live
                ? `Realized PnL from ${pnlMap[w.address].pairs} paired trades`
                : 'FOMO leaderboard (no paired trades yet)';
              return (
                <li key={w.address}>
                  <div
                    onClick={() => onSelect(w.address)}
                    className={`group flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#232532] border-[#49E6D7]/50 border-l-2 border-l-[#49E6D7]'
                        : 'bg-[#232532]/60 border-[#3F424D] hover:border-[#3F424D] hover:bg-[#232532]/60'
                    }`}
                  >
                    <span className="w-5 flex justify-center shrink-0" title={shown.fomoRank ? `FomoScan rank #${shown.fomoRank}` : 'Unranked this period'}>
                      {shown.fomoRank ? (
                        <span className="text-[10px] font-mono font-bold text-[#49E6D7]">#{shown.fomoRank}</span>
                      ) : (
                        <span className="text-xs font-mono font-bold text-[#595D6C]">•</span>
                      )}
                    </span>
                    <WalletAvatar label={w.label} avatarUrl={w.avatar} address={w.address} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[#E9E9ED] truncate">{w.label}</div>
                      <div className="text-[11px] text-[#75798C] font-mono truncate">
                        @{w.handle} · {shortAddress(w.address)}
                      </div>
                    </div>
                    <div className="text-right shrink-0" title={pnlTitle}>
                      <div className={`text-xs font-mono font-extrabold tracking-tight ${(shown.value ?? 0) >= 0 ? 'text-[#73DEA4]' : 'text-[#F28881]'}`}>
                        {shown.value === undefined ? '—' : formatUsdSigned(shown.value)}
                        {!shown.live && <span className="ml-1 text-[8px] text-[#595D6C] font-bold">fomo</span>}
                      </div>
                      <div className="text-[10px] text-[#75798C] font-mono">{shown.winRate?.toFixed(1) ?? '—'}% win</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Panel controls */}
        <div className="flex items-center gap-4 pt-1">
          <button
            onClick={onToggleTicker}
            title="Toggle market ticker"
            className="text-[11px] text-[#75798C] hover:text-[#E9E9ED] transition-colors cursor-pointer flex items-center gap-1.5"
          >
            ⚏ Ticker {showTicker ? '(on)' : '(off)'}
          </button>
          <button
            onClick={onToggleRight}
            title="Toggle action panel"
            className="text-[11px] text-[#75798C] hover:text-[#E9E9ED] transition-colors cursor-pointer flex items-center gap-1.5"
          >
            ▯ Panel {showRight ? '(on)' : '(off)'}
          </button>
        </div>
      </div>
    </aside>
  );
}
