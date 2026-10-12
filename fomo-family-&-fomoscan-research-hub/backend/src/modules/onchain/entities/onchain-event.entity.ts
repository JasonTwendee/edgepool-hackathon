/** Canonical ledger row. Mirrors openapi.yaml#OnChainTransactionEvent. */
export interface CopySignal {
  canCopy: boolean;
  recommendedVenue: 'Phoenix CLOB' | 'Titan Meta-DEX';
  estimatedDelayMs: number;
  targetSwapAmountUsd: number;
}

export type DexVenue =
  | 'Phoenix CLOB'
  | 'Titan Meta-DEX'
  | 'Raydium AMM'
  | 'Orca Whirlpool'
  | 'Pump.fun'
  | 'Solana Native'
  | 'Jupiter Aggregator';

export type EventSource = 'rpc' | 'helius' | 'rpc-parser';

export interface OnChainTransactionEvent {
  signature: string;
  slot: number;
  blockTime: number;
  formattedTime: string;
  wallet: string;
  walletName?: string;
  /** Provenance: 'rpc' = real signature, heuristic fields; 'helius' = parsed real data. */
  source: EventSource;
  action: 'BUY' | 'SELL' | 'TRANSFER' | 'UNKNOWN';
  symbol: string;
  tokenMint?: string;
  amountToken?: number;
  amountUsd?: number;
  dexVenue: DexVenue;
  slippageBps: number;
  status: 'SUCCESS' | 'FAILED';
  feeSol: number;
  rawLogs?: string[];
  copySignal: CopySignal;
}

export type SseEventType = 'CONNECTED' | 'ONCHAIN_SWAP_EVENT';
