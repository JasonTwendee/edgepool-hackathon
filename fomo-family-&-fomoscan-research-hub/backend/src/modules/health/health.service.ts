import { Inject, Injectable } from '@nestjs/common';
import { getConfig } from '../../config/configuration.js';
import { isHeliusEnabled, maskSensitiveUrl } from '../../config/solana.config.js';
import { SolanaOnChainListenerService } from '../../server/solana.service.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(SolanaOnChainListenerService)
    private readonly solana: SolanaOnChainListenerService,
  ) {}

  check() {
    const cfg = getConfig();
    return {
      status: 'ONLINE',
      service: 'FOMO-Wallet-Tracker-OnChain-Engine',
      rpcEndpoint: maskSensitiveUrl(cfg.solanaRpcUrl),
      heliusEnabled: isHeliusEnabled(),
      activeWalletsCount: this.solana.getTrackedWallets().length,
      timestamp: new Date().toISOString(),
    };
  }
}
