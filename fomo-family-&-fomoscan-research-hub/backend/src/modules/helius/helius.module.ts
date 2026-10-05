import { Global, Module } from '@nestjs/common';
import { EnrichService } from './enrich.service.js';
import { HeliusService } from './helius.service.js';

@Global()
@Module({
  providers: [HeliusService, EnrichService],
  exports: [HeliusService, EnrichService],
})
export class HeliusModule {}
