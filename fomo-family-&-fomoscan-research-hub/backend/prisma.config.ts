import { defineConfig } from "prisma/config";

/**
 * Single DB-url source for the Prisma CLI (migrate/generate/studio).
 * Runtime (NestJS) builds the same URL from POSTGRES_* via getConfig()
 * — see src/database/prisma.service.ts. Optional DATABASE_URL override
 * wins in both paths, so only ONE place needs to agree with docker-compose.
 */
function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5433";
  const user = encodeURIComponent(process.env.POSTGRES_USER || "fomo");
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD || "fomo");
  const db = process.env.POSTGRES_DB || "fomo_dev";
  return `postgresql://${user}:${password}@${host}:${port}/${db}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: dbUrl(),
  },
});
