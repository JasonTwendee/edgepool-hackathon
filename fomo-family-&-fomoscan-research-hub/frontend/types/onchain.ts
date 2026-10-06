// Canonical FE contracts — mirror backend entities + openapi.yaml schemas.
// Do not drift: update together with backend/src/modules/*/entities + docs/api/openapi.yaml.
export interface TrackedWallet {
  address: string;
  label: string;
  handle: string;
  avatar?: string;
  totalPnlUsd?: number;
  winRate?: number;
  isCopyEnabled: boolean;
  isActive?: boolean;
  bio?: string | null;
  evmAddress?: string | null;
  fomoPnlUsd?: number | null;
  fomoRank?: number | null;
  allocationWeight: number;
  addedAt: string;
}

export interface CopySignal {
  canCopy: boolean;
  recommendedVenue: 'Phoenix CLOB' | 'Titan Meta-DEX';
  estimatedDelayMs: number;
  targetSwapAmountUsd: number;
}

export interface OnChainTransactionEvent {
  signature: string;
  slot: number;
  blockTime: number;
  formattedTime: string;
  wallet: string;
  walletName?: string;
  /** 'rpc' = real signature, heuristic fields; 'helius' = parsed real data. */
  source: 'rpc' | 'helius';
  action: 'BUY' | 'SELL' | 'TRANSFER' | 'UNKNOWN';
  symbol: string;
  tokenMint?: string;
  amountToken?: number;
  amountUsd?: number;
  dexVenue: 'Phoenix CLOB' | 'Titan Meta-DEX' | 'Raydium AMM' | 'Orca Whirlpool' | 'Pump.fun' | 'Solana Native' | 'Jupiter Aggregator';
  slippageBps: number;
  status: 'SUCCESS' | 'FAILED';
  feeSol: number;
  rawLogs?: string[];
  copySignal: CopySignal;
}

export type CopyOrderStatus = 'PENDING' | 'QUATED' | 'SENT' | 'CONFIRMED' | 'FAILED';

/** Mirrors Prisma CopyOrder + openapi.yaml#CopyOrder. */
export interface CopyOrder {
  id: number;
  masterWallet?: string;
  masterHandle?: string;
  masterTxHash?: string;
  symbol?: string;
  action?: string;
  tokenMint?: string;
  amountUsd?: number;
  venue?: string;
  mode: 'paper';
  status: CopyOrderStatus;
  devnetSignature?: string;
  error?: string;
  entryMode?: string;
  delayDragPct?: number;
  tp1Pct?: number;
  stopPct?: number;
  entryPriceUsd?: number;
  closeReason?: string;
  realizedPnlUsd?: number;
  createdAt: string;
}

export interface ExecutePaperInput {
  masterTxHash?: string;
  symbol?: string;
  action?: string;
  tokenMint?: string;
  amountUsd?: number;
  venue?: string;
  masterWallet?: string;
  masterHandle?: string;
  mode: 'paper';
  confirm: true;
  maxSlippageBps?: number;
  paperAmountSol?: number;
  entryMode?: 'immediate' | 'scaled' | 'patient';
  tp1Pct?: number;
  stopPct?: number;
}

export interface CopyHistoryResponse {
  success: boolean;
  total: number;
  data: CopyOrder[];
}
