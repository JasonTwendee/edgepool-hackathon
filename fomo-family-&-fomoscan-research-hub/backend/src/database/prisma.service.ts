import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { getConfig } from '../config/configuration.js';

/**
 * Postgres access via Prisma 7 + pg adapter.
 * Connection string is built from the same POSTGRES_* vars as
 * prisma.config.ts (single source) — optional DATABASE_URL wins in both.
 * tsx-safe: no decorator metadata needed (@Inject at injection sites).
 */
function buildAdapter(): PrismaPg {
  if (process.env.DATABASE_URL) return new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const db = getConfig().db;
  const auth = `${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}`;
  return new PrismaPg({
    connectionString: `postgresql://${auth}@${db.host}:${db.port}/${db.name}`,
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: buildAdapter() });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
