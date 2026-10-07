'use client';

import { useEffect, useRef, useState } from 'react';

interface StreamEvent {
  vaultId: number;
  kind: 'SKIP' | 'ENTER' | 'EXIT';
  token: string;
  trader: string;
  note: string;
  at: number;
}

type Filter = 'ALL' | StreamEvent['kind'];
const FILTERS: Filter[] = ['ALL', 'ENTER', 'EXIT', 'SKIP'];

const KIND_STYLE: Record<StreamEvent['kind'], { fg: string; bg: string }> = {
  ENTER: { fg: 'var(--ep-aqua-100, #BBF6EE)', bg: '#004B45' },
  EXIT: { fg: 'var(--ep-violet-100, #D2CEFD)', bg: '#2B2741' },
  SKIP: { fg: 'var(--ep-muted, #9397AB)', bg: '#2E313F' },
};

function fmtTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Pool terminal log: SSE replay + live ticks, monospace console, auto-scroll.
 * Paywall: locked viewers (holding < 0.5 SOL) see the lock prompt only —
 * live signal flow never leaks tokens, traders or sizes. */
export default function SignalStream({ vaultId, locked }: { vaultId: number; locked: boolean }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [live, setLive] = useState(true);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    const src = new EventSource(`/api/vaults/${vaultId}/signals/stream`);
    src.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as { type: string; events?: StreamEvent[]; event?: StreamEvent };
        if (payload.type === 'REPLAY' && Array.isArray(payload.events)) {
          setEvents(payload.events.slice(-100));
          setLive(true);
        } else if (payload.type === 'SIGNAL' && payload.event) {
          const e = payload.event;
          setEvents((prev) => [...prev.slice(-199), e]);
          setLive(true);
        }
      } catch {
        // malformed frame — ignore, stream continues
      }
    };
    src.onerror = () => setLive(false);
    return () => src.close();
  }, [vaultId]);

  useEffect(() => {
    if (!paused && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [events, paused]);

  const shown = filter === 'ALL' ? events : events.filter((e) => e.kind === filter);

  if (locked) {
    return (
      <section className="rounded-2xl p-4 text-center" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
        <h2 className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--ep-faint, #75798C)' }}>TERMINAL LOG</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--ep-text, #E9E9ED)' }}>
          Live signals unlock with a 0.5 SOL deposit.
        </p>
        <p className="text-[11px] mt-1" style={{ color: 'var(--ep-muted, #9397AB)' }}>
          Deposit to see every detect, entry and exit as it happens.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl p-4" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-sm font-medium">
          Terminal log{' '}
          <span className="font-mono text-[10px]" style={{ color: live ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
            {live ? '● LIVE' : '○ OFFLINE'}
          </span>
        </h2>
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={filter === f ? { background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' } : { color: 'var(--ep-muted, #9397AB)' }}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setPaused((p) => !p)}
            className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
        </div>
      </div>
      <div
        ref={boxRef}
        className="mt-2 rounded-lg px-3 py-2 overflow-y-auto font-mono text-[11px] leading-5"
        style={{ background: 'var(--ep-surface-sunk, #1A1C2A)', height: 190 }}
      >
        {shown.length === 0 && (
          <div style={{ color: 'var(--ep-faint, #75798C)' }}>
            {events.length === 0 ? 'connecting…' : 'no lines match this filter.'}
          </div>
        )}
        {shown.map((e, i) => {
          const c = KIND_STYLE[e.kind] ?? KIND_STYLE.SKIP;
          return (
            <div key={`${e.at}-${i}`} className="whitespace-nowrap">
              <span style={{ color: 'var(--ep-faint, #75798C)' }}>{fmtTime(e.at)}</span>{' '}
              <span className="font-bold px-1.5 rounded" style={{ background: c.bg, color: c.fg }}>{e.kind}</span>{' '}
              <span className="font-bold">{e.token}</span>{' '}
              <span style={{ color: 'var(--ep-muted, #9397AB)' }}>@{e.trader}</span>{' '}
              <span style={{ color: 'var(--ep-text-3, #B2B6CA)' }}>{e.note}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
