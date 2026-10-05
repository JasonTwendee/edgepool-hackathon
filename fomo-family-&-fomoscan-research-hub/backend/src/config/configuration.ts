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

export interface BackendConfig {
  port: number;
  solanaRpcUrl: string;
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
  db: DbConfig;
}

export function getConfig(): BackendConfig {
  return {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
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
