'use client';

/**
 * Static demo/sandbox banner (fund spec §§11–13): the audience must always see
 * that this dashboard shows SIMULATED execution on paper vaults — never real funds.
 */
export function DemoBanner() {
  return (
    <div className="shrink-0 w-full bg-[rgba(73,230,215,0.07)] border-b border-[#49E6D7]/25 px-4 py-1.5 flex items-center justify-center gap-2">
      <span className="text-[10px] font-bold tracking-[0.18em] text-[#49E6D7] border border-[#49E6D7]/40 rounded px-1.5 py-px">
        DEMO
      </span>
      <span className="text-[11px] text-[#A7AABF]">
        SIMULATED execution · paper vaults · real trader signals — no real funds move
      </span>
    </div>
  );
}
