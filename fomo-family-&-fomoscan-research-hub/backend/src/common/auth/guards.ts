import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';

export interface AuthedUser {
  id: number;
  wallet: string;
  role: string;
}

/** Required roles for a route. No metadata = public route. */
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata('roles', roles) as MethodDecorator & ClassDecorator;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Session cookie name (httpOnly, set by POST /api/auth/verify). */
export const SESSION_COOKIE = 'fomo_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

/**
 * Session token extraction: Authorization Bearer first, httpOnly cookie second.
 * Dual support keeps scripts/smoke (Bearer) working while browsers use cookies.
 */
export function extractSessionToken(req: {
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    if (raw) return raw;
  }
  const cookieHeader = req.headers?.cookie;
  const fromCookie = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : undefined)[SESSION_COOKIE];
  return fromCookie ?? '';
}

/** Build/clear Set-Cookie values (pure — unit tested). Secure only behind https. */
export function buildSessionCookie(token: string, secure = process.env.COOKIE_SECURE === '1'): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = process.env.COOKIE_SECURE === '1'): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function unauthorized(message: string): never {
  throw new UnauthorizedException({ success: false, message });
}

function forbidden(message: string): never {
  throw new ForbiddenException({ success: false, message });
}

/**
 * Bearer session guard. Attaches `{id, wallet, role}` to `req.user`.
 * Missing/invalid/expired token → 401 envelope.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as {
      headers?: Record<string, string | string[] | undefined>;
      user?: AuthedUser;
    };
    const raw = extractSessionToken(req);
    if (!raw) unauthorized('Thiếu Bearer token. Đăng nhập ví qua POST /api/auth/verify.');
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });
    if (!row?.user) unauthorized('Session không hợp lệ. Đăng nhập lại.');
    if (row.expiresAt.getTime() <= Date.now()) unauthorized('Session đã hết hạn. Đăng nhập lại.');
    req.user = { id: row.user.id, wallet: row.user.wallet, role: row.user.role };
    return true;
  }
}

/**
 * Optional session attach for legacy public routes (deposit/withdraw stay public
 * this slice for demo compat): sets `req.user` when a valid Bearer token is
 * present, otherwise leaves the request anonymous — never rejects.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as {
      headers?: Record<string, string | string[] | undefined>;
      user?: AuthedUser;
    };
    const raw = extractSessionToken(req);
    if (!raw) return true;
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });
    if (row?.user && row.expiresAt.getTime() > Date.now()) {
      req.user = { id: row.user.id, wallet: row.user.wallet, role: row.user.role };
    }
    return true;
  }
}

/**
 * Role gate — must run AFTER AuthGuard (reads `req.user`).
 * Route without @Roles(...) stays public.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest() as { user?: AuthedUser };
    if (!req.user) unauthorized('Yêu cầu đăng nhập.');
    if (!required.includes(req.user.role)) {
      forbidden(`Quyền ${req.user.role} không được phép. Yêu cầu: ${required.join(',')}.`);
    }
    return true;
  }
}
