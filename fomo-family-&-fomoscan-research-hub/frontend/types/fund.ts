/**
 * Fund (roles/auth/vaults/bots) shared shapes — mirrors docs/api/openapi.yaml.
 * Auth session is a client-side wrapper (token never leaves localStorage except
 * as an Authorization header).
 */

export interface FundUser {
  id: number;
  wallet: string;
  role: 'USER' | 'KOL' | 'ADMIN';
  username?: string | null;
  email?: string | null;
  createdAt?: string;
}

export interface AuthNonce {
  wallet: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface AuthSessionData {
  token: string;
  user: FundUser;
  expiresAt: string;
}

export interface FundSession {
  token: string;
  user: FundUser;
  expiresAt: string;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  target?: string | null;
  reason?: string | null;
  metaJson?: unknown;
  createdAt: string;
}

export interface VaultTrader {
  id: number;
  vaultId: number;
  wallet: string;
  weightBps: number;
  isActive: boolean;
  createdAt: string;
  enteredAt?: string | null;
  exitedAt?: string | null;
  entrySnapshot?: unknown;
  exitReason?: string | null;
}

export interface VaultPolicy {
  reserveBps: number;
  withdrawFeeBps: number;
  lockHours: number;
}

/** On-chain vault info (P3) — present only when the pool is chain-bound. */
export interface ChainVaultInfo {
  programId: string | null;
  vault: string;
  price: number | null;
  marks: number;
  paused: boolean | null;
  env: string;
  explorerUrl: string;
}

export interface VaultWithTraders {
  id: number;
  name: string;
  environment: string;
  feeBps?: number;
  totalShares?: number;
  traders: VaultTrader[];
}

export interface Bot {
  id: number;
  name: string;
  mode: 'AUTO' | 'PAUSED';
  vaultId?: number | null;
  status: string;
  createdAt: string;
  environment?: string;
}

export interface AutoFireTickResult {
  scanned: number;
  fired: number;
  skippedNoScope: number;
  skippedDedupe: number;
  skippedBeforeEntry?: number;
  blocked: number;
  errors: number;
  orderIds: number[];
  note?: string;
  environment?: string;
}
