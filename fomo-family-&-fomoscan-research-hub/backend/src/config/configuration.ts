/**
 * Single env entry-point for the backend (NestJS-spec: ConfigModule replacement).
 * All modules must import from here — never read process.env directly.
 * NOTE: never log the returned object (contains DB password / vault key).
 */
export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface ChainConfig {
  /** Master gate — mọi đường chain từ chối khi false. */
  enabled: boolean;
  /** devnet | mainnet. Faucet chỉ chạy ở devnet. */
  cluster: string;
  /** Program ID của edgepool-vault. */
  programId: string;
  /** Keeper keypair base58 (BE hot key). Local-only, không log. */
  keeperKey?: string;
  /** Marks cũ hơn số slot này bị coi là stale. */
  maxStaleSlots: number;
  /** Optional chain WS endpoint (FluxRPC: wss://ws.eu.fluxrpc.com?key=...). */
  wsUrl?: string;
  /** Polling fallback cadence for the indexer (ms). */
  pollMs: number;
  /** Jupiter swap API (dự phòng P4, chưa dùng). */
  jupiterSwapApiUrl: string;
  /** Luôn false cho tới khi có quyết định vốn thật + audit. */
  mainnetSwapEnabled: boolean;
}

export interface BackendConfig {
  port: number;
  solanaRpcUrl: string;
  /** Optional WS override for the main Solana connection (FluxRPC/Helius). */
  solanaWsUrl?: string;
  /** Lantern local cache (read-path only; WS stays on solanaRpcUrl). */
  lanternUrl?: string;
  heliusApiKey?: string;
  jitoBlockEngineUrl: string;
  /** Local-only execution key (devnet paper). Never logged. */
  vaultPrivateKey?: string;
  /** Paper-trade gate + safety rails (copy-trade module). */
  copyTradePaperEnabled: boolean;
  copyTradeMaxUsd: number;
  devnetRpcUrl: string;
  appUrl?: string;
  geminiApiKey?: string;
  chain: ChainConfig;
  db: DbConfig;
}

export function getConfig(): BackendConfig {
  return {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    solanaWsUrl: process.env.SOLANA_WS_URL || undefined,
    lanternUrl: process.env.LANTERN_URL || undefined,
    heliusApiKey: process.env.HELIUS_API_KEY || undefined,
    jitoBlockEngineUrl:
      process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf',
    vaultPrivateKey: process.env.VAULT_PRIVATE_KEY || undefined,
    copyTradePaperEnabled: process.env.COPY_TRADE_PAPER_ENABLED === 'true',
    copyTradeMaxUsd: process.env.COPY_TRADE_MAX_USD
      ? parseFloat(process.env.COPY_TRADE_MAX_USD)
      : 100,
    devnetRpcUrl: process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    appUrl: process.env.APP_URL || undefined,
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    chain: {
      enabled: process.env.CHAIN_ENABLED === 'true',
      cluster: process.env.CHAIN_CLUSTER || 'devnet',
      programId:
        process.env.CHAIN_PROGRAM_ID || '5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ',
      keeperKey: process.env.CHAIN_KEEPER_KEY || undefined,
      maxStaleSlots: process.env.CHAIN_MAX_STALE_SLOTS
        ? parseInt(process.env.CHAIN_MAX_STALE_SLOTS, 10)
        : 750,
      wsUrl: process.env.CHAIN_WS_URL || undefined,
      pollMs: process.env.CHAIN_POLL_MS ? Math.max(5000, parseInt(process.env.CHAIN_POLL_MS, 10)) : 60_000,
      jupiterSwapApiUrl: process.env.JUPITER_SWAP_API_URL || '',
      mainnetSwapEnabled: process.env.MAINNET_SWAP_ENABLED === 'true',
    },
    db: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5433,
      user: process.env.POSTGRES_USER || 'fomo',
      password: process.env.POSTGRES_PASSWORD || 'fomo',
      name: process.env.POSTGRES_DB || 'fomo_dev',
    },
  };
}

export function loadConfiguration(): BackendConfig {
  return getConfig();
}
