'use client';

import { useState } from 'react';
import { Bell, CaretDoubleLeft, Coins, Newspaper, Plus, Trophy, X } from '@phosphor-icons/react';
import type { TrackedWallet } from '../types/onchain';
import type { WalletPnl } from '../lib/api';
import { formatUsdSigned, shortAddress } from '../lib/format';
import { WalletAvatar } from './WalletAvatar';

interface Props {
  wallets: TrackedWallet[];
  pnlMap: Record<string, WalletPnl>;
  selectedAddress: string | null;
  onSelect: (address: string) => void;
  onAdd: (input: { address: string; label?: string; allocationWeight?: number }) => Promise<string | null>;
  onRemove: (address: string) => void;
  loading: boolean;
  showRight: boolean;
  showTicker: boolean;
  onToggleRight: () => void;
  onToggleTicker: () => void;
}

/** Live value first (realized pairs), otherwise FOMO leaderboard seed. */
function displayPnl(w: TrackedWallet, pnlMap: Record<string, WalletPnl>): { value?: number; winRate?: number; live: boolean } {
  const p = pnlMap[w.address];
  if (p && p.pairs > 0) {
    return { value: p.realizedPnlUsd, winRate: p.winRate ?? undefined, live: true };
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
  onAdd,
  onRemove,
  loading,
  showRight,
  showTicker,
  onToggleRight,
  onToggleTicker,
}: Props) {
  const [activeTab, setActiveTab] = useState<string>('leaderboard');
  const [compact, setCompact] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [weight, setWeight] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...wallets].sort(
    (a, b) => (displayPnl(b, pnlMap).value ?? 0) - (displayPnl(a, pnlMap).value ?? 0),
  );
  const selectedRank = selectedAddress ? sorted.findIndex((w) => w.address === selectedAddress) : -1;
  const selectedShown = selectedAddress ? sorted[selectedRank] : undefined;
  const selectedPnl = selectedShown ? displayPnl(selectedShown, pnlMap) : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const err = await onAdd({
      address: address.trim(),
      label: label.trim() || undefined,
      allocationWeight: weight ? Number(weight) : undefined,
    });
    setSubmitting(false);
    if (err) {
      setFormError(err);
    } else {
      setAddress('');
      setLabel('');
      setWeight('');
      setShowForm(false);
    }
  }

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

        {/* Tracked wallets header + Add */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#E9E9ED]">
            Tracked Wallets{' '}
            <span className="ml-1 text-[11px] font-semibold text-[#9397AB]">{wallets.length}</span>
          </h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#49E6D7] text-[#49E6D7] hover:bg-[rgba(73,230,215,0.12)] transition-colors"
          >
            <Plus size={14} className="" />
            Add
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-[#3F424D] bg-[#161826] p-3">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Solana address (base58)"
              className="w-full text-xs font-mono px-2.5 py-2 rounded-lg bg-[#0D0F18] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
            />
            <div className="flex gap-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-lg bg-[#0D0F18] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
              />
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="Weight"
                inputMode="decimal"
                className="w-20 text-xs font-mono px-2.5 py-2 rounded-lg bg-[#0D0F18] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
              />
            </div>
            {formError && <p className="text-[11px] text-[#F28881]">{formError}</p>}
            <button
              type="submit"
              disabled={submitting || !address.trim()}
              className="w-full text-xs font-bold px-2.5 py-2 rounded-lg border border-[#49E6D7] text-[#49E6D7] hover:bg-[rgba(73,230,215,0.12)] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Adding…' : 'Start tracking'}
            </button>
          </form>
        )}

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
                    <span className="w-5 flex justify-center shrink-0">{rankBadge(i)}</span>
                    <WalletAvatar label={w.label} avatarUrl={w.avatar} size="sm" />
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
                    <button
                      title="Stop tracking"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Stop tracking ${w.label}? History will be deleted.`)) {
                          onRemove(w.address);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#75798C] hover:text-[#F28881] hover:bg-rose-500/10 transition-all shrink-0"
                    >
                      <X size={14} className="" />
                    </button>
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
