import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress, verifyEd25519Signature } from '../../common/auth/solana-verify.js';
import { hashPassword, validateCredentials, verifyPassword } from '../../common/auth/password.js';
import { hashToken } from '../../common/auth/guards.js';
import { UsersService } from '../users/users.service.js';

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Wallets allowed to bootstrap the FIRST admin (only when DB has no ADMIN yet). */
export function adminAllowlist(): string[] {
  return (process.env.ADMIN_WALLETS ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

export function loginMessage(wallet: string, nonce: string, expiresAt: Date): string {
  return `Sign to log in to FOMO Fund\nwallet: ${wallet}\nnonce: ${nonce}\nexpires: ${expiresAt.toISOString()}`;
}

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

function denied(message: string): never {
  throw new UnauthorizedException({ success: false, message });
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async issueNonce(wallet: string): Promise<{ wallet: string; nonce: string; message: string; expiresAt: string }> {
    const clean = (wallet ?? '').trim();
    try {
      decodeWalletAddress(clean);
    } catch {
      fail(`Địa chỉ ví Solana không hợp lệ: ${wallet}`);
    }
    const nonce = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await this.prisma.authNonce.create({ data: { wallet: clean, nonce, expiresAt } });
    return { wallet: clean, nonce, message: loginMessage(clean, nonce, expiresAt), expiresAt: expiresAt.toISOString() };
  }

  async verify(
    wallet: string,
    signature: string,
  ): Promise<{ token: string; user: { id: number; wallet: string; role: string }; expiresAt: string }> {
    const clean = (wallet ?? '').trim();
    const row = await this.prisma.authNonce.findFirst({
      where: { wallet: clean, consumedAt: null },
      orderBy: { id: 'desc' },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      denied('Nonce hết hạn hoặc không tồn tại. Lấy nonce mới qua POST /api/auth/nonce.');
    }
    const ok = verifyEd25519Signature(
      Buffer.from(loginMessage(clean, row.nonce, row.expiresAt), 'utf8'),
      (signature ?? '').trim(),
      clean,
    );
    if (!ok) denied('Chữ ký không hợp lệ.');
    await this.prisma.authNonce.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    const user = await this.users.findOrCreate(clean);
    // Bootstrap: first ADMIN comes from the local-only allowlist.
    if (user.role !== 'ADMIN' && (await this.users.countAdmins()) === 0 && adminAllowlist().includes(clean)) {
      const promoted = await this.users.setRole(clean, 'ADMIN');
      user.role = promoted.role;
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt } });
    return { token, user, expiresAt: expiresAt.toISOString() };
  }

  /** Logout: delete the session row so the token/cookie stops working. */
  async revoke(rawToken: string): Promise<{ revoked: boolean }> {
    const clean = (rawToken ?? '').trim();
    if (!clean) return { revoked: false };
    const gone = await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(clean) } });
    return { revoked: gone.count > 0 };
  }

  private async openSession(
    user: { id: number; wallet: string; role: string },
  ): Promise<{ token: string; user: { id: number; wallet: string; role: string }; expiresAt: string }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt } });
    return { token, user, expiresAt: expiresAt.toISOString() };
  }

  /** Credential register: always role USER (promotion is ADMIN-only). */
  async register(input: { username: string; email?: string; password: string }): Promise<{
    token: string;
    user: { id: number; wallet: string; role: string };
    expiresAt: string;
  }> {
    const invalid = validateCredentials(input);
    if (invalid) fail(invalid);
    const username = input.username.trim();
    const email = input.email?.trim() || null;
    const dupeUser = await this.prisma.user.findUnique({ where: { username } });
    if (dupeUser) fail('Username đã tồn tại.');
    if (email) {
      const dupeMail = await this.prisma.user.findUnique({ where: { email } });
      if (dupeMail) fail('Email đã tồn tại.');
    }
    try {
      const created = await this.prisma.user.create({
        data: {
          wallet: `cred:${username}`,
          username,
          email,
          passwordHash: await hashPassword(input.password),
          role: 'USER',
        },
      });
      return this.openSession({ id: created.id, wallet: created.wallet, role: created.role });
    } catch {
      fail('Username hoặc email đã tồn tại.');
    }
  }

  /** Credential login: uniform 401 (never reveal which field was wrong). */
  async login(input: { username: string; password: string }): Promise<{
    token: string;
    user: { id: number; wallet: string; role: string };
    expiresAt: string;
  }> {
    const found = await this.prisma.user.findUnique({ where: { username: (input.username ?? '').trim() } });
    const hash = (found?.passwordHash as string | null) ?? null;
    const ok = hash !== null && (await verifyPassword(input.password ?? '', hash));
    if (!found || !ok) denied('Sai tên đăng nhập hoặc mật khẩu.');
    return this.openSession({ id: found.id, wallet: found.wallet, role: found.role });
  }
}
