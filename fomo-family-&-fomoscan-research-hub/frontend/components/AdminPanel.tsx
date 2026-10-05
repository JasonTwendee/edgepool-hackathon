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
  removeVaultTrader,
  runAutoFireTick,
  setBotMode,
  setUserRole,
  setVaultPolicy,
} from '../lib/api';
import type {
  AuditLog,
  AutoFireTickResult,
  Bot,
  FundSession,
  FundUser,
  VaultWithTraders,
} from '../types/fund';

type Tab = 'users' | 'audit' | 'vaults' | 'bots' | 'engine';

const inputCls =
  'text-xs bg-[#161826] border border-[#3F424D] rounded-lg px-2.5 py-1.5 text-[#E9E9ED] placeholder:text-[#4A4D5E]';
const btnPrimary =
  'text-xs font-bold text-[#161826] bg-[#49E6D7] rounded-lg px-2.5 py-1.5 disabled:opacity-50';
const btnGhost =
  'text-xs text-[#A7AABF] hover:text-[#E9E9ED] border border-[#3F424D] rounded-lg px-2.5 py-1.5 disabled:opacity-50';

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

  useEffect(() => {
    refreshVaults();
    refreshBots();
    if (token) {
      refreshUsers();
      refreshAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
        {(['users', 'audit', 'vaults', 'bots', 'engine'] as Tab[]).map((t) => (
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

      {msg && <div className="text-[11px] text-[#A7AABF] break-all">{msg}</div>}
    </section>
  );
}
