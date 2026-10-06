'use client';

import { useState } from 'react';
import { Tray, Lightning } from '@phosphor-icons/react';
import type { OnChainTransactionEvent, TrackedWallet } from '../types/onchain';
import type { WalletHoldings } from '../lib/api';
import { formatUsd } from '../lib/format';
import { WalletAvatar } from './WalletAvatar';
import { CopyConfirmModal } from './CopyConfirmModal';
import { CopyHistory } from './CopyHistory';
import { VaultCard } from './VaultCard';

interface Props {
  wallet: TrackedWallet | null;
  holdings: WalletHoldings | null;
  lastSwap: OnChainTransactionEvent | null;
  /** Non-ADMIN hides fund-movement + copy-trade UI (PnL-first user view). */
  isAdmin: boolean;
}

export function FomoRightPanel({ wallet, holdings, lastSwap, isAdmin }: Props) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [positionsTab, setPositionsTab] = useState<'open' | 'closed'>('open');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  function handleSend() {
    if (!wallet) {
      setSendMsg('Select a trader first.');
      return;
    }
    // Send is UI-only in this build: no fund-movement endpoint is wired.
    setSendMsg(
      amount.trim()
        ? `Demo only — sending $${amount.trim()} to @${wallet.handle} is disabled (no custody wired).`
        : `Demo only — enter an amount to preview a send to @${wallet.handle}.`,
    );
  }

  const openTokens = (holdings?.tokens ?? []).slice(0, 5);

  return (
    <aside className="w-full lg:w-[320px] shrink-0 bg-[#0D0F18] border-t lg:border-t-0 lg:border-l border-[#3F424D] lg:h-full lg:overflow-y-auto scrollbar-thin">
      <div className="p-4 space-y-4">
        {/* Send card — fund movement UI, ADMIN only */}
        {isAdmin && (
        <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-medium text-[#E9E9ED]">Send</h3>
            {wallet ? (
              <span className="flex items-center gap-1.5 bg-[#161826] border border-[#3F424D] px-2.5 py-1 rounded-full text-xs text-[#E9E9ED] min-w-0">
                <WalletAvatar label={wallet.label} avatarUrl={wallet.avatar} address={wallet.address} size="sm" />
                <span className="truncate font-mono">@{wallet.handle} ⚡</span>
              </span>
            ) : (
              <span className="text-[11px] text-[#75798C]">Select a trader</span>
            )}
          </div>

          <div className="bg-[#232532] border border-[#3F424D] rounded-lg p-3 flex items-center justify-between gap-2">
            <div className="flex items-center min-w-0">
              <span className="text-xl font-bold text-[#75798C] mr-1">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                inputMode="decimal"
                className="text-2xl font-mono font-medium text-[#E9E9ED] bg-transparent outline-none w-32 placeholder-[#595D6C] min-w-0"
              />
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-[#E9E9ED] bg-[#232532] px-2 py-1 rounded-md border border-[#3F424D] inline-block">
                $ Cash ⌄
              </div>
              <div className="text-[10px] font-mono text-[#75798C] mt-1">$0 available</div>
            </div>
          </div>

          <div className="relative">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              placeholder="Add a note"
              className="w-full text-xs px-3 py-2.5 pr-14 rounded-lg bg-[#161826] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#75798C]">
              {note.length}/200
            </span>
          </div>

          <button
            onClick={handleSend}
            className="w-full py-3 rounded-lg bg-[#232532] border border-[#3F424D] hover:border-[#49E6D7] text-[#9397AB] hover:text-[#49E6D7] text-xs font-bold transition-all"
          >
            Send
          </button>
          {sendMsg && <p className="text-[11px] text-[#9397AB] leading-snug">{sendMsg}</p>}

          {isAdmin && (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!wallet}
            className="w-full py-2.5 px-3 rounded-lg bg-[rgba(73,230,215,0.06)] border border-[#49E6D7]/40 hover:border-[#49E6D7] disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Lightning size={16} className="text-[#49E6D7]" />
            <span className="text-xs font-bold text-[#BBF6EE]">
              {wallet ? `Copy Next Trade From ${wallet.handle}` : 'Copy Next Trade'}
            </span>
          </button>
          )}
          {isAdmin && (
          <p className="text-[10px] text-[#595D6C] leading-snug">Paper only — devnet proof, no mainnet funds move.</p>
          )}
        </section>
        )}

        {/* Your positions */}
        <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-medium text-[#E9E9ED]">Your positions</h3>
            <div className="flex gap-1 bg-[#161826] border border-[#3F424D] rounded-lg p-0.5">
              {(['open', 'closed'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPositionsTab(t)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md capitalize transition-colors ${
                    positionsTab === t ? 'bg-[rgba(73,230,215,0.12)] text-[#49E6D7]' : 'text-[#9397AB] hover:text-[#E9E9ED]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {positionsTab === 'open' && openTokens.length > 0 ? (
            <ul className="space-y-2">
              {openTokens.map((t) => (
                <li key={t.mint} className="flex items-center justify-between gap-2 rounded-lg bg-[#161826] border border-[#3F424D] px-3 py-2">
                  <span className="text-xs font-bold text-[#E9E9ED] truncate" title={t.mint}>{t.symbol}</span>
                  <span className="text-xs font-mono font-medium text-[#E9E9ED] shrink-0">
                    {t.valueUsd !== null ? formatUsd(t.valueUsd) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-[#232532] border border-[#3F424D] p-6 flex flex-col items-center justify-center text-center space-y-2">
              <Tray size={24} className="text-[#595D6C]" />
              <p className="text-xs text-[#75798C] max-w-[220px] leading-relaxed">
                {positionsTab === 'closed'
                  ? 'No closed positions yet.'
                  : 'No open positions. Trades you execute or copy will appear here in real-time.'}
              </p>
            </div>
          )}
        </section>

        {isAdmin && <CopyHistory walletAddress={wallet?.address ?? null} refreshKey={historyKey} />}

        <VaultCard isAdmin={isAdmin} />
      </div>

      {isAdmin && confirmOpen && wallet && (
        <CopyConfirmModal
          wallet={wallet}
          seed={lastSwap}
          onClose={() => setConfirmOpen(false)}
          onSuccess={() => setHistoryKey((k) => k + 1)}
        />
      )}
    </aside>
  );
}
