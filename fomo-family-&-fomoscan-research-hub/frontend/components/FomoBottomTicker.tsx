'use client';

import { useMarketTicker } from '../hooks/useMarketTicker';

interface Props {
  liveConnected: boolean;
}

function formatPrice(v: number | null): string {
  if (v === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function FomoBottomTicker({ liveConnected }: Props) {
  const { ticks, stale } = useMarketTicker(60000);

  return (
    <footer className="h-8 shrink-0 w-full bg-[#161826] border-t border-[#3F424D] px-4 flex items-center justify-between text-xs select-none gap-3 overflow-hidden">
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar whitespace-nowrap font-mono">
        {ticks.map((t) => {
          const chg = t.changePct24h;
          const up = (chg ?? 0) >= 0;
          return (
            <span key={t.label} className="flex items-center gap-1.5" title={`${t.label}/USD · CoinGecko spot`}>
              <span className="text-[#9397AB]">{t.glyph}</span>
              <span className="text-[#E9E9ED] font-medium">{formatPrice(t.priceUsd)}</span>
              <span className={up ? 'text-[#73DEA4]' : 'text-[#F28881]'}>
                {chg === null ? '—' : `${up ? '▲' : '▾'} ${Math.abs(chg).toFixed(2)}%`}
              </span>
            </span>
          );
        })}
        {stale && <span className="text-[#595D6C] text-[10px]">cached</span>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`flex items-center gap-1.5 font-mono text-[11px] font-medium ${liveConnected ? 'text-[#49E6D7]' : 'text-[#75798C]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${liveConnected ? 'bg-[#49E6D7] animate-pulse' : 'bg-[#595D6C]'}`} />
          {liveConnected ? '● Stable' : '● Syncing'}
        </span>
        {(['Privacy', 'Terms', 'Help / Spec'] as const).map((l) => (
          <button key={l} className="hidden sm:inline text-[11px] text-[#75798C] hover:text-[#E9E9ED] cursor-pointer transition-colors">
            {l}
          </button>
        ))}
      </div>
    </footer>
  );
}
