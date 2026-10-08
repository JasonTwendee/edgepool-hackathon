'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from '@phosphor-icons/react';
import {
  assignVaultTrader,
  createBot,
  createVault,
  listAudit,
  listBots,
  listUsers,
  listVaults,
  partnerMe,
  partnerPauseTrader,
  partnerPoolTraders,
  partnerRemoveTrader,
  partnerUpdateSettings,
  removeVaultTrader,
  resetDemo,
  runAutoFireTick,
  runDemoScenario,
  setBotMode,
  setUserRole,
  setVaultPolicy,
  vaultOrders,
  type VaultOrderJourney,
} from '../lib/api';
import type {
  AuditLog,
  AutoFireTickResult,
  Bot,
  FundSession,
  FundUser,
  VaultWithTraders,
} from '../types/fund';
import type { DemoScenarioResult } from '../lib/api';

type Tab = 'users' | 'audit' | 'vaults' | 'pools' | 'bots' | 'engine' | 'demo';

const inputCls =
  'text-xs bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]';
const btnPrimary =
  'text-xs font-bold text-[#161826] bg-[#49E6D7] rounded-lg px-2.5 py-1.5 disabled:opacity-50';
const btnGhost =
  'text-xs text-[#A7AABF] hover:text-[#E9E9ED] border border-[#3F424D] rounded-lg px-2.5 py-1.5 disabled:opacity-50';

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
function JourneyRail({ j }: { j: VaultOrderJourney }) {
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

export function AdminPanel({ session }: { session: FundSession | null }) {
  // Bot console first: admin work here is config + enable/disable bots.
  const [tab, setTab] = useState<Tab>('bots');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<FundUser[]>([]);
  const [roleWallet, setRoleWallet] = useState('');
  const [role, setRole] = useState('KOL');
  const [roleReason, setRoleReason] = useState('');

  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [auditAction, setAuditAction] = useState('');

  const [vaults, setVaults] = useState<VaultWithTraders[]>([]);
  const [vaultName, setVaultName] = useState('');
  const [trVault, setTrVault] = useState('');
  const [trWallet, setTrWallet] = useState('');
  const [polVault, setPolVault] = useState('');
  const [polReserve, setPolReserve] = useState('');
  const [polFee, setPolFee] = useState('');
  const [polLock, setPolLock] = useState('');

  const [bots, setBots] = useState<Bot[]>([]);
  const [botName, setBotName] = useState('');
  const [botVault, setBotVault] = useState('');

  const [tickMin, setTickMin] = useState('15');
  const [tickLimit, setTickLimit] = useState('10');
  const [tickResult, setTickResult] = useState<AutoFireTickResult | null>(null);
  const [demoResult, setDemoResult] = useState<DemoScenarioResult | null>(null);

  // Signal journeys: per-order Detect → Qualify → Enter → Manage → Exit rail.
  const [journeyVault, setJourneyVault] = useState('');
  const [journeys, setJourneys] = useState<VaultOrderJourney[]>([]);
  const [journeyBusy, setJourneyBusy] = useState(false);

  async function loadJourneys(vaultId: number) {
    if (!token || journeyBusy) return;
    setJourneyBusy(true);
    try {
      const r = await vaultOrders(token, vaultId);
      setJourneys(r.data);
      setJourneyVault(String(vaultId));
      setMsg(`Loaded ${r.total} signal journeys for pool #${vaultId}.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setJourneyBusy(false);
    }
  }

  // Partner-pool ops (moved out of /trader KOL portal — ADMIN-only home).
  type PoolMeData = { pools: { id: number; name: string; kind: string; status: string; listing: string; navSol: number }[]; basket: { wallet: string; handle: string; inBasket: boolean; ranks: { h24: number | null; d7: number | null; d30: number | null } }[] };
  const [poolMe, setPoolMe] = useState<PoolMeData | null>(null);
  const [poolSel, setPoolSel] = useState<number | null>(null);
  const [poolTraders, setPoolTraders] = useState<{ wallet: string; handle: string; isActive: boolean; weightBps: number; signals7d: number; profitUsd: number; feeSol: number }[]>([]);
  const [poolName, setPoolName] = useState('');
  const [poolSlots, setPoolSlots] = useState('');
  const [poolRules, setPoolRules] = useState<Record<string, string>>({});

  const token: string = session?.token ?? '';
  // UI guard only — real authorization stays in BE guards (D-F3).
  const isAdmin = session?.user.role === 'ADMIN';

  async function run<T>(fn: () => Promise<T>, ok: (v: T) => void, label: string) {
    if (busy || !token) return;
    setBusy(true);
    setMsg(null);
    try {
      ok(await fn());
      setMsg(`${label} — ok.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const refreshUsers = useCallback(() => {
    if (!token) return;
    void run(() => listUsers(token), (r) => setUsers(r.data), 'Users loaded');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const refreshAudit = useCallback(() => {
    if (!token) return;
    void run(
      () => listAudit(token, { action: auditAction || undefined, limit: 25 }),
      (r) => setAudits(r.data),
      'Audit loaded',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, auditAction]);

  const refreshVaults = useCallback(() => {
    void (async () => {
      try {
        const r = await listVaults();
        setVaults(r.data);
      } catch (e) {
        setMsg((e as Error).message);
      }
    })();
  }, []);

  const refreshBots = useCallback(() => {
    void (async () => {
      try {
        const r = await listBots();
        setBots(r.data);
      } catch (e) {
        setMsg((e as Error).message);
      }
    })();
  }, []);

  const refreshPools = useCallback(() => {
    if (!token) return;
    void (async () => {
      try {
        const r = await partnerMe(token);
        setPoolMe(r.data as unknown as PoolMeData);
        setPoolSel((prev) => prev ?? (r.data.pools[0]?.id ?? null));
      } catch (e) {
        setMsg((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    refreshVaults();
    refreshBots();
    if (token) {
      refreshUsers();
      refreshAudit();
      refreshPools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || poolSel === null) return;
    void partnerPoolTraders(token, poolSel).then((r) => setPoolTraders(r.data)).catch((e) => setMsg((e as Error).message));
  }, [token, poolSel]);

  if (!session) {
    return (
      <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4">
        <div className="text-xs text-[#75798C]">Log in (Fund login panel) to use fund admin.</div>
      </section>
    );
  }

  // Non-ADMIN never sees admin internals (bot names, vault ids, audit):
  // authorization lives in BE guards; the panel is an ADMIN console only.
  if (!isAdmin) return null;

  return (
    <section className="rounded-lg bg-[#232532] border border-[#3F424D] p-4 space-y-3">
      <h3 className="font-display text-sm font-medium text-[#E9E9ED] flex items-center gap-1.5">
        <ShieldCheck size={16} className="text-[#49E6D7]" />
        Fund admin
        <span className="text-[10px] font-mono text-[#75798C]">({session.user.role})</span>
      </h3>

      {!isAdmin && (
        <div className="text-[11px] text-[#F2C179] bg-[rgba(242,193,121,0.08)] border border-[#F2C179]/30 rounded-lg px-2.5 py-1.5">
          Read-only for {session.user.role} — write actions require ADMIN.
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {(['users', 'audit', 'vaults', 'pools', 'bots', 'engine', 'demo'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 border ${
              tab === t
                ? 'bg-[#49E6D7] text-[#161826] border-[#49E6D7]'
                : 'text-[#A7AABF] border-[#3F424D]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="space-y-2">
          <button onClick={refreshUsers} disabled={busy} className={btnGhost}>
            Reload users
          </button>
          {users.map((u) => (
            <div key={u.id} className="text-[11px] font-mono text-[#A7AABF] flex justify-between gap-2">
              <span className="break-all">{u.username ? `@${u.username} (${u.wallet})` : u.wallet}</span>
              <span className="text-[#49E6D7] shrink-0">{u.role}</span>
            </div>
          ))}
          <div className="flex gap-1.5 flex-wrap pt-1">
            <input value={roleWallet} onChange={(e) => setRoleWallet(e.target.value)} placeholder="Wallet or username" className={`${inputCls} flex-1 min-w-[140px] font-mono`} />
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
              <option>USER</option>
              <option>KOL</option>
              <option>ADMIN</option>
            </select>
            <input value={roleReason} onChange={(e) => setRoleReason(e.target.value)} placeholder="Reason (required)" className={`${inputCls} flex-1 min-w-[140px]`} />
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => setUserRole(token, roleWallet.trim(), role, roleReason.trim()),
                    () => {
                      setRoleWallet('');
                      setRoleReason('');
                      refreshUsers();
                    },
                    'Role updated',
                  )
                }
                className={btnPrimary}
              >
                Set role
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <input value={auditAction} onChange={(e) => setAuditAction(e.target.value)} placeholder="Filter action (e.g. vault.create)" className={`${inputCls} flex-1`} />
            <button onClick={refreshAudit} disabled={busy} className={btnGhost}>
              Reload
            </button>
          </div>
          {audits.map((a) => (
            <div key={a.id} className="text-[11px] font-mono text-[#A7AABF] break-all">
              <span className="text-[#49E6D7]">{a.action}</span> · {a.actor.slice(0, 10)}… · {a.target ?? '—'}
              {a.reason ? ` · “${a.reason}”` : ''}
            </div>
          ))}
        </div>
      )}

      {tab === 'vaults' && (
        <div className="space-y-2">
          {vaults.map((v) => (
            <div key={v.id} className="text-[11px] font-mono text-[#A7AABF] break-all">
              <span className="text-[#E9E9ED]">#{v.id} {v.name}</span> [{v.environment}] ·{' '}
              {(v.traders ?? []).filter((t) => t.isActive).length} traders
              <div className="pl-2 text-[#75798C]">
                {((v.traders ?? []).filter((t) => t.isActive).map((t) => t.wallet.slice(0, 8))).join(', ') || 'no traders'}
              </div>
            </div>
          ))}
          <div className="flex gap-1.5 flex-wrap pt-1">
            <input value={vaultName} onChange={(e) => setVaultName(e.target.value)} placeholder="New vault name" className={`${inputCls} flex-1 min-w-[120px]`} />
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => createVault(token, vaultName.trim(), 'created from dashboard'), () => {
                    setVaultName('');
                    refreshVaults();
                  }, 'Vault created')
                }
                className={btnPrimary}
              >
                Create vault
              </button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <input value={trVault} onChange={(e) => setTrVault(e.target.value)} placeholder="Vault id" className={`${inputCls} w-20`} />
            <input value={trWallet} onChange={(e) => setTrWallet(e.target.value)} placeholder="Trader wallet" className={`${inputCls} flex-1 min-w-[140px] font-mono`} />
            {isAdmin && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => assignVaultTrader(token, Number(trVault), trWallet.trim(), 'assigned from dashboard'),
                      () => {
                        setTrWallet('');
                        refreshVaults();
                      },
                      'Trader assigned',
                    )
                  }
                  className={btnPrimary}
                >
                  Assign
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => removeVaultTrader(token, Number(trVault), trWallet.trim()), () => refreshVaults(), 'Trader removed')
                  }
                  className={btnGhost}
                >
                  Remove
                </button>
              </>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <input value={polVault} onChange={(e) => setPolVault(e.target.value)} placeholder="Vault id" className={`${inputCls} w-20`} />
            <input value={polReserve} onChange={(e) => setPolReserve(e.target.value)} placeholder="reserveBps" className={`${inputCls} w-24`} />
            <input value={polFee} onChange={(e) => setPolFee(e.target.value)} placeholder="feeBps" className={`${inputCls} w-24`} />
            <input value={polLock} onChange={(e) => setPolLock(e.target.value)} placeholder="lockH" className={`${inputCls} w-20`} />
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      setVaultPolicy(token, Number(polVault), {
                        ...(polReserve !== '' ? { reserveBps: Number(polReserve) } : {}),
                        ...(polFee !== '' ? { withdrawFeeBps: Number(polFee) } : {}),
                        ...(polLock !== '' ? { lockHours: Number(polLock) } : {}),
                        reason: 'policy from dashboard',
                      }),
                    () => {
                      setPolReserve('');
                      setPolFee('');
                      setPolLock('');
                    },
                    'Policy updated',
                  )
                }
                className={btnPrimary}
              >
                Set policy
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'pools' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[#75798C]">
            Partner-pool ops (moved out of the KOL /trader portal). ADMIN-only; every write is audited in BE.
          </p>
          <div className="flex gap-1.5 flex-wrap items-center">
            <button onClick={refreshPools} disabled={busy} className={btnGhost}>
              Reload pools
            </button>
            {(poolMe?.pools ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => setPoolSel(p.id)}
                className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 border ${poolSel === p.id ? 'bg-[#49E6D7] text-[#161826] border-[#49E6D7]' : 'text-[#A7AABF] border-[#3F424D]'}`}
              >
                #{p.id} {p.name}
              </button>
            ))}
          </div>
          {(() => {
            const pool = (poolMe?.pools ?? []).find((p) => p.id === poolSel) ?? null;
            if (!pool) return <div className="text-[11px] text-[#75798C]">No pool selected.</div>;
            const save = (patch: Record<string, unknown>, label: string) =>
              void run(() => partnerUpdateSettings(token, pool.id, patch).then(() => refreshPools()), () => undefined, label);
            const ruleKeys = ['traderCapPctNav', 'entryNowPct', 'limitOffsetPct', 'stopMinPct', 'stopMaxPct', 'timeStopHours', 'dailyKillSwitchPct', 'weeklyLossLimitPct'];
            return (
              <div className="space-y-2">
                <div className="text-[11px] font-mono text-[#A7AABF]">
                  <span className="text-[#E9E9ED]">#{pool.id} {pool.name}</span> [{pool.kind}] · {pool.status} · {pool.listing} · NAV {pool.navSol.toFixed(2)} SOL
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <input value={poolName} onChange={(e) => setPoolName(e.target.value)} placeholder="New pool name" className={`${inputCls} flex-1 min-w-[140px]`} />
                  <button disabled={busy || !poolName.trim()} onClick={() => save({ name: poolName.trim() }, 'Pool renamed')}
                    className={btnPrimary}>Rename</button>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <button disabled={busy} onClick={() => save({ status: pool.status === 'live' ? 'paused' : 'live' }, pool.status === 'live' ? 'Pool paused' : 'Pool live')}
                    className={btnGhost}>{pool.status === 'live' ? 'Pause pool' : 'Resume pool'}</button>
                  <button disabled={busy} onClick={() => save({ listing: pool.listing === 'public' ? 'unlisted' : 'public' }, 'Listing updated')}
                    className={btnGhost}>Make {pool.listing === 'public' ? 'unlisted' : 'public'}</button>
                  {[3, 4, 5].map((n) => (
                    <button key={n} disabled={busy} onClick={() => save({ maxTraders: n }, `Max traders → ${n}`)}
                      className={btnGhost}>Max {n}</button>
                  ))}
                  <input value={poolSlots} onChange={(e) => setPoolSlots(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Max slots" className={`${inputCls} w-24`} />
                  <button disabled={busy || !poolSlots} onClick={() => save({ maxSlots: Number(poolSlots) }, 'Slots updated')}
                    className={btnGhost}>Set slots</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {ruleKeys.map((k) => (
                    <div key={k}>
                      <div className="text-[10px] font-mono text-[#75798C]">{k}</div>
                      <input value={poolRules[k] ?? ''} onChange={(e) => setPoolRules((v) => ({ ...v, [k]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        placeholder="—" inputMode="decimal" className={`${inputCls} w-full font-mono`} />
                    </div>
                  ))}
                </div>
                <button
                  disabled={busy || Object.keys(poolRules).length === 0}
                  onClick={() => {
                    const rules: Record<string, number> = {};
                    for (const [k, v] of Object.entries(poolRules)) {
                      if (v.trim() === '') continue;
                      const n = Number(v);
                      if (!Number.isFinite(n)) {
                        setMsg(`Rule ${k} must be a number.`);
                        return;
                      }
                      rules[k] = n;
                    }
                    save({ rulesJson: rules }, 'Pool rules saved');
                    setPoolRules({});
                  }}
                  className={btnPrimary}
                >
                  Save rules
                </button>
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-bold text-[#E9E9ED]">Traders ({poolTraders.length})</div>
                  {poolTraders.map((t) => (
                    <div key={t.wallet} className="text-[11px] font-mono text-[#A7AABF] flex justify-between gap-2 items-center flex-wrap">
                      <span className="break-all">@{t.handle} · {t.isActive ? 'active' : 'paused'} · {t.signals7d} sig 7d · {t.profitUsd} · fee {t.feeSol.toFixed(4)}</span>
                      <span className="flex gap-1 shrink-0">
                        <button disabled={busy}
                          onClick={() => void run(() => partnerPauseTrader(token, pool.id, t.wallet, !t.isActive), () => partnerPoolTraders(token, pool.id).then((r) => setPoolTraders(r.data)), t.isActive ? 'Trader paused' : 'Trader resumed')}
                          className={btnGhost}>{t.isActive ? 'Pause' : 'Resume'}</button>
                        <button disabled={busy}
                          onClick={() => void run(() => partnerRemoveTrader(token, pool.id, t.wallet), () => partnerPoolTraders(token, pool.id).then((r) => setPoolTraders(r.data)), 'Trader removed')}
                          className={btnGhost}>Remove</button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 pt-1">
                  <div className="text-[11px] font-bold text-[#E9E9ED]">Basket status</div>
                  {(poolMe?.basket ?? []).map((b) => (
                    <div key={b.wallet} className="text-[11px] font-mono text-[#A7AABF]">
                      @{b.handle} · {b.inBasket ? 'In basket' : 'Not in basket'} · #{b.ranks?.h24 ?? '—'} / #{b.ranks?.d7 ?? '—'} / #{b.ranks?.d30 ?? '—'}
                    </div>
                  ))}
                  {(poolMe?.basket ?? []).length === 0 && <div className="text-[11px] text-[#75798C]">No tracked traders.</div>}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'bots' && (
        <div className="space-y-2">
          {bots.map((b) => (
            <div key={b.id} className="text-[11px] font-mono text-[#A7AABF] flex justify-between gap-2 items-center">
              <span className="break-all">#{b.id} {b.name} → vault {b.vaultId ?? '—'}</span>
              <span className="flex gap-1 shrink-0 items-center">
                <span className={b.mode === 'AUTO' ? 'text-[#49E6D7]' : 'text-[#F2C179]'}>{b.mode}</span>
                {isAdmin && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setBotMode(token, b.id, b.mode === 'AUTO' ? 'PAUSED' : 'AUTO', 'toggled from dashboard'),
                        () => refreshBots(),
                        `Bot ${b.mode === 'AUTO' ? 'paused' : 'resumed'}`,
                      )
                    }
                    className={btnGhost}
                  >
                    {b.mode === 'AUTO' ? 'Pause' : 'Resume'}
                  </button>
                )}
              </span>
            </div>
          ))}
          <div className="flex gap-1.5 flex-wrap pt-1">
            <input value={botName} onChange={(e) => setBotName(e.target.value)} placeholder="New bot name" className={`${inputCls} flex-1 min-w-[120px]`} />
            <input value={botVault} onChange={(e) => setBotVault(e.target.value)} placeholder="Vault id (optional)" className={`${inputCls} w-32`} />
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => createBot(token, botName.trim(), 'created from dashboard', botVault ? Number(botVault) : undefined),
                    () => {
                      setBotName('');
                      setBotVault('');
                      refreshBots();
                    },
                    'Bot created',
                  )
                }
                className={btnPrimary}
              >
                Create bot
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'engine' && (
        <div className="space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <input value={tickMin} onChange={(e) => setTickMin(e.target.value)} placeholder="minutes" className={`${inputCls} w-24`} />
            <input value={tickLimit} onChange={(e) => setTickLimit(e.target.value)} placeholder="limit" className={`${inputCls} w-20`} />
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => runAutoFireTick(token, Number(tickMin) || 15, Number(tickLimit) || 10),
                    (r) => setTickResult(r.data),
                    'Tick complete',
                  )
                }
                className={btnPrimary}
              >
                Run tick
              </button>
            )}
          </div>
          {tickResult && (
            <pre className="text-[11px] font-mono text-[#A7AABF] bg-[#161826] border border-[#3F424D] rounded-lg p-2 whitespace-pre-wrap break-all">
              {JSON.stringify(tickResult, null, 1)}
            </pre>
          )}
        </div>
      )}

      {tab === 'demo' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[#75798C]">
            Stage demo 1-click: wipe old demo pools, then run 3 cases in parallel
            (seed vault+bot+traders, replay real BUYs → terminal log, 2nd deposit +
            settle moves NAV, withdrawal stays queued). Watch it live in the pool terminal log.
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {isAdmin && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => runDemoScenario(token),
                      (r) => {
                        setDemoResult(r.data);
                        refreshVaults();
                        const first = r.data.cases.find((c) => c.ok && c.vaultId);
                        if (first?.vaultId) void loadJourneys(first.vaultId);
                      },
                      'Scenario complete',
                    )
                  }
                  className={btnPrimary}
                >
                  Run scenario ×3
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => resetDemo(token),
                      () => {
                        setDemoResult(null);
                        setJourneys([]);
                        setJourneyVault('');
                        refreshVaults();
                      },
                      'Demo pools deleted',
                    )
                  }
                  className={btnGhost}
                >
                  Reset demo
                </button>
              </>
            )}
          </div>
          {demoResult && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-[#75798C]">
                cleaned pools: {demoResult.cleaned.vaults} · bots: {demoResult.cleaned.bots} · orders: {demoResult.cleaned.orders}
              </div>
              {demoResult.cases.map((c) => (
                <div key={c.name} className="text-[11px] font-mono bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5">
                  <span className={c.ok ? 'text-[#73DEA4]' : 'text-[#F28881]'}>{c.ok ? '●' : '○'} {c.name}</span>{' '}
                  {c.ok ? (
                    <a href={`/pools/${c.vaultId}`} className="text-[#49E6D7] underline">
                      pool #{c.vaultId}
                    </a>
                  ) : (
                    <span className="text-[#A7AABF]">{c.error}</span>
                  )}
                  {c.ok && (
                    <span className="text-[#A7AABF]">
                      {' '}· signals {c.signals} · fired {c.fired} · failed {c.failed} · NAV {c.settleNavSol} · withdraw {c.withdrawal?.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap items-center pt-1">
            <input value={journeyVault} onChange={(e) => setJourneyVault(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Pool id" className={`${inputCls} w-24`} />
            <button
              disabled={busy || journeyBusy || !journeyVault}
              onClick={() => void loadJourneys(Number(journeyVault))}
              className={btnGhost}
            >
              {journeyBusy ? 'Loading…' : 'Load signal journeys'}
            </button>
          </div>
          {journeys.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono text-[#75798C]">
                {journeys.length} signals · Detect → Qualify → Enter → Manage → Exit
              </div>
              {journeys.slice(0, 10).map((j) => (
                <JourneyRail key={j.id} j={j} />
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <div className="text-[11px] text-[#A7AABF] break-all">{msg}</div>}
    </section>
  );
}
