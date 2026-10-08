'use client';

import type { VaultOrderJourney } from '../lib/api';

const PHASE_DOT: Record<'done' | 'active' | 'skipped' | 'waiting', string> = {
  done: '#73DEA4',
  active: '#49E6D7',
  skipped: '#F0BE67',
  waiting: '#595D6C',
};

function hhmmss(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** One signal's Detect → Qualify → Enter → Manage → Exit evidence rail. */
export function JourneyRail({ j }: { j: VaultOrderJourney }) {
  const failed = j.status === 'FAILED';
  const closed = j.closedAt !== null;
  const entered = !failed && (j.status === 'CONFIRMED' || j.status === 'SENT' || j.status === 'QUATED');
  const phases: { label: string; state: 'done' | 'active' | 'skipped' | 'waiting'; detail: string }[] = [
    {
      label: 'Detect',
      state: 'done',
      detail: `${j.token} · master ${(j.masterTxHash ?? '').slice(0, 8) || '—'}… · @${j.trader} · ${hhmmss(j.createdAt)}`,
    },
    failed
      ? { label: 'Qualify', state: 'skipped', detail: `blocked · ${(j.qualify?.reasons ?? []).join('; ') || j.error || 'rejected'}` }
      : j.qualify
        ? { label: 'Qualify', state: 'done', detail: `pass${j.qualify.score !== null ? ` · score ${j.qualify.score}` : ''}${j.qualify.reasons.length > 0 ? ` · ${j.qualify.reasons.join('; ')}` : ''}` }
        : { label: 'Qualify', state: 'waiting', detail: 'no verdict recorded' },
    failed
      ? { label: 'Enter', state: 'skipped', detail: 'never entered' }
      : entered
        ? {
          label: 'Enter',
          state: 'done',
          detail: `$${j.entry.amountUsd} @ $${j.entry.priceUsd ?? '—'} · TP1 +${j.entry.tp1Pct ?? '—'}% / stop ${j.entry.stopPct ?? '—'}%${j.entry.venue ? ` · ${j.entry.venue}` : ''}`,
        }
        : { label: 'Enter', state: 'active', detail: `${j.status} · awaiting fill` },
    failed
      ? { label: 'Manage', state: 'waiting', detail: '—' }
      : j.legs.length > 0
        ? {
          label: 'Manage',
          state: closed ? 'done' : 'active',
          detail: j.legs.map((l) => `${l.leg} ${(l.fraction * 100).toFixed(0)}%${l.realizedPnlUsd !== null ? ` (${l.realizedPnlUsd >= 0 ? '+' : ''}$${l.realizedPnlUsd})` : ''}`).join(' · '),
        }
        : closed
          ? { label: 'Manage', state: 'done', detail: 'full close · no partial legs' }
          : { label: 'Manage', state: 'active', detail: 'holding · no exits yet' },
    failed
      ? { label: 'Exit', state: 'waiting', detail: '—' }
      : closed
        ? {
          label: 'Exit',
          state: 'done',
          detail: `${j.closeReason ?? 'CLOSED'} · ${(j.realizedPnlUsd ?? 0) >= 0 ? '+' : ''}$${j.realizedPnlUsd ?? 0} · ${hhmmss(j.closedAt)}`,
        }
        : { label: 'Exit', state: 'active', detail: 'open' },
  ];
  return (
    <div className="rounded-lg bg-[#161826] border border-[#3F424D] px-2.5 py-2 space-y-1">
      <div className="text-[11px] font-mono text-[#A7AABF] flex justify-between gap-2 flex-wrap">
        <span className="break-all">#{j.id} · {j.token} via @{j.trader}</span>
        <span className={failed ? 'text-[#F0BE67]' : closed ? 'text-[#A7AABF]' : 'text-[#49E6D7]'}>
          {failed ? 'SKIPPED' : closed ? 'CLOSED' : j.status}
        </span>
      </div>
      {phases.map((p) => (
        <div key={p.label} className="flex items-start gap-2 text-[11px]">
          <span className="mt-1 shrink-0 rounded-full" style={{ width: 7, height: 7, background: PHASE_DOT[p.state], boxShadow: p.state === 'active' ? '0 0 6px #49E6D7' : undefined }} />
          <span className="font-mono text-[#75798C] w-[52px] shrink-0">{p.label}</span>
          <span className="font-mono text-[#CFD3E5] break-all">{p.detail}</span>
        </div>
      ))}
      {j.error && (
        <div className="text-[11px] font-mono text-[#F0BE67] break-all">{j.error}</div>
      )}
    </div>
  );
}
