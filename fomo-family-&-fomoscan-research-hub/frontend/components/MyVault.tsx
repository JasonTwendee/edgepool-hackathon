'use client';

import { useCallback, useEffect, useState } from 'react';
import { Vault } from '@phosphor-icons/react';
import {
  getVaultMine,
  queueVaultDeposit,
  requestVaultWithdraw,
  type VaultMine,
} from '../lib/api';
import type { FundSession } from '../types/fund';

/**
 * Investor view: *my* vault position — shares held, current value, returns,
 * plus deposit/withdraw actions. NaN-safe: shows — until the first load.
 */
export function MyVault({ session }: { session: FundSession | null }) {
  const [mine, setMine] = useState<VaultMine | null>(null);
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const res = await getVaultMine(1, session.token);
      setMine(res.data);
    } catch {
      // keep last state
    }
  }, [session]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 180000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function act(kind: 'deposit' | 'withdraw') {
    if (busy || !session) return;
    setBusy(true);
    setMsg(null);
    try {
      if (kind === 'deposit') {
        const amt = Number(amount);
        if (!(amt > 0)) throw new Error('Enter a positive SOL amount.');
        const res = await queueVaultDeposit({ amountSol: amt }, session.token);
        setMsg(res.data.status === 'SETTLED' && res.data.sharesMinted !== undefined
          ? `Deposit #${res.data.id} settled → ${res.data.sharesMinted.toFixed(4)} shares.`
          : `Deposit #${res.data.id} queued — settles at next epoch price.`);
        setAmount('');
      } else {
        const sh = Number(shares);
        if (!(sh > 0)) throw new Error('Enter positive shares.');
        const res = await requestVaultWithdraw({ shares: sh }, session.token);
        setMsg(res.data.status === 'SETTLED' && res.data.payoutSol !== undefined
          ? `Withdraw #${res.data.id} settled → ${res.data.payoutSol.toFixed(4)} SOL.`
          : `Withdraw #${res.data.id} queued — settles at next epoch price.`);
        setShares('');
      }
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const ret = mine?.returnsSol ?? null;

  return (
    <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-medium text-[#E9E9ED] flex items-center gap-1.5">
          <Vault size={16} className="text-[#49E6D7]" />
          My vault
        </h3>
        <span className="text-[11px] font-mono text-[#75798C]">
          {mine ? `${mine.shares.toFixed(2)} shares` : '…'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center rounded-lg bg-[#161826] border border-[#3F424D] p-2.5">
        <div>
          <div className="text-[10px] text-[#75798C] font-medium">Value</div>
          <div className="text-xs font-mono font-medium text-[#E9E9ED]">
            {mine ? `${mine.valueSol.toFixed(4)} SOL` : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#75798C] font-medium">Returns</div>
          <div className={`text-xs font-mono font-medium ${(ret ?? 0) >= 0 ? 'text-[#73DEA4]' : 'text-[#F28881]'}`}>
            {ret === null ? '—' : `${ret >= 0 ? '+' : ''}${ret.toFixed(4)} SOL`}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#75798C] font-medium">Queued</div>
          <div className="text-xs font-mono font-medium text-[#E9E9ED]">
            {mine ? `${mine.queuedDeposits.length}/${mine.queuedWithdrawals.length}` : '—'}
          </div>
        </div>
      </div>

      <p className="text-[11px] font-mono text-[#75798C]">
        {session.user.wallet.slice(0, 8)}… · session identity
      </p>
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
      <p className="text-[10px] text-[#595D6C] leading-snug">
        Paper only — deposits mint shares at settle price, no retro profit.
      </p>
    </section>
  );
}
