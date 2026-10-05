import { Global, Module } from '@nestjs/common';
import { SolanaStreamService } from './solana-stream.service.js';
import { SolanaOnChainListenerService } from './solana.service.js';

/**
 * Global chain-transport module: registry + WS stream share one connection
 * and must NOT be duplicated per feature module.
 */
@Global()
@Module({
  providers: [SolanaOnChainListenerService, SolanaStreamService],
  exports: [SolanaOnChainListenerService, SolanaStreamService],
})
export class SolanaModule {}
