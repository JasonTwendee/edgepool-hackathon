/**
 * Seed 3 credential accounts: ADMIN + USER + KOL (idempotent).
 * Run: `npx tsx src/modules/auth/seed-accounts.ts` with env:
 *   SEED_ADMIN_USER / SEED_ADMIN_PASSWORD / SEED_ADMIN_EMAIL?
 *   SEED_USER_USER  / SEED_USER_PASSWORD  / SEED_USER_EMAIL?
 *   SEED_KOL_USER   / SEED_KOL_PASSWORD   / SEED_KOL_EMAIL?
 *   + DB vars (DATABASE_URL wins, else POSTGRES_* — same rule as PrismaService).
 * Existing usernames are UPDATED (password reset + role enforced); missing ones
 * are CREATED via the same `cred:<username>` wallet convention as AuthService.
 * Passwords are NEVER printed — only username/role/created-or-updated.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { getConfig } from '../../config/configuration.js';
import { hashPassword, validateCredentials } from '../../common/auth/password.js';

function buildClient(): PrismaClient {
  if (process.env.DATABASE_URL) {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  const db = getConfig().db;
  const auth = `${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}`;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: `postgresql://${auth}@${db.host}:${db.port}/${db.name}` }),
  });
}

function required(name: string): string {
  const v = (process.env[name] ?? '').trim();
  if (!v) {
    console.error(`Missing required env ${name} (refusing to seed with empty credential).`);
    process.exit(1);
  }
  return v;
}

async function upsert(
  prisma: PrismaClient,
  spec: { username: string; password: string; email?: string; role: 'USER' | 'KOL' | 'ADMIN' },
): Promise<'created' | 'updated'> {
  const invalid = validateCredentials({ username: spec.username, email: spec.email, password: spec.password });
  if (invalid) throw new Error(`Invalid seed credential for "${spec.username}": ${invalid}`);
  const email = spec.email?.trim() || null;
  if (email) {
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.username !== spec.username) {
      throw new Error(`Seed email "${email}" already belongs to "${clash.username}".`);
    }
  }
  const passwordHash = await hashPassword(spec.password);
  const existing = await prisma.user.findUnique({ where: { username: spec.username } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { email, passwordHash, role: spec.role },
    });
    return 'updated';
  }
  await prisma.user.create({
    data: {
      wallet: `cred:${spec.username}`,
      username: spec.username,
      email,
      passwordHash,
      role: spec.role,
    },
  });
  return 'created';
}

async function main(): Promise<void> {
  const specs = [
    {
      username: (process.env.SEED_ADMIN_USER ?? 'admin').trim(),
      password: required('SEED_ADMIN_PASSWORD'),
      email: (process.env.SEED_ADMIN_EMAIL ?? '').trim() || undefined,
      role: 'ADMIN' as const,
    },
    {
      username: (process.env.SEED_USER_USER ?? 'user').trim(),
      password: required('SEED_USER_PASSWORD'),
      email: (process.env.SEED_USER_EMAIL ?? '').trim() || undefined,
      role: 'USER' as const,
    },
    {
      username: (process.env.SEED_KOL_USER ?? 'kol').trim(),
      password: required('SEED_KOL_PASSWORD'),
      email: (process.env.SEED_KOL_EMAIL ?? '').trim() || undefined,
      role: 'KOL' as const,
    },
  ];
  const prisma = buildClient();
  try {
    for (const s of specs) {
      const result = await upsert(prisma, s);
      console.log(`seed account "${s.username}" role=${s.role}: ${result}`);
    }
    console.log('seed accounts: DONE');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error('SEED FAILED:', (e as Error).message ?? e);
  process.exit(1);
});
