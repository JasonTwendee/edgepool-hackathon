'use client';

import { useCallback, useEffect, useState } from 'react';
import { Vault } from '@phosphor-icons/react';
import {
  getVaultStatus,
  queueVaultDeposit,
  requestVaultWithdraw,
  type VaultStatusResponse,
} from '../lib/api';

type VaultData = VaultStatusResponse['data'];

export function VaultCard({ isAdmin = true }: { isAdmin?: boolean }) {
  const [status, setStatus] = useState<VaultData | null>(null);
  const [depositor, setDepositor] = useState('local');
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getVaultStatus(1);
      setStatus(res.data);
    } catch {
      // best-effort; panel keeps last state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function act(kind: 'deposit' | 'withdraw') {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      if (kind === 'deposit') {
        const amt = Number(amount);
        if (!depositor.trim() || !(amt > 0)) throw new Error('Enter a name and a positive SOL amount.');
        const res = await queueVaultDeposit({ depositor: depositor.trim(), amountSol: amt });
        setMsg(`Deposit #${res.data.id} queued — settles at next epoch price.`);
        setAmount('');
      } else {
        const sh = Number(shares);
        if (!depositor.trim() || !(sh > 0)) throw new Error('Enter a name and positive shares.');
        const res = await requestVaultWithdraw({ depositor: depositor.trim(), shares: sh });
        setMsg(`Withdraw #${res.data.id} queued — settles at next epoch price.`);
        setShares('');
      }
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

      {isAdmin && (
      <>
      <input
        value={depositor}
        onChange={(e) => setDepositor(e.target.value)}
        placeholder="Your name"
        className="w-full text-xs px-3 py-2 rounded-lg bg-[#161826] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex gap-1.5">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="SOL"
            inputMode="decimal"
            className="flex-1 min-w-0 text-xs font-mono px-2.5 py-2 rounded-lg bg-[#161826] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
          />
          <button
            onClick={() => void act('deposit')}
            disabled={busy}
            title="Queue a deposit (settles at epoch price)"
            className="shrink-0 text-[11px] font-bold px-2.5 py-2 rounded-lg border border-[#49E6D7] text-[#49E6D7] hover:bg-[rgba(73,230,215,0.12)] disabled:opacity-50 transition-colors"
          >
            In
          </button>
        </div>
        <div className="flex gap-1.5">
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="Shares"
            inputMode="decimal"
            className="flex-1 min-w-0 text-xs font-mono px-2.5 py-2 rounded-lg bg-[#161826] border border-[#3F424D] text-[#E9E9ED] placeholder:text-[#75798C] outline-none focus:border-[#49E6D7]"
          />
          <button
            onClick={() => void act('withdraw')}
            disabled={busy}
            title="Request a withdrawal (settles at epoch price)"
            className="shrink-0 text-[11px] font-bold px-2.5 py-2 rounded-lg border border-[#3F424D] text-[#9397AB] hover:text-[#E9E9ED] disabled:opacity-50 transition-colors"
          >
            Out
          </button>
        </div>
      </div>
      {msg && <p className="text-[11px] text-[#9397AB] leading-snug">{msg}</p>}
      </>
      )}
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
