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

// Short-lived GET cache: back-navigation renders instantly from memory while
// mutations below always invalidate. Keyed by path + token (never leak one
// user's numbers to the next login on the same browser).
const GET_TTL_MS = 30000;
const getCache = new Map<string, { at: number; data: unknown }>();

function cachedGet<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = getCache.get(key);
  if (hit && Date.now() - hit.at < GET_TTL_MS) return Promise.resolve(hit.data as T);
  return run().then((data) => {
    getCache.set(key, { at: Date.now(), data });
    return data;
  });
}

/** Drop cached GETs (all, or by key prefix) after any state-changing call. */
export function bumpApiCache(prefix?: string): void {
  if (!prefix) {
    getCache.clear();
    return;
  }
  for (const k of [...getCache.keys()]) {
    if (k.startsWith(prefix)) getCache.delete(k);
  }
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
  /** Live MTM marks (present on fresh backends; absent on cached/stale reads). */
  liveSharePrice?: number;
  liveValueSol?: number;
  liveReturnsSol?: number;
  live?: boolean;
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
  traders: { wallet: string; handle: string; rank: number | null; weightBps: number; enteredAt?: string | null; trackedSince?: string | null; whyTop?: { whyTop?: { pnlUsd?: number | null; primaryWindow?: string | null; primary?: { netUsd?: number | null; trades?: number | null; winRatePct?: number | null } | null } } | null; ranks: { h24: number | null; d7: number | null; d30: number | null } }[];
  spark: number[];
  pnl: Record<'day' | 'week' | 'month' | 'all', { sol: number; pct: number }>;
  myHolding?: { shares: number; valueSol: number; returnsSol: number } | null;
}

export function listPools(): Promise<{ success: boolean; total: number; data: PoolSummary[] }> {
  return cachedGet(`pools:${getStoredToken() ?? ''}`, () => fetchJson('/api/vaults/pools'));
}

export interface PoolDetail extends PoolSummary {
  navSeries: { t: number; v: number }[];
  /** On-chain vault info (P3) — present only when the pool is chain-bound. */
  chain?: import('../types/fund').ChainVaultInfo;
  /** Live MTM marks (present on fresh backends; absent on cached/stale reads). */
  liveNavSol?: number;
  liveSharePrice?: number;
  live?: boolean;
  openPositions: { token: string; trader: string; sizeSol: number | null; unrealizedPct: number | null; stage: string; entryPriceUsd: number | null; livePriceUsd: number | null; createdAt: string }[];
  openCount: number;
  signals: { token: string; trader: string; ageSec: number; note: string; detail: string; steps: { label: string; state: string }[] }[];
  log: { at: string; token: string; trader: string; event: string; detail: string; kind: string }[];
  exposure: { trader: string; pctNav: number; pnlSol: number }[];
  myHolding: VaultMine | null;
  masked: boolean;
  advanced?: {
    kpis: { navSol: number; sharePrice: number; pnlSol: number | null; unrealizedSol: number; deployedPctNav: number; fromHwmPct: number };
    risk: { dayPct: number; dayLimitPct: number; dayUsedPct: number; weekPct: number; weekLimitPct: number; weekUsedPct: number; signals24h: number; emergencyExits7d: number };
    ladder: { token: string; trader: string; entry: number | null; live: number | null; movePct: number | null; sizeSol: number | null; createdAt: string; tp1Pct: number; tp1Hit: boolean; tp2Pct: number; tp2Hit: boolean; stopPct: number; trailFloorPct: number | null; stage: string }[];
    exposure: { trader: string; pctNav: number; pnlSol: number; capPct: number }[];
  };
}

export function getPoolDetail(id: number): Promise<{ success: boolean; data: PoolDetail }> {
  // Authenticated when possible: the bearer carries myHolding (position,
  // queued deposits) while public fields stay identical for everyone.
  const token = getStoredToken();
  return cachedGet(`pool:${id}:${token ?? ''}`, () =>
    token ? fetchJsonAuth(`/api/vaults/${id}/pool`, token) : fetchJson(`/api/vaults/${id}/pool`),
  );
}

export interface PortfolioOverview {
  totalValueSol: number;
  totalDepositedSol: number;
  totalWithdrawnSol: number;
  returnsSol: number;
  totalLiveValueSol?: number;
  totalLiveReturnsSol?: number;
  pools: { vaultId: number; poolName: string; kind: string; status: string; shares: number; valueSol: number; returnsSol: number; depositedSol: number; withdrawnSol: number; sharePrice: number; avgEntrySol: number; sharePricePct: number; openCount: number; flat: boolean; queued: number; liveValueSol?: number; liveReturnsSol?: number; liveSharePrice?: number; live?: boolean }[];
  exposures: { poolId: number; poolName: string; token: string; trader: string; unrealizedPct: number | null; mySizeSol: number }[];
  pending: { id: number; poolId: number; poolName: string; shares: number; createdAt: string; nextCheckpointAt: string | null }[];
  history: { date: string; type: string; poolId: number; poolName: string; tx: string; amountSol: number; sharesDelta: number; status: string }[];
}

export function getPortfolioOverview(token?: string): Promise<{ success: boolean; data: PortfolioOverview }> {
  const key = `portfolio:${token ?? getStoredToken() ?? ''}`;
  return cachedGet(key, () => (token ? fetchJsonAuth('/api/vaults/portfolio', token) : fetchJson('/api/vaults/portfolio')));
}

export function cancelWithdrawal(id: number, token: string): Promise<{ success: boolean; data: { id: number; status: string } }> {
  const p = fetchJsonAuth<{ success: boolean; data: { id: number; status: string } }>(`/api/vaults/withdraw/${id}`, token, { method: 'DELETE' });
  void p.then(() => bumpApiCache());
  return p;
}

export interface PartnerMe {
  handle: string;
  payoutWallet: string | null;
  payoutWalletVerified: boolean;
  pools: { id: number; name: string; kind: string; status: string; listing: string; navSol: number; maxSlots: number; maxTraders: number; rulesJson: Record<string, number> | null }[];
  fees: { pendingSol: number; claimableSol: number; paidSol: number; nextCheckpointAt: string | null; byPool: { vaultId: number; kind: string; claimableSol: number; paidSol: number }[] };
  basket: { wallet: string; handle: string; rank: number | null; ranks: { h24: number | null; d7: number | null; d30: number | null }; inBasket: boolean; note: string }[];
  requests: { id: number; vaultId: number; fomoHandle: string; status: string }[];
}

export function partnerApply(input: { fomoHandle: string; xHandle?: string; wallet: string; contact: string }): Promise<{ success: boolean; data: { id: number; status: string } }> {
  return fetchJson('/api/partner/apply', { method: 'POST', body: JSON.stringify(input) });
}

export function partnerApplyStatus(wallet: string): Promise<{ success: boolean; data: { status: string | null } }> {
  return fetchJson(`/api/partner/apply/status?wallet=${encodeURIComponent(wallet)}`);
}

export function partnerMe(token: string): Promise<{ success: boolean; data: PartnerMe }> {
  return fetchJsonAuth('/api/partner/me', token);
}

/** Live WSOL price in USD (public proxy, best-effort — null when offline). */
export async function getSolPriceUsd(): Promise<number | null> {
  try {
    const r = await fetchJson<{ success: boolean; data: Record<string, number> }>(
      '/api/market/prices?mints=So11111111111111111111111111111111111111112',
    );
    const px = r.data['So11111111111111111111111111111111111111112'];
    return typeof px === 'number' && px > 0 ? px : null;
  } catch {
    return null;
  }
}

export function partnerPayoutChallenge(token: string, wallet: string): Promise<{ success: boolean; data: { wallet: string; nonce: string; message: string; expiresAt: string } }> {
  return fetchJsonAuth('/api/partner/payout-wallet/challenge', token, { method: 'POST', body: JSON.stringify({ wallet }) });
}

export function partnerSetPayoutWallet(token: string, wallet: string, signature: string): Promise<{ success: boolean; data: { payoutWallet: string } }> {
  return fetchJsonAuth('/api/partner/payout-wallet', token, { method: 'POST', body: JSON.stringify({ wallet, signature }) });
}

export function partnerClaim(token: string): Promise<{ success: boolean; data: { claimedSol: number; rows: number } }> {
  const p = fetchJsonAuth<{ success: boolean; data: { claimedSol: number; rows: number } }>('/api/partner/claim', token, { method: 'POST' });
  void p.then(() => bumpApiCache());
  return p;
}

export function partnerPoolTraders(token: string, poolId: number): Promise<{ success: boolean; total: number; data: { wallet: string; handle: string; isActive: boolean; weightBps: number; signals7d: number; profitUsd: number; feeSol: number }[] }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/traders`, token);
}

export interface VaultOrderJourney {
  id: number;
  token: string;
  trader: string;
  status: string;
  error: string | null;
  masterTxHash: string | null;
  createdAt: string;
  qualify: { pass: boolean; score: number | null; reasons: string[] } | null;
  entry: { priceUsd: number | null; amountUsd: number; tp1Pct: number | null; stopPct: number | null; trailPct: number | null; entryMode: string | null; venue: string | null; sizedCopyUsd: number | null };
  legs: { leg: string; fraction: number; exitPriceUsd: number | null; realizedPnlUsd: number | null; closedAt: string | null }[];
  closeReason: string | null;
  exitPriceUsd: number | null;
  realizedPnlUsd: number | null;
  closedAt: string | null;
}

export function vaultOrders(token: string, poolId: number): Promise<{ success: boolean; total: number; data: VaultOrderJourney[] }> {
  return fetchJsonAuth(`/api/vaults/${poolId}/orders`, token);
}

export function partnerUpdateSettings(token: string, poolId: number, patch: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/settings`, token, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function partnerPauseTrader(token: string, poolId: number, wallet: string, active: boolean): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/traders/${encodeURIComponent(wallet)}/pause`, token, { method: 'POST', body: JSON.stringify({ active }) });
}

/** Permanently remove a trader from the pool (owner). Undo = pause with active:true. */
export function partnerRemoveTrader(token: string, poolId: number, wallet: string): Promise<{ success: boolean; data: unknown }> {
  return fetchJsonAuth(`/api/partner/pools/${poolId}/traders/${encodeURIComponent(wallet)}`, token, { method: 'DELETE' });
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
  depositor?: string;
  amountSol: number;
  vaultId?: number;
  message?: string;
  signature?: string;
}, token: string): Promise<{ success: boolean; data: { id: number; status: string; signedWallet?: string | null; sharesMinted?: number; sharePrice?: number; epochId?: number } }> {
  const init = { method: 'POST', body: JSON.stringify(input) };
  const p = fetchJsonAuth<{ success: boolean; data: { id: number; status: string; signedWallet?: string | null; sharesMinted?: number; sharePrice?: number; epochId?: number } }>('/api/vaults/deposit', token, init);
  void p.then(() => bumpApiCache());
  return p;
}

export function requestVaultWithdraw(input: {
  depositor?: string;
  shares: number;
  vaultId?: number;
  message?: string;
  signature?: string;
}, token: string): Promise<{ success: boolean; data: { id: number; status: string; signedWallet?: string | null; payoutSol?: number; sharePrice?: number; epochId?: number } }> {
  const init = { method: 'POST', body: JSON.stringify(input) };
  const p = fetchJsonAuth<{ success: boolean; data: { id: number; status: string; signedWallet?: string | null; payoutSol?: number; sharePrice?: number; epochId?: number } }>('/api/vaults/withdraw', token, init);
  void p.then(() => bumpApiCache());
  return p;
}

/** Devnet SOL faucet for chain testing (P3) — auth required, 1 grant/24h/user. */
export function chainFaucet(token: string, input: { address: string; amountSol?: number }): Promise<{
  success: boolean;
  data: { signature: string; address: string; amountSol: number };
}> {
  return fetchJsonAuth('/api/chain/faucet', token, { method: 'POST', body: JSON.stringify(input) });
}

export function depositChallenge(
  input: { vaultId?: number; amountSol: number; wallet: string },
  token: string,
): Promise<{ success: boolean; data: { message: string; nonce: string; expiresAt: string } }> {
  return fetchJsonAuth('/api/vaults/deposit/challenge', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function withdrawChallenge(
  input: { vaultId?: number; shares: number; wallet: string },
  token: string,
): Promise<{ success: boolean; data: { message: string; nonce: string; expiresAt: string } }> {
  return fetchJsonAuth('/api/vaults/withdraw/challenge', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
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
  source?: 'fomo' | 'local';
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
  window.dispatchEvent(new Event('edgepool:session'));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event('edgepool:session'));
}

/** Synchronous profile snapshot for instant UI (wallet label without flash).
 * Never trusted for auth — always re-validated via getAuthMe/restoreSession. */
export function getCachedProfile(): { wallet: string; username?: string | null; role: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSessionData;
    if (!parsed.token || !parsed.user?.wallet) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return { wallet: parsed.user.wallet, username: parsed.user.username ?? null, role: parsed.user.role };
  } catch {
    return null;
  }
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

export interface DemoScenarioCase {
  ok: boolean;
  name: string;
  vaultId?: number;
  botId?: number;
  signals?: number;
  fired?: number;
  failed?: number;
  settleNavSol?: number;
  withdrawal?: { id: number; status: string; pending: boolean; message: string } | null;
  error?: string;
}

export interface DemoScenarioResult {
  cleaned: { vaults: number; bots: number; orders: number };
  cases: DemoScenarioCase[];
  environment: 'sandbox';
}

/** One-click stage demo: reset + 3 parallel cases (ADMIN). */
export function runDemoScenario(token: string): Promise<{ success: boolean; data: DemoScenarioResult }> {
  return fetchJsonAuth('/api/demo/scenario', token, { method: 'POST' });
}

/** Delete demo pools + orders, keep audit (ADMIN). */
export function resetDemo(token: string): Promise<{ success: boolean; data: unknown }> {
  const p = fetchJsonAuth<{ success: boolean; data: unknown }>('/api/demo/reset', token, { method: 'POST' });
  void p.then(() => bumpApiCache());
  return p;
}

export interface DemoSeedResult {
  vaultId: number;
  botId: number;
  traders: string[];
  depositSol: number;
  sharePrice: number;
  environment: 'sandbox';
}

/** Seed one demo pool (ADMIN). Used by the pool-detail demo console. */
export function seedDemo(token: string, opts: { name?: string; depositSol?: number; traderCount?: number }): Promise<{ success: boolean; data: DemoSeedResult }> {
  const p = fetchJsonAuth<{ success: boolean; data: DemoSeedResult }>('/api/demo/seed', token, { method: 'POST', body: JSON.stringify(opts) });
  void p.then(() => bumpApiCache());
  return p;
}

export interface DemoReplayResult {
  vaultId: number;
  botId: number;
  signals: number;
  fired: number;
  failed: number;
  skipped?: number;
  orderIds: number[];
  forceClosed: number;
  skippedClose?: boolean;
  deposit2?: number;
  settleNavSol?: number | null;
  withdrawal?: { id: number; status: string; pending: boolean; message: string } | null;
  environment: 'sandbox';
}

/** Replay real BUYs into one demo pool (ADMIN). */
export function replayDemo(token: string, opts: { vaultId?: number; botId?: number; days?: number; limit?: number; skipClose?: boolean }): Promise<{ success: boolean; data: DemoReplayResult }> {
  const p = fetchJsonAuth<{ success: boolean; data: DemoReplayResult }>('/api/demo/replay', token, { method: 'POST', body: JSON.stringify(opts) });
  void p.then(() => bumpApiCache());
  return p;
}

export interface DemoPartialCloseResult {
  orderId: number;
  leg: string;
  fraction: number;
  exitPriceUsd: number;
  realizedPnlUsd: number;
  remaining: number;
  closed: boolean;
  solPx: number;
  environment: 'sandbox';
}

/** Partial exit at the live price, demo vaults only (ADMIN). */
export function partialCloseDemo(token: string, opts: { vaultId: number; orderId?: number; fraction?: number }): Promise<{ success: boolean; data: DemoPartialCloseResult }> {
  const p = fetchJsonAuth<{ success: boolean; data: DemoPartialCloseResult }>('/api/demo/partial-close', token, { method: 'POST', body: JSON.stringify(opts) });
  void p.then(() => bumpApiCache());
  return p;
}

/** Clone a pool's trader set into an unlisted demo sandbox (ADMIN). */
export function cloneDemo(token: string, vaultId: number): Promise<{ success: boolean; data: { vaultId: number; botId: number; sourceVaultId: number; traders: string[] } }> {
  const p = fetchJsonAuth<{ success: boolean; data: { vaultId: number; botId: number; sourceVaultId: number; traders: string[] } }>('/api/demo/clone', token, { method: 'POST', body: JSON.stringify({ vaultId }) });
  void p.then(() => bumpApiCache());
  return p;
}

/** Manual epoch settle (ADMIN). */
export function settleVault(token: string, vaultId: number, navSol: number): Promise<{ success: boolean; data: { epochId: number; navSol: number; sharePrice: number; sharesOutstanding: number; feeSol: number; settledDeposits: { id: number; shares: number }[]; settledWithdrawals: { id: number; payoutSol: number }[] } }> {
  const p = fetchJsonAuth<{ success: boolean; data: { epochId: number; navSol: number; sharePrice: number; sharesOutstanding: number; feeSol: number; settledDeposits: { id: number; shares: number }[]; settledWithdrawals: { id: number; payoutSol: number }[] } }>('/api/vaults/settle', token, { method: 'POST', body: JSON.stringify({ vaultId, navSol }) });
  void p.then(() => bumpApiCache());
  return p;
}
