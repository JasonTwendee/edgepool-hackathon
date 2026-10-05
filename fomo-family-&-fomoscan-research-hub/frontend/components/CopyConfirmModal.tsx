'use client';

import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { OnChainTransactionEvent, TrackedWallet, CopyOrder } from '../types/onchain';
import { executePaperTrade } from '../lib/api';
import { formatUsd } from '../lib/format';

interface Props {
  wallet: TrackedWallet;
  seed: OnChainTransactionEvent | null;
  onClose: () => void;
  onSuccess: (order: CopyOrder) => void;
}

export function CopyConfirmModal({ wallet, seed, onClose, onSuccess }: Props) {
  const [amountSol, setAmountSol] = useState('0.0001');
  const [slippageBps, setSlippageBps] = useState('50');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CopyOrder | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleConfirm() {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await executePaperTrade({
        masterWallet: wallet.address,
        masterHandle: wallet.handle,
        masterTxHash: seed?.signature,
        symbol: seed?.symbol,
        action: seed?.action,
        tokenMint: seed?.tokenMint,
        amountUsd: seed?.amountUsd,
        venue: seed?.dexVenue,
        mode: 'paper',
        confirm: true,
        maxSlippageBps: Number(slippageBps) || 50,
        paperAmountSol: Number(amountSol) || 0.0001,
      });
      setDone(res.copyRecord);
      onSuccess(res.copyRecord);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm copy trade"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[14px] bg-[#232532] border border-[#3F424D] shadow-2xl shadow-black/60 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-medium text-[#E9E9ED]">Confirm copy</h3>
            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[rgba(73,230,215,0.12)] text-[#49E6D7] border border-[#49E6D7]/30">
              DEVNET PAPER
            </span>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="p-1.5 rounded-lg text-[#75798C] hover:text-[#E9E9ED] hover:bg-[rgba(233,233,237,0.07)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {!done ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs rounded-lg bg-[#161826] border border-[#3F424D] p-3">
              <dt className="text-[#75798C]">Trader</dt>
              <dd className="text-right font-mono text-[#E9E9ED] truncate">@{wallet.handle}</dd>
              <dt className="text-[#75798C]">Signal</dt>
              <dd className="text-right font-bold text-[#E9E9ED]">
                {seed ? `${seed.action} ${seed.symbol}` : '—'}
              </dd>
              <dt className="text-[#75798C]">Notional</dt>
              <dd className="text-right font-mono text-[#E9E9ED]">{formatUsd(seed?.amountUsd)}</dd>
              <dt className="text-[#75798C]">Venue</dt>
              <dd className="text-right text-[#E9E9ED] truncate">{seed?.dexVenue ?? '—'}</dd>
            </dl>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-[#75798C] font-medium">Proof amount (SOL)</span>
                <input
                  value={amountSol}
                  onChange={(e) => setAmountSol(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  className="mt-1 w-full text-xs font-mono px-2.5 py-2 rounded-lg bg-[#161826] border border-[#3F424D] text-[#E9E9ED] outline-none focus:border-[#49E6D7]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#75798C] font-medium">Slippage (bps)</span>
                <input
                  value={slippageBps}
                  onChange={(e) => setSlippageBps(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  className="mt-1 w-full text-xs font-mono px-2.5 py-2 rounded-lg bg-[#161826] border border-[#3F424D] text-[#E9E9ED] outline-none focus:border-[#49E6D7]"
                />
              </label>
            </div>
            <p className="text-[11px] text-[#75798C] leading-relaxed">
              Paper only: quote read-only + dust devnet proof. No mainnet funds move. Cap $100 notional.
            </p>

            {error && (
              <p className="text-[11px] text-[#F28881] leading-snug rounded-lg bg-[rgba(242,136,129,0.08)] border border-[#F28881]/30 px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg border border-[#3F424D] text-[#9397AB] hover:text-[#E9E9ED] text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="flex-1 py-2.5 rounded-lg border border-[#49E6D7] text-[#49E6D7] hover:bg-[rgba(73,230,215,0.12)] disabled:opacity-50 text-xs font-bold transition-colors"
              >
                {busy ? 'Sending…' : 'Confirm copy'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-[rgba(73,230,215,0.08)] border border-[#49E6D7]/30 p-4 text-center space-y-2">
              <p className="text-sm font-bold text-[#49E6D7]">{done.status}</p>
              <p className="text-[11px] font-mono text-[#9397AB] break-all">
                {done.devnetSignature ?? `order #${done.id}`}
              </p>
              {done.devnetSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${done.devnetSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] font-bold text-[#49E6D7] hover:text-[#81EADE] underline"
                >
                  View on devnet explorer
                </a>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-lg border border-[#49E6D7] text-[#49E6D7] hover:bg-[rgba(73,230,215,0.12)] text-xs font-bold transition-colors"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
