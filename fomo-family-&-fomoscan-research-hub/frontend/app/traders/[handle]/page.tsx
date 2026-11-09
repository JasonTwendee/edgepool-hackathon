'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowUpRight,
  ChartLine,
  CopySimple,
  Drop,
  SealCheck,
  Target,
  TrendUp,
  Trophy,
  XLogo,
} from '@phosphor-icons/react';
import { getTraderProfile, listPools, type PoolSummary, type TraderProfile } from '../../../lib/api';
import { SiteFooter, SiteHeader } from '../../../components/SiteHeader';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
}

function fmtSol(v: number): string {
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} SOL`;
}

function rankColor(rank: number | null): string {
  if (rank === 1) return '#F0BE67';
  if (rank === 2) return '#C9D1E0';
  if (rank === 3) return '#D08A5A';
  return 'var(--ep-aqua, #49E6D7)';
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl p-5" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>{label}</span>
        <span className="grid place-items-center" style={{ width: 30, height: 30, borderRadius: 10, background: 'rgba(73,230,215,0.08)', color: 'var(--ep-aqua, #49E6D7)' }}>{icon}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono font-medium" style={{ fontSize: 28, letterSpacing: '-0.03em', color }}>{value}</span>
        <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{sub}</span>
      </div>
    </div>
  );
}

function RankPill({ label, rank }: { label: string; rank: number | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl px-4 py-3" style={{ background: '#161826', boxShadow: 'inset 0 0 0 1px var(--ep-border, #2E313F)' }}>
      <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>{label}</span>
      <span className="font-mono font-medium" style={{ fontSize: 22, color: rankColor(rank) }}>#{rank ?? '—'}</span>
    </div>
  );
}

export default function TraderProfilePage() {
  const params = useParams();
  const handle = decodeURIComponent(String(params?.handle ?? '')).replace(/^@/, '');
  const [data, setData] = useState<TraderProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<Record<number, PoolSummary>>({});
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

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

  useEffect(() => {
    let live = true;
    void listPools()
      .then((r) => {
        if (!live) return;
        setPackages(Object.fromEntries(r.data.map((p) => [p.id, p])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(label);
      setTimeout(() => setCopyMsg(null), 2200);
    } catch {
      setCopyMsg('Copy failed');
    }
  }

  const winRate = data ? Math.max(0, Math.min(100, data.winRate)) : 0;
  const rankTone = data ? rankColor(data.rank) : 'var(--ep-aqua, #49E6D7)';
  const poolCount = data?.pools.length ?? 0;

  return (
    <>
      <SiteHeader active="pools" />
      <main className="mx-auto w-full" style={{ maxWidth: 1180, padding: '28px clamp(16px,4vw,40px) 80px' }}>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
          <ArrowLeft size={14} /> All pools
        </Link>

        {error && (
          <div className="mt-6 rounded-3xl p-6" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <h1 className="font-display text-2xl font-medium">Trader not found</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ep-muted, #9397AB)' }}>{error}</p>
          </div>
        )}

        {!data && !error && (
          <div className="mt-6 rounded-3xl p-6" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
            <span className="text-sm" style={{ color: 'var(--ep-muted, #9397AB)' }}>Loading trader profile…</span>
          </div>
        )}

        {data && (
          <div className="mt-5 flex flex-col gap-4">
            {/* Identity hero */}
            <section className="relative overflow-hidden rounded-[28px] p-6 md:p-8" style={{ background: 'radial-gradient(75% 150% at 88% -10%, rgba(73,230,215,0.16), rgba(73,230,215,0) 52%), radial-gradient(60% 120% at 10% 120%, rgba(145,132,217,0.14), rgba(145,132,217,0) 55%), var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
              <img src="/brand/motif-flow.svg" alt="" aria-hidden="true"
                style={{ position: 'absolute', right: -70, top: 28, width: 620, opacity: 0.18, pointerEvents: 'none' }} />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-4 md:gap-5 min-w-0 flex-1">
                  <div className="grid place-items-center shrink-0 font-display font-medium" style={{ width: 92, height: 92, borderRadius: 24, background: 'linear-gradient(145deg, #2B2741, #161826)', color: '#D2CEFD', fontSize: 36, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(73,230,215,0.35), 0 18px 40px rgba(0,0,0,0.28)' }}>
                    {data.avatarUrl ? (
                      <img src={data.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      (data.name || data.handle || '?').slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="font-display font-medium" style={{ fontSize: 'clamp(30px,4vw,46px)', letterSpacing: '-0.04em', lineHeight: 1.05 }}>
                        {data.name || data.handle}
                      </h1>
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 rounded-full" style={data.verified ? { background: 'rgba(73,230,215,0.10)', color: 'var(--ep-aqua, #49E6D7)', boxShadow: 'inset 0 0 0 1px rgba(73,230,215,0.45)' } : { background: 'rgba(147,151,171,0.10)', color: 'var(--ep-muted, #9397AB)', boxShadow: 'inset 0 0 0 1px rgba(147,151,171,0.35)' }}>
                        {data.verified ? <SealCheck size={12} weight="fill" /> : null}
                        {data.verified ? 'FomoScan verified' : 'FomoScan snapshot'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>@{data.handle}</span>
                      {data.rank !== null && (
                        <span className="font-mono text-[10px] px-2 py-1 rounded-full" style={{ color: rankTone, background: `${rankTone}16`, boxShadow: `inset 0 0 0 1px ${rankTone}55` }}>
                          #{data.rank} all-time
                        </span>
                      )}
                    </div>
                    {data.bio && <p className="text-sm mt-1" style={{ color: 'var(--ep-text-3, #B2B6CA)', maxWidth: 620 }}>{data.bio}</p>}
                    <div className="flex gap-2 flex-wrap mt-3">
                      <a href={data.fomoScanLeaderboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--ep-aqua, #49E6D7)', color: '#0D0F18' }}>
                        FomoScan leaderboard <ArrowSquareOut size={13} />
                      </a>
                      <button onClick={() => void copy(window.location.href, 'Profile link copied')} className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2.5 rounded-xl" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-text, #E9E9ED)' }}>
                        <CopySimple size={13} /> Copy profile link
                      </button>
                      {data.twitter && (
                        <a href={data.twitter} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2.5 rounded-xl" style={{ border: '1px solid var(--ep-border-strong, #3F424D)', color: 'var(--ep-muted, #9397AB)' }}>
                          <XLogo size={13} /> X profile
                        </a>
                      )}
                    </div>
                    <span className="text-[11px] mt-1" style={{ color: 'var(--ep-faint, #75798C)' }}>
                      Public Edgepool profile · Fomo profile pages require a Fomo login.
                    </span>
                    {copyMsg && <span className="text-[11px] font-medium" style={{ color: 'var(--ep-profit, #73DEA4)' }}>{copyMsg}</span>}
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center shrink-0 rounded-3xl self-center lg:self-auto" style={{ width: 156, height: 156, background: `radial-gradient(circle at 50% 20%, ${rankTone}22, rgba(22,24,38,0.98) 68%)`, boxShadow: `inset 0 0 0 1px ${rankTone}45, 0 18px 50px rgba(0,0,0,0.22)` }}>
                  <span className="font-mono text-[9px] tracking-[0.18em] uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>All-time rank</span>
                  <span className="font-display font-medium" style={{ fontSize: 42, lineHeight: 1.05, color: rankTone }}>{data.rank !== null ? `#${data.rank}` : '—'}</span>
                  <span className="font-mono text-[9px] tracking-[0.14em] uppercase" style={{ color: 'var(--ep-muted, #9397AB)' }}>FomoScan</span>
                </div>
              </div>
            </section>

            {/* Stats */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,190px),1fr))', gap: 14 }}>
              <StatCard icon={<TrendUp size={16} />} label="Fomo PnL" value={fmtUsd(data.pnlUsd)} sub="Snapshot from FomoScan" color={data.pnlUsd >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)'} />
              <StatCard icon={<Target size={16} />} label="Win rate" value={winRate > 0 ? `${winRate.toFixed(0)}%` : '—'} sub="Closed trades" color="var(--ep-text, #E9E9ED)" />
              <StatCard icon={<ChartLine size={16} />} label="Trades" value={data.trades > 0 ? data.trades.toLocaleString('en-US') : '—'} sub="Tracked by FomoScan" color="var(--ep-text, #E9E9ED)" />
              <StatCard icon={<Trophy size={16} />} label="Active pools" value={String(poolCount)} sub="Edgepool roster" color="var(--ep-text, #E9E9ED)" />
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,320px),1fr))', gap: 14 }}>
              {/* Performance */}
              <section className="rounded-3xl p-6" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                <div className="flex justify-between items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Performance snapshot</span>
                  <span className="text-[11px]" style={{ color: 'var(--ep-faint, #75798C)' }}>FomoScan</span>
                </div>
                <div className="flex flex-col md:flex-row md:items-center gap-6 mt-5">
                  <div className="grid place-items-center shrink-0" style={{ width: 128, height: 128, borderRadius: '50%', background: `conic-gradient(var(--ep-aqua, #49E6D7) ${winRate * 3.6}deg, #2E313F 0)`, padding: 8 }}>
                    <div className="grid place-items-center w-full h-full rounded-full" style={{ background: '#161826' }}>
                      <span className="font-mono font-medium" style={{ fontSize: 26 }}>{winRate > 0 ? `${winRate.toFixed(0)}%` : '—'}</span>
                      <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)', marginTop: -4 }}>win rate</span>
                    </div>
                  </div>
                  <div className="w-full md:flex-1 min-w-0 grid gap-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                    <RankPill label="24h" rank={data.ranks.h24} />
                    <RankPill label="7d" rank={data.ranks.d7} />
                    <RankPill label="30d" rank={data.ranks.d30} />
                  </div>
                </div>
                <div className="flex justify-between items-center gap-2 flex-wrap mt-5 pt-4" style={{ borderTop: '1px solid var(--ep-border, #2E313F)' }}>
                  <span className="text-[11px]" style={{ color: 'var(--ep-muted, #9397AB)' }}>
                    {data.updatedAt ? `Last snapshot ${new Date(data.updatedAt).toLocaleString('en-GB')}` : 'FomoScan snapshot'}
                  </span>
                  <button onClick={() => void copy(data.fomoUrl, 'Fomo link copied')} className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--ep-aqua, #49E6D7)' }}>
                    <CopySimple size={12} /> Copy Fomo link
                  </button>
                </div>
              </section>

              {/* Pools */}
              <section className="rounded-3xl p-6" style={{ background: 'var(--ep-surface, #1D1F2C)', boxShadow: '0 0 0 1px var(--ep-border, #2E313F)' }}>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--ep-faint, #75798C)' }}>Active in Edgepool</span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--ep-faint, #75798C)' }}>{poolCount} pools</span>
                </div>
                <div className="flex flex-col gap-2.5 mt-4">
                  {data.pools.map((p) => {
                    const ps = packages[p.id];
                    const pct = ps?.pnl.week.pct;
                    return (
                      <Link key={p.id} href={`/pools/${p.id}`} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition-colors" style={{ background: '#161826', boxShadow: 'inset 0 0 0 1px var(--ep-border, #2E313F)' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="grid place-items-center shrink-0" style={{ width: 34, height: 34, borderRadius: 11, background: p.kind === 'partner' ? 'rgba(145,132,217,0.14)' : 'rgba(73,230,215,0.10)', color: p.kind === 'partner' ? 'var(--ep-violet-100, #D2CEFD)' : 'var(--ep-aqua, #49E6D7)' }}>
                            <Drop size={16} />
                          </span>
                          <div className="min-w-0 flex flex-col gap-0.5">
                            <span className="text-sm font-medium truncate">{p.name}</span>
                            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: p.kind === 'partner' ? 'var(--ep-violet-100, #D2CEFD)' : 'var(--ep-aqua, #49E6D7)' }}>{p.kind}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-mono text-xs">{ps ? fmtSol(ps.navSol) : '—'}</span>
                            <span className="font-mono text-[10px]" style={{ color: pct === undefined ? 'var(--ep-faint, #75798C)' : pct >= 0 ? 'var(--ep-profit, #73DEA4)' : 'var(--ep-neg, #F28881)' }}>
                              {pct === undefined ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% · 7d`}
                            </span>
                          </div>
                          <ArrowUpRight size={15} style={{ color: 'var(--ep-aqua, #49E6D7)' }} />
                        </div>
                      </Link>
                    );
                  })}
                  {data.pools.length === 0 && (
                    <span className="text-sm py-2" style={{ color: 'var(--ep-muted, #9397AB)' }}>Not in an active pool roster.</span>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
