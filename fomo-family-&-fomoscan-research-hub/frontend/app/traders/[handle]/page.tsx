'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowSquareOut, SealCheck, XLogo } from '@phosphor-icons/react';
import { getTraderProfile, type TraderProfile } from '../../../lib/api';
import { SiteFooter, SiteHeader } from '../../../components/SiteHeader';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
}

export default function TraderProfilePage() {
  const params = useParams();
  const handle = decodeURIComponent(String(params?.handle ?? '')).replace(/^@/, '');
  const [data, setData] = useState<TraderProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    if (!handle) {
      setError('Trader handle is missing.');
      return;
    }
    void getTraderProfile(handle)
      .then((r) => {
        if (live) setData(r.data);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [handle]);

  return (
    <>
      <SiteHeader active="pools" />
      <main className="mx-auto w-full" style={{ maxWidth: 1080, padding: '28px clamp(16px,4vw,40px) 72px' }}>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
          <ArrowLeft size={14} /> All pools
        </Link>

        {error && (
          <div className="mt-6 rounded-2xl p-6" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h1 className="font-display text-2xl font-medium">Trader not found</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ep-muted, #9397AB)' }}>{error}</p>
          </div>
        )}

        {!data && !error && (
          <div className="mt-6 rounded-2xl p-6" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <span className="text-sm" style={{ color: 'var(--ep-muted, #9397AB)' }}>Loading trader…</span>
          </div>
        )}

        {data && (
          <div className="mt-5 flex flex-col gap-4">
            <section className="rounded-2xl p-6" style={{ background: 'radial-gradient(70% 120% at 85% 0%, rgba(73,230,215,0.10), rgba(73,230,215,0) 55%), var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
              <div className="flex items-start gap-4 flex-wrap">
                <div className="grid place-items-center shrink-0 font-display font-medium" style={{ width: 72, height: 72, borderRadius: 18, background: '#2B2741', color: '#D2CEFD', fontSize: 28, overflow: 'hidden' }}>
                  {data.avatarUrl ? (
                    <img src={data.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (data.name || data.handle || '?').slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="font-display font-medium" style={{ fontSize: 'clamp(24px,3vw,34px)' }}>{data.name || data.handle}</h1>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-full" style={data.verified ? { background: 'rgba(73,230,215,0.10)', color: 'var(--ep-aqua, #49E6D7)', boxShadow: 'inset 0 0 0 1px rgba(73,230,215,0.45)' } : { background: 'rgba(147,151,171,0.10)', color: 'var(--ep-muted, #9397AB)', boxShadow: 'inset 0 0 0 1px rgba(147,151,171,0.35)' }}>
                      {data.verified ? <SealCheck size={12} weight="fill" /> : null}
                      {data.verified ? 'FomoScan verified' : 'FomoScan snapshot'}
                    </span>
                  </div>
                  <span className="font-mono text-sm" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>@{data.handle}</span>
                  {data.bio && <p className="text-sm mt-1" style={{ color: 'var(--ep-text-3, #B2B6CA)', maxWidth: 640 }}>{data.bio}</p>}
                  <div className="flex gap-2 flex-wrap mt-3">
                    <a href={data.fomoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
                      Open on Fomo <ArrowSquareOut size={13} />
                    </a>
                    <a href={data.fomoScanLeaderboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg" style={{ border: '1px solid var(--ep-aqua, #49E6D7)', color: 'var(--ep-aqua, #49E6D7)' }}>
                      FomoScan leaderboard <ArrowSquareOut size={13} />
                    </a>
                    {data.twitter && (
                      <a href={data.twitter} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                        <XLogo size={13} /> X profile
                      </a>
                    )}
                  </div>
                  <span className="text-[11px] mt-2" style={{ color: 'var(--ep-faint, #75798C)' }}>
                    Fomo profile links require a Fomo login. FomoScan leaderboard is public.
                  </span>
                </div>
              </div>
            </section>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,220px),1fr))', gap: 14 }}>
              {[
                ['Fomo PnL', fmtUsd(data.pnlUsd), data.pnlUsd >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'],
                ['Win rate', data.winRate > 0 ? `${data.winRate.toFixed(0)}%` : '—', 'var(--ep-text, #E9E9ED)'],
                ['Trades', data.trades > 0 ? String(data.trades) : '—', 'var(--ep-text, #E9E9ED)'],
                ['All-time rank', data.rank ? `#${data.rank}` : '—', 'var(--ep-text, #E9E9ED)'],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                  <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>{label}</div>
                  <div className="font-mono font-medium mt-2" style={{ fontSize: 24, color }}>{value}</div>
                </div>
              ))}
            </div>

            <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
              <div className="flex justify-between items-baseline gap-2 flex-wrap">
                <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Leaderboard ranks</span>
                <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>24h · 7d · 30d</span>
              </div>
              <div className="flex gap-8 mt-3 font-mono text-sm">
                <span>#{data.ranks.h24 ?? '—'}</span>
                <span>#{data.ranks.d7 ?? '—'}</span>
                <span>#{data.ranks.d30 ?? '—'}</span>
              </div>
              {data.updatedAt && <span className="block mt-3 text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>Fomo snapshot {new Date(data.updatedAt).toLocaleString('en-GB')}</span>}
            </section>

            <section className="rounded-2xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
              <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Active in Edgepool pools</span>
              <div className="flex flex-col mt-2">
                {data.pools.map((p) => (
                  <Link key={p.id} href={`/pools/${p.id}`} className="flex items-center justify-between text-sm py-2.5" style={{ borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                    <span>{p.name}</span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>{p.kind} ↗</span>
                  </Link>
                ))}
                {data.pools.length === 0 && <span className="text-sm py-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>Not in an active pool roster.</span>}
              </div>
            </section>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
