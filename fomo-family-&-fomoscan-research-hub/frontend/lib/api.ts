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

export function addWallet(input: {
  address: string;
  label?: string;
  handle?: string;
  allocationWeight?: number;
}): Promise<{ success: boolean; message?: string; data: TrackedWallet }> {
  return fetchJson('/api/wallets', { method: 'POST', body: JSON.stringify(input) });
}

export function removeWallet(address: string): Promise<{ success: boolean; message?: string }> {
  return fetchJson(`/api/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' });
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

export function queueVaultDeposit(input: {
  depositor: string;
  amountSol: number;
  vaultId?: number;
}): Promise<{ success: boolean; data: { id: number; status: string } }> {
  return fetchJson('/api/vaults/deposit', { method: 'POST', body: JSON.stringify(input) });
}

export function requestVaultWithdraw(input: {
  depositor: string;
  shares: number;
  vaultId?: number;
}): Promise<{ success: boolean; data: { id: number; status: string } }> {
  return fetchJson('/api/vaults/withdraw', { method: 'POST', body: JSON.stringify(input) });
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

export function registerAccount(input: {
  username: string;
  email?: string;
  password: string;
}): Promise<{ success: boolean; data: import('../types/fund').AuthSessionData }> {
  return fetchJson('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
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
