import { ArrowSquareOut } from '@phosphor-icons/react';
import type { OnChainTransactionEvent } from '../types/onchain';
import { formatDateTimeFull, formatDateTimeShort, formatUsd, shortSignature, timeAgo } from '../lib/format';

export type SwapsTab = 'all' | 'buys' | 'sells';

function ActionBadge({ action }: { action: OnChainTransactionEvent['action'] }) {
  const cls =
    action === 'BUY'
      ? 'bg-[#73DEA4]/10 text-[#49E6D7] border-[#73DEA4]/30'
      : action === 'SELL'
        ? 'bg-[#F28881]/10 text-[#F28881] border-[#F28881]/30'
        : 'bg-[#9397AB]/10 text-[#9397AB] border-[#9397AB]/30';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${cls}`}>
      {action === 'BUY' ? 'Buy' : action === 'SELL' ? 'Sell' : action}
    </span>
  );
}

interface Props {
  swaps: OnChainTransactionEvent[];
  total: number;
  page: number;
  totalPages: number;
  tab: SwapsTab;
  loading: boolean;
  showZero: boolean;
  onToggleShowZero: () => void;
  onTabChange: (tab: SwapsTab) => void;
  onPageChange: (page: number) => void;
}

const TABS: { key: SwapsTab; label: string }[] = [
  { key: 'all', label: `All swaps` },
  { key: 'buys', label: 'Buys' },
  { key: 'sells', label: 'Sells' },
];

export function SwapsTable({ swaps, total, page, totalPages, tab, loading, showZero, onToggleShowZero, onTabChange, onPageChange }: Props) {
  return (
    <section className="rounded-[14px] border border-[#3F424D] bg-[#232532] overflow-hidden">
      <div className="flex items-center gap-4 px-4 pt-3 border-b border-[#3F424D]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`text-xs font-bold pb-2.5 border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'text-[#E9E9ED] border-[#49E6D7]' : 'text-[#75798C] border-transparent hover:text-[#E9E9ED]'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[#75798C] pb-2.5">
          {loading ? 'loading…' : `${total} txs`}
        </span>
        <button
          onClick={onToggleShowZero}
          title={showZero ? 'Hide dust trades without USD value' : 'Show dust trades without USD value'}
          className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors mb-2 ${
            showZero
              ? 'bg-[rgba(73,230,215,0.12)] text-[#E9E9ED] border-[#49E6D7]/40'
              : 'text-[#75798C] border-[#3F424D] hover:text-[#E9E9ED]'
          }`}
        >
          {showZero ? '$0 shown' : 'Hide $0'}
        </button>
      </div>

      <div className="hidden sm:grid grid-cols-[1fr_70px_110px_110px_104px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#75798C]">
        <span>Token</span>
        <span>Action</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Venue</span>
        <span className="text-right">Time · Scan</span>
      </div>

      <ul className="divide-y divide-[#3F424D]/60 min-h-[200px]">
        {swaps.map((s) => (
          <li
            key={s.signature}
            className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_70px_110px_110px_104px] gap-2 items-center px-4 py-2.5 bg-[#161826]/40 hover:bg-[#232532]/60 transition-colors"
          >
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#E9E9ED] truncate">{s.symbol}</div>
              <a
                href={`https://solscan.io/tx/${s.signature}`}
                target="_blank"
                rel="noreferrer"
                title={`${s.signature} · ${formatDateTimeFull(s.blockTime)}`}
                className="text-[10px] font-mono text-[#75798C] hover:text-[#81EADE] flex items-center gap-1"
              >
                {shortSignature(s.signature)}
                <ArrowSquareOut size={10} className="" />
                <span className="sm:hidden text-[#9397AB]">
                  · {timeAgo(s.blockTime)} · {formatDateTimeShort(s.blockTime)}
                </span>
              </a>
            </div>
            <div className="sm:contents">
              <div>
                <ActionBadge action={s.action} />
              </div>
              <div className="text-right">
                {s.amountUsd !== undefined ? (
                  <>
                    <div className={`text-xs font-bold ${s.action === 'SELL' ? 'text-[#F28881]' : 'text-[#73DEA4]'}`}>
                      {formatUsd(s.amountUsd)}
                    </div>
                    {s.amountToken !== undefined && (
                      <div className="text-[10px] text-[#75798C] font-mono">
                        {s.amountToken.toLocaleString('en-US', { maximumFractionDigits: 2 })} {s.symbol}
                      </div>
                    )}
                  </>
                ) : s.amountToken !== undefined ? (
                  <div className={`text-xs font-bold ${s.action === 'SELL' ? 'text-[#F28881]' : 'text-[#73DEA4]'}`}>
                    {s.amountToken.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
                    <span className="text-[#75798C] font-semibold">{s.symbol}</span>
                  </div>
                ) : (
                  <span className="text-xs text-[#75798C]">—</span>
                )}
              </div>
              <div className="hidden sm:block text-[11px] text-[#9397AB] text-right truncate" title={s.dexVenue}>
                {s.dexVenue.replace(' CLOB', '').replace(' Meta-DEX', '').replace(' AMM', '').replace(' Whirlpool', '').replace(' Aggregator', '')}
              </div>
              <div className="hidden sm:block text-right" title={formatDateTimeFull(s.blockTime)}>
                <a
                  href={`https://solscan.io/tx/${s.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#E9E9ED] hover:text-[#81EADE]"
                >
                  {timeAgo(s.blockTime)}
                  <ArrowSquareOut size={12} className="" />
                </a>
                <div className="text-[10px] text-[#75798C] font-mono">{formatDateTimeShort(s.blockTime)}</div>
              </div>
            </div>
          </li>
        ))}
        {swaps.length === 0 && !loading && (
          <li className="px-4 py-8 text-center text-xs text-[#75798C]">No swaps in this view yet</li>
        )}
      </ul>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#3F424D]">
        <span className="text-[11px] text-[#75798C]">
          Page {totalPages === 0 ? 0 : page} of {totalPages}
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#232532] hover:bg-[rgba(73,230,215,0.12)] disabled:opacity-40 text-[#E9E9ED] transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#232532] hover:bg-[rgba(73,230,215,0.12)] disabled:opacity-40 text-[#E9E9ED] transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </section>
  );
}
