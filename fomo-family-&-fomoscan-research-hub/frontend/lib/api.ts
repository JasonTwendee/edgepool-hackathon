import type { OnChainTransactionEvent, TrackedWallet } from '../types/onchain';
import type {
  AuditLog,
  AuthNonce,
  AuthSessionData,
  AutoFireTickResult,
  Bot,
  FundUser,
  VaultPolicy,
  VaultTrader,
  VaultWithTraders,
} from '../types/fund';

/**
 * Typed REST client — must match docs/api/openapi.yaml.
 * Same-origin '' works in all cases (prod single-origin + dev via next.config rewrites).
 * Set NEXT_PUBLIC_API_URL only for cross-origin direct calls (bypasses rewrites).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `Request failed: ${path}`);
  }
  return res.json() as Promise<T>;
}

export interface HealthResponse {
  status: string;
  service: string;
  rpcEndpoint: string;
  heliusEnabled: boolean;
  activeWalletsCount: number;
  timestamp: string;
}

export interface WalletListResponse {
  success: boolean;
  total: number;
  data: TrackedWallet[];
}

export interface PortfolioResponse {
  success: boolean;
  total: number;
  walletsCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  asOf: string;
  data: OnChainTransactionEvent[];
}

export function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>('/api/health');
}

export function listWallets(): Promise<WalletListResponse> {
  return fetchJson<WalletListResponse>('/api/wallets');
}

export function updateWalletCopy(
  address: string,
  input: { isCopyEnabled?: boolean; allocationWeight?: number },
): Promise<{ success: boolean; message?: string }> {
  return fetchJson(`/api/wallets/${encodeURIComponent(address)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export type SwapAction = 'BUY' | 'SELL';

export function getPortfolioTransactions(params?: {
  wallet?: string;
  page?: number;
  pageSize?: number;
  action?: SwapAction;
  days?: number;
  hideZero?: boolean;
}): Promise<PortfolioResponse> {
  const search = new URLSearchParams();
  if (params?.wallet) search.set('wallet', params.wallet);
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  if (params?.action) search.set('action', params.action);
  if (params?.days) search.set('days', String(params.days));
  if (params?.hideZero) search.set('hideZero', '1');
  const qs = search.toString();
  return fetchJson<PortfolioResponse>(`/api/portfolio/transactions${qs ? `?${qs}` : ''}`);
}

export function executeCopyTrade(input: {
  masterTxHash?: string;
  symbol?: string;
  action?: string;
  amountUsd?: number;
  venue?: string;
  masterWallet?: string;
  masterHandle?: string;
}): Promise<{ success: boolean; copyRecord: Record<string, unknown> }> {
  return fetchJson('/api/copy-trade/execute', { method: 'POST', body: JSON.stringify(input) });
}

export function executePaperTrade(
  input: import('../types/onchain').ExecutePaperInput,
): Promise<{ success: boolean; copyRecord: import('../types/onchain').CopyOrder }> {
  return fetchJson('/api/copy-trade/execute', { method: 'POST', body: JSON.stringify(input) });
}

export function listCopyHistory(params?: {
  wallet?: string;
  limit?: number;
}): Promise<import('../types/onchain').CopyHistoryResponse> {
  const search = new URLSearchParams();
  if (params?.wallet) search.set('wallet', params.wallet);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return fetchJson(`/api/copy-trade/history${qs ? `?${qs}` : ''}`);
}

export interface VaultStatusResponse {
  success: boolean;
  data: {
    id: number;
    name: string;
    environment?: string;
    feeBps: number;
    hwmSharePrice: number;
    totalShares: number;
    treasurySol?: number;
    partnerAccruedSol?: number;
    policy?: { reserveBps: number; withdrawFeeBps: number; lockHours: number };
    lastEpoch: {
      navSol: number;
      sharePrice: number;
      sharesOutstanding: number;
      feeSol: number;
      createdAt: string;
    } | null;
    queuedDeposits: number;
    queuedWithdrawals: number;
  };
}

export function getVaultStatus(vaultId = 1): Promise<VaultStatusResponse> {
  return fetchJson(`/api/vaults/status?vaultId=${vaultId}`);
}

export interface VaultEarningsResponse {
  success: boolean;
  data: {
    vaultId: number;
    totalSol: number;
    byTrader: Record<string, number>;
    payouts: { id: number; trader: string; amountSol: number; epochId: number | null; status: string; createdAt: string }[];
  };
}

export function getVaultEarnings(vaultId = 1, trader?: string): Promise<VaultEarningsResponse> {
  const qs = trader ? `?trader=${encodeURIComponent(trader)}` : '';
  return fetchJson(`/api/vaults/${vaultId}/earnings${qs}`);
}

export interface VaultMine {
  vaultId: number;
  vaultName: string;
  sharePrice: number;
  shares: number;
  valueSol: number;
  depositedSol: number;
  withdrawnSol: number;
  returnsSol: number;
  queuedDeposits: { id: number; amountSol: number; createdAt: string }[];
  queuedWithdrawals: { id: number; shares: number; createdAt: string }[];
}

export function getVaultMine(vaultId = 1, token?: string): Promise<{ success: boolean; data: VaultMine }> {
  const path = `/api/vaults/mine?vaultId=${vaultId}`;
  return token ? fetchJsonAuth(path, token) : fetchJson(path);
}

export interface PoolSummary {
  id: number;
  name: string;
  kind: 'basket' | 'partner';
  status: 'live' | 'paused';
  listing: 'public' | 'unlisted';
  navSol: number;
  navPerShare: number;
  hwmNavPerShare: number;
  totalShares: number;
  slots: { used: number; max: number };
  maxTraders: number;
  traders: { wallet: string; handle: string; rank: number | null }[];
  pnl: Record<'day' | 'week' | 'month' | 'all', { sol: number; pct: number }>;
  myHolding?: { shares: number; valueSol: number; returnsSol: number } | null;
}

export function listPools(): Promise<{ success: boolean; total: number; data: PoolSummary[] }> {
  return fetchJson('/api/vaults/pools');
}

export interface PoolDetail extends PoolSummary {
  navSeries: { t: number; v: number }[];
  openPositions: { token: string; trader: string; sizeSol: number | null; unrealizedPct: number | null; stage: string; entryPriceUsd: number | null; livePriceUsd: number | null }[];
  openCount: number;
  signals: { token: string; trader: string; ageSec: number; note: string; steps: { label: string; state: string }[] }[];
  log: { at: string; token: string; trader: string; event: string; detail: string; kind: string }[];
  exposure: { trader: string; pctNav: number; pnlSol: number }[];
  myHolding: VaultMine | null;
  masked: boolean;
  advanced?: {
    kpis: { navSol: number; sharePrice: number; pnlSol: number | null; unrealizedSol: number; deployedPctNav: number; fromHwmPct: number };
    risk: { dayPct: number; dayLimitPct: number; dayUsedPct: number; weekPct: number; weekLimitPct: number; weekUsedPct: number; signals24h: number; emergencyExits7d: number };
    ladder: { token: string; trader: string; entry: number | null; live: number | null; movePct: number | null; tp1Pct: number; tp1Hit: boolean; tp2Pct: number; tp2Hit: boolean; stopPct: number; trailFloorPct: number | null; stage: string }[];
    exposure: { trader: string; pctNav: number; pnlSol: number; capPct: number }[];
  };
}

export function getPoolDetail(id: number): Promise<{ success: boolean; data: PoolDetail }> {
  return fetchJson(`/api/vaults/${id}/pool`);
}

export interface PortfolioOverview {
  totalValueSol: number;
  totalDepositedSol: number;
  totalWithdrawnSol: number;
  returnsSol: number;
  pools: { vaultId: number; poolName: string; kind: string; status: string; shares: number; valueSol: number; returnsSol: number; depositedSol: number; withdrawnSol: number; openCount: number; flat: boolean; queued: number }[];
  exposures: { poolId: number; poolName: string; token: string; trader: string; unrealizedPct: number | null; mySizeSol: number }[];
  pending: { id: number; poolId: number; poolName: string; shares: number; createdAt: string; nextCheckpointAt: string | null }[];
  history: { date: string; type: string; poolId: number; poolName: string; tx: string; amountSol: number; sharesDelta: number; status: string }[];
}

export function getPortfolioOverview(token?: string): Promise<{ success: boolean; data: PortfolioOverview }> {
  return token ? fetchJsonAuth('/api/vaults/portfolio', token) : fetchJson('/api/vaults/portfolio');
}

export function cancelWithdrawal(id: number, token: string): Promise<{ success: boolean; data: { id: number; status: string } }> {
  return fetchJsonAuth(`/api/vaults/withdraw/${id}`, token, { method: 'DELETE' });
}

export interface PartnerMe {
  handle: string;
  payoutWallet: string | null;
  pools: { id: number; name: string; kind: string; status: string; listing: string; navSol: number }[];
  fees: { pendingSol: number; claimableSol: number; paidSol: number; nextCheckpointAt: string | null; byPool: { vaultId: number; kind: string; claimableSol: number; paidSol: number }[] };
  basket: { wallet: string; handle: string; rank: number | null; inBasket: boolean; note: string }[];
  requests: { id: number; vaultId: number; fomoHandle: string; status: string }[];
}

export function partnerApply(input: { fomoHandle: string; xHandle?: string; wallet: string; contact: string }): Promise<{ success: boolean; data: { id: number; status: string } }> {
  return fetchJson('/api/partner/apply', { method: 'POST', body: JSON.stringify(input) });
}

export function partnerMe(token: string): Promise<{ success: boolean; data: PartnerMe }> {
  return fetchJsonAuth('/api/partner/me', token);
}

export function partnerSetPayoutWallet(token: string, wallet: string): Promise<{ success: boolean; data: { payoutWallet: string } }> {
  return fetchJsonAuth('/api/partner/payout-wallet', token, { method: 'POST', body: JSON.stringify({ wallet }) });
}

export function partnerClaim(token: string): Promise<{ success: boolean; data: { claimedSol: number; rows: number } }> {
  return fetchJsonAuth('/api/partner/claim', token, { method: 'POST' });
}

export function partnerPoolTraders(token: string, poolId: number): Promise<{ success: boolean; total: number; data: { wallet: string; handle: string; isActive: boolean; weightBps: number; signals7d: number; profitUsd: number; feeSol: number }[] }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/traders`, token);
}

export function partnerUpdateSettings(token: string, poolId: number, patch: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/settings`, token, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function partnerPauseTrader(token: string, poolId: number, wallet: string, active: boolean): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/traders/${encodeURIComponent(wallet)}/pause`, token, { method: 'POST', body: JSON.stringify({ active }) });
}

export function partnerRequestTrader(token: string, poolId: number, input: { fomoHandle: string; xHandle?: string }): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/request-trader`, token, { method: 'POST', body: JSON.stringify(input) });
}

export function partnerSignals(token: string, vaultId?: number): Promise<{ success: boolean; total: number; data: { id: number; vaultId: number; token: string; trader: string; status: string; profitUsd: number | null; createdAt: string }[] }> {
  return fetchJsonAuth(`/api/partner/signals${vaultId ? `?vaultId=${vaultId}` : ''}`, token);
}

export function partnerPayouts(token: string): Promise<{ success: boolean; total: number; data: { id: number; vaultId: number; trader: string; amountSol: number; epochId: number | null; kind: string; status: string; createdAt: string }[] }> {
  return fetchJsonAuth('/api/partner/payouts', token);
}

export function queueVaultDeposit(input: {
  depositor: string;
  amountSol: number;
  vaultId?: number;
}, token?: string): Promise<{ success: boolean; data: { id: number; status: string } }> {
  const init = { method: 'POST', body: JSON.stringify(input) };
  return token ? fetchJsonAuth('/api/vaults/deposit', token, init) : fetchJson('/api/vaults/deposit', init);
}

export function requestVaultWithdraw(input: {
  depositor: string;
  shares: number;
  vaultId?: number;
}, token?: string): Promise<{ success: boolean; data: { id: number; status: string } }> {
  const init = { method: 'POST', body: JSON.stringify(input) };
  return token ? fetchJsonAuth('/api/vaults/withdraw', token, init) : fetchJson('/api/vaults/withdraw', init);
}

export interface WalletPnl {
  wallet: string;
  days: number;
  realizedPnlUsd: number;
  pairs: number;
  matchedSells: number;
  totalSells: number;
  totalBuys: number;
  winRate: number | null;
  perSymbol: { symbol: string; pairs: number; pnlUsd: number }[];
  series: { t: number; cum: number }[];
  topTrades: OnChainTransactionEvent[];
}

export function getWalletPnl(
  wallet: string,
  days?: number,
): Promise<{ success: boolean; asOf: string; data: WalletPnl }> {
  const search = new URLSearchParams({ wallet });
  if (days) search.set('days', String(days));
  return fetchJson(`/api/portfolio/pnl?${search.toString()}`);
}

export function getPnlOverview(days?: number): Promise<{
  success: boolean;
  total: number;
  asOf: string;
  data: WalletPnl[];
}> {
  return fetchJson(`/api/portfolio/pnl/overview${days ? `?days=${days}` : ''}`);
}

export interface HoldingToken {
  mint: string;
  symbol: string;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface WalletHoldings {
  wallet: string;
  asOf: string;
  solBalance: number;
  solPriceUsd: number | null;
  solValueUsd: number | null;
  totalValueUsd: number;
  tokens: HoldingToken[];
}

export function getHoldings(wallet: string): Promise<{
  success: boolean;
  asOf: string;
  data: WalletHoldings;
}> {
  return fetchJson(`/api/portfolio/holdings?wallet=${encodeURIComponent(wallet)}`);
}

export interface RealtimeEvent {
  id: number;
  eventType: string;
  walletAddress: string;
  txSignature: string | null;
  title: string;
  payload: unknown;
  broadcastedAt: string;
}

export function listRealtimeEvents(params?: {
  wallet?: string;
  limit?: number;
}): Promise<{ success: boolean; total: number; data: RealtimeEvent[] }> {
  const search = new URLSearchParams();
  if (params?.wallet) search.set('wallet', params.wallet);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return fetchJson(`/api/onchain/events${qs ? `?${qs}` : ''}`);
}

// ---------------------------------------------------------------------------
// Fund auth + admin (T3). Token lives in localStorage; never logged.
// ---------------------------------------------------------------------------

const SESSION_KEY = 'fomo.session';

export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: string };
    if (!parsed.token) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

export function storeSession(data: AuthSessionData): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

async function fetchJsonAuth<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    // credentials:include lets the httpOnly cookie flow through Next rewrites;
    // Bearer stays for scripts/back-compat.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const err = new Error(body.message || `Request failed (${res.status}): ${path}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function issueAuthNonce(wallet: string): Promise<{ success: boolean; data: AuthNonce }> {
  return fetchJson('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet }) });
}

export function verifyAuthSignature(
  wallet: string,
  signature: string,
): Promise<{ success: boolean; data: AuthSessionData }> {
  return fetchJson('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet, signature }) });
}

export function getAuthMe(token: string): Promise<{ success: boolean; data: FundUser }> {
  return fetchJsonAuth('/api/auth/me', token);
}

export function logout(token?: string): Promise<{ success: boolean; data: { revoked: boolean } }> {
  return fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then(async (res) => {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message || `Logout failed (${res.status})`);
    }
    return res.json() as Promise<{ success: boolean; data: { revoked: boolean } }>;
  });
}

export function loginAccount(input: {
  username: string;
  password: string;
}): Promise<{ success: boolean; data: import('../types/fund').AuthSessionData }> {
  return fetchJson('/api/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function listUsers(token: string): Promise<{ success: boolean; total: number; data: FundUser[] }> {
  return fetchJsonAuth('/api/users', token);
}

export function setUserRole(
  token: string,
  wallet: string,
  role: string,
  reason: string,
): Promise<{ success: boolean; data: FundUser }> {
  return fetchJsonAuth(`/api/users/${encodeURIComponent(wallet)}/role`, token, {
    method: 'POST',
    body: JSON.stringify({ role, reason }),
  });
}

export function listAudit(
  token: string,
  params?: { actor?: string; action?: string; limit?: number },
): Promise<{ success: boolean; total: number; data: AuditLog[] }> {
  const search = new URLSearchParams();
  if (params?.actor) search.set('actor', params.actor);
  if (params?.action) search.set('action', params.action);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return fetchJsonAuth(`/api/audit${qs ? `?${qs}` : ''}`, token);
}

export function listVaults(): Promise<{ success: boolean; total: number; data: VaultWithTraders[] }> {
  return fetchJson('/api/vaults');
}

export function createVault(
  token: string,
  name: string,
  reason: string,
): Promise<{ success: boolean; data: VaultWithTraders }> {
  return fetchJsonAuth('/api/vaults', token, { method: 'POST', body: JSON.stringify({ name, reason }) });
}

export function assignVaultTrader(
  token: string,
  vaultId: number,
  wallet: string,
  reason: string,
  weightBps?: number,
): Promise<{ success: boolean; data: VaultTrader }> {
  return fetchJsonAuth(`/api/vaults/${vaultId}/traders`, token, {
    method: 'POST',
    body: JSON.stringify({ wallet, weightBps, reason }),
  });
}

export function removeVaultTrader(token: string, vaultId: number, wallet: string): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/vaults/${vaultId}/traders/${encodeURIComponent(wallet)}`, token, {
    method: 'DELETE',
  });
}

export function setVaultPolicy(
  token: string,
  vaultId: number,
  policy: Partial<VaultPolicy> & { reason: string },
): Promise<{ success: boolean; data: { id: number; policy: VaultPolicy } }> {
  return fetchJsonAuth(`/api/vaults/${vaultId}/policy`, token, {
    method: 'POST',
    body: JSON.stringify(policy),
  });
}

export function listBots(): Promise<{ success: boolean; total: number; data: Bot[] }> {
  return fetchJson('/api/bots');
}

export function createBot(
  token: string,
  name: string,
  reason: string,
  vaultId?: number,
): Promise<{ success: boolean; data: Bot }> {
  return fetchJsonAuth('/api/bots', token, {
    method: 'POST',
    body: JSON.stringify({ name, vaultId, reason }),
  });
}

export function setBotMode(
  token: string,
  id: number,
  mode: 'AUTO' | 'PAUSED',
  reason: string,
): Promise<{ success: boolean; data: Bot }> {
  return fetchJsonAuth(`/api/bots/${id}/mode`, token, {
    method: 'POST',
    body: JSON.stringify({ mode, reason }),
  });
}

export function runAutoFireTick(
  token: string,
  minutes?: number,
  limit?: number,
): Promise<{ success: boolean; data: AutoFireTickResult }> {
  return fetchJsonAuth('/api/copy-trade/auto-fire/tick', token, {
    method: 'POST',
    body: JSON.stringify({ minutes, limit }),
  });
}
