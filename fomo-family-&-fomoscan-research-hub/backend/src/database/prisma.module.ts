import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Global Prisma client — one pool for the whole app. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
