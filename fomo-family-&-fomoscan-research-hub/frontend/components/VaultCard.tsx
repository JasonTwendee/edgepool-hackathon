'use client';

import { useCallback, useEffect, useState } from 'react';
import { Vault } from '@phosphor-icons/react';
import {
  getVaultEarnings,
  getVaultStatus,
  type VaultEarningsResponse,
  type VaultStatusResponse,
} from '../lib/api';

type VaultData = VaultStatusResponse['data'];

export function VaultCard({ showPartner = true }: { showPartner?: boolean }) {
  const [status, setStatus] = useState<VaultData | null>(null);
  const [earnings, setEarnings] = useState<VaultEarningsResponse['data'] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getVaultStatus(1);
      setStatus(res.data);
    } catch {
      // best-effort; panel keeps last state
    }
    try {
      const res = await getVaultEarnings(1);
      setEarnings(res.data);
    } catch {
      // earnings ledger optional; panel keeps last state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 180000);
    return () => clearInterval(timer);
  }, [refresh]);

  const price = status?.lastEpoch?.sharePrice ?? (status && status.totalShares > 0 ? null : 1);

  return (
    <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-medium text-[#E9E9ED] flex items-center gap-1.5">
          <Vault size={16} className="text-[#49E6D7]" />
          Paper vault
        </h3>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest text-[#49E6D7] border border-[#49E6D7]/40 rounded px-1">
            {(status?.environment ?? 'sandbox').toUpperCase()}
          </span>
          <span className="text-[11px] font-mono text-[#75798C]">
            {status ? `${status.totalShares.toFixed(2)} shares` : '…'}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center rounded-lg bg-[#161826] border border-[#3F424D] p-2.5">
        <div>
          <div className="text-[10px] text-[#75798C] font-medium">Share</div>
          <div className="text-xs font-mono font-medium text-[#E9E9ED]">
            {price === null ? '—' : `${price.toFixed(3)} SOL`}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#75798C] font-medium">HWM</div>
          <div className="text-xs font-mono font-medium text-[#E9E9ED]">
            {status ? status.hwmSharePrice.toFixed(3) : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#75798C] font-medium">Queued</div>
          <div className="text-xs font-mono font-medium text-[#E9E9ED]">
            {status ? `${status.queuedDeposits}/${status.queuedWithdrawals}` : '—'}
          </div>
        </div>
      </div>

      {showPartner && ((status?.partnerAccruedSol !== undefined && status.partnerAccruedSol > 0) ||
      (earnings && earnings.totalSol > 0)) ? (
        <div className="rounded-lg bg-[#161826] border border-[#49E6D7]/30 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest text-[#49E6D7]">PARTNER EARNINGS</span>
            <span className="text-xs font-mono font-medium text-[#E9E9ED]">
              {(earnings?.totalSol ?? status?.partnerAccruedSol ?? 0).toFixed(4)} SOL
            </span>
          </div>
          <p className="text-[10px] text-[#75798C] leading-snug">
            15% of new profit above HWM, split pro-rata by trader weight (report §4).
          </p>
          {earnings && Object.entries(earnings.byTrader).slice(0, 3).map(([wallet, amt]) => (
            <div key={wallet} className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-[#A7AABF] truncate" title={wallet}>
                {wallet.slice(0, 6)}…{wallet.slice(-4)}
              </span>
              <span className="text-[#E9E9ED] shrink-0">{amt.toFixed(4)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[10px] text-[#595D6C] leading-snug">
        Paper only — deposits mint shares at settle price, no retro profit.
        {status?.treasurySol !== undefined && status.treasurySol > 0
          ? ` Treasury holds ${status.treasurySol.toFixed(4)} SOL in fees.`
          : ''}
        {status?.policy && (status.policy.withdrawFeeBps > 0 || status.policy.lockHours > 0)
          ? ` Policy: ${status.policy.withdrawFeeBps / 100}% withdraw fee${status.policy.lockHours ? `, ${status.policy.lockHours}h lock` : ''}${status.policy.reserveBps ? `, ${status.policy.reserveBps / 100}% reserve` : ''}.`
          : ''}
      </p>
    </section>
  );
}
