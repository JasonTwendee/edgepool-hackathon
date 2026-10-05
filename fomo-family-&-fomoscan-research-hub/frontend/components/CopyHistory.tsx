'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CopyOrder } from '../types/onchain';
import { listCopyHistory } from '../lib/api';
import { formatUsd } from '../lib/format';

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-[rgba(115,222,164,0.10)] text-[#73DEA4] border-[#73DEA4]/30',
  FAILED: 'bg-[rgba(242,136,129,0.10)] text-[#F28881] border-[#F28881]/30',
  SENT: 'bg-[rgba(240,190,103,0.10)] text-[#F0BE67] border-[#F0BE67]/30',
  QUATED: 'bg-[rgba(240,190,103,0.10)] text-[#F0BE67] border-[#F0BE67]/30',
  PENDING: 'bg-[rgba(147,151,171,0.10)] text-[#9397AB] border-[#3F424D]',
};

interface Props {
  walletAddress: string | null;
  refreshKey: number;
}

export function CopyHistory({ walletAddress, refreshKey }: Props) {
  const [orders, setOrders] = useState<CopyOrder[]>([]);
  const [total, setTotal] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await listCopyHistory({ wallet: walletAddress ?? undefined, limit: 10 });
      setOrders(res.data);
      setTotal(res.total);
    } catch {
      // best-effort; panel keeps last state
    }
  }, [walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-medium text-[#E9E9ED]">Copy history</h3>
        <span className="text-[11px] font-mono text-[#75798C]">{total} paper</span>
      </div>
      {orders.length === 0 ? (
        <p className="text-xs text-[#75798C] py-4 text-center leading-relaxed">
          No paper copies yet. Confirm a copy to see it here.
        </p>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="rounded-lg bg-[#161826] border border-[#3F424D] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#E9E9ED] truncate">
                  {o.action ?? '?'} {o.symbol ?? '—'}
                  <span className="ml-1.5 font-mono font-medium text-[#9397AB]">
                    {formatUsd(o.amountUsd)}
                  </span>
                </span>
                <span className={`shrink-0 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[o.status] ?? STATUS_STYLE.PENDING}`}>
                  {o.status}
                </span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-[#75798C] truncate">
                {o.devnetSignature ? (
                  <a
                    href={`https://explorer.solana.com/tx/${o.devnetSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#49E6D7]"
                    title={o.devnetSignature}
                  >
                    {o.devnetSignature.slice(0, 8)}…{o.devnetSignature.slice(-4)}
                  </a>
                ) : (
                  `#${o.id}`
                )}
                {o.closeReason ? ` · ${o.closeReason}` : ''}
                {o.realizedPnlUsd !== undefined ? (
                  <span className={o.realizedPnlUsd >= 0 ? 'text-[#73DEA4]' : 'text-[#F28881]'}>
                    {' '}{o.realizedPnlUsd >= 0 ? '+' : ''}{o.realizedPnlUsd}
                  </span>
                ) : (
                  o.error ? ` · ${o.error.slice(0, 60)}` : ''
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
