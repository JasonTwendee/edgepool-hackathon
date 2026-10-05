/**
 * Executable evidence for P1 (users + auth + guards + admin bootstrap).
 * Run: `npx tsx src/modules/auth/assert-auth.ts` (mocked DB, real node:crypto).
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { base58Decode, base58Encode, decodeWalletAddress, verifyEd25519Signature } from '../../common/auth/solana-verify.js';
import { AuthGuard, RolesGuard } from '../../common/auth/guards.js';
import { AuthService, loginMessage } from './auth.service.js';
import { UsersService } from '../users/users.service.js';

type Row = Record<string, unknown>;

function makeFake() {
  const db = { user: [] as Row[], nonce: [] as Row[], session: [] as Row[] };
  let seq = 0;
  const nid = (): number => {
    seq += 1;
    return seq;
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (v !== null && typeof v === 'object') return true; // skip complex filters in fake
      return r[k] === v;
    });
  const users = {
    findUnique: async ({ where }: { where: Row }) => db.user.find((r) => match(r, where)) ?? null,
    findMany: async () => [...db.user],
    create: async ({ data }: { data: Row }) => {
      const r = { id: nid(), role: 'USER', ...data };
      db.user.push(r);
      return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = db.user.find((x) => match(x, where)) as Row;
      Object.assign(r, data);
      return r;
    },
    count: async ({ where }: { where?: Row } = {}) =>
      where ? db.user.filter((r) => match(r, where)).length : db.user.length,
  };
  const authNonce = {
    create: async ({ data }: { data: Row }) => {
      const r = { id: nid(), consumedAt: null, ...data };
      db.nonce.push(r);
      return r;
    },
    findFirst: async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
      const rows = db.nonce.filter((r) => match(r, where));
      if (orderBy && 'id' in orderBy) rows.sort((a, b) => (a.id as number) - (b.id as number));
      return rows[rows.length - 1] ?? null;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = db.nonce.find((x) => match(x, where)) as Row;
      Object.assign(r, data);
      return r;
    },
  };
  const session = {
    create: async ({ data }: { data: Row }) => {
      const r = { id: nid(), ...data };
      db.session.push(r);
      return r;
    },
    findUnique: async ({ where }: { where: Row }) => {
      const r = db.session.find((x) => match(x, where));
      if (!r) return null;
      return { ...r, user: db.user.find((u) => u.id === r.userId) ?? null };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const before = db.session.length;
      db.session = db.session.filter((x) => !match(x, where));
      return { count: before - db.session.length };
    },
  };
  return { user: users, authNonce, session } as never;
}

function ctxOf(req: Row, handler: unknown, cls: unknown): never {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as never;
}

/** Run a throwing call, return its Nest HTTP status (asserts the 401/403 contract). */
async function statusOf(fn: () => Promise<unknown> | unknown): Promise<number> {
  try {
    await fn();
  } catch (e) {
    const st = (e as { getStatus?: () => number }).getStatus?.();
    assert.ok(typeof st === 'number', `expected HttpException, got: ${(e as Error).message}`);
    return st;
  }
  assert.fail('expected HttpException, call succeeded');
}

async function main(): Promise<void> {
  // 1. Codec: roundtrip + validation.
  const raw = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  assert.equal(base58Decode(base58Encode(raw)).toString('hex'), raw.toString('hex'));
  assert.equal(decodeWalletAddress(base58Encode(raw)).length, 32);
  assert.throws(() => decodeWalletAddress('not-a-wallet!!'), /không hợp lệ|Invalid/);
  assert.throws(() => decodeWalletAddress(base58Encode(Buffer.from([1, 2, 3]))), /không hợp lệ/);

  // 2. Ed25519 sign/verify with real crypto.
  const kp = generateKeyPairSync('ed25519');
  const pubRaw = kp.publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
  const wallet = base58Encode(pubRaw);
  const msg = Buffer.from('hello-fund', 'utf8');
  const sig = base58Encode(sign(null, msg, kp.privateKey));
  assert.equal(verifyEd25519Signature(msg, sig, wallet), true);
  assert.equal(verifyEd25519Signature(Buffer.from('tampered', 'utf8'), sig, wallet), false);
  assert.equal(verifyEd25519Signature(msg, base58Encode(Buffer.alloc(64, 7)), wallet), false);
  assert.equal(verifyEd25519Signature(msg, '!!!', wallet), false);

  const fake = makeFake();
  const users = new UsersService(fake);
  const auth = new AuthService(fake, users);
  const signMsg = (m: Buffer): string => base58Encode(sign(null, m, kp.privateKey));

  // 3. Nonce: invalid wallet rejected; valid returns signable message.
  await assert.rejects(() => auth.issueNonce('bad'), /không hợp lệ/);
  const n1 = await auth.issueNonce(wallet);
  assert.ok(n1.message.includes(n1.nonce) && n1.message.includes(wallet));

  // 4. Verify happy path → USER session.
  const v1 = await auth.verify(wallet, signMsg(Buffer.from(n1.message, 'utf8')));
  assert.equal(v1.user.role, 'USER');
  assert.equal(v1.token.length, 64);

  // 5. Replay of the same nonce → 401 (consumed).
  assert.equal(
    await statusOf(() => auth.verify(wallet, signMsg(Buffer.from(n1.message, 'utf8')))),
    401,
  );

  // 6. Wrong signature → 401.
  const n2 = await auth.issueNonce(wallet);
  void n2;
  assert.equal(await statusOf(() => auth.verify(wallet, base58Encode(Buffer.alloc(64, 9)))), 401);

  // 7. Bootstrap: allowlisted wallet becomes ADMIN when no admin exists.
  // (DB currently has zero ADMINs: v1.user is USER.)
  const kp2 = generateKeyPairSync('ed25519');
  const adminWallet = base58Encode(kp2.publicKey.export({ format: 'der', type: 'spki' }).slice(-32));
  const signAdmin = (m: Buffer): string => base58Encode(sign(null, m, kp2.privateKey));
  process.env.ADMIN_WALLETS = adminWallet;
  const na = await auth.issueNonce(adminWallet);
  const va = await auth.verify(adminWallet, signAdmin(Buffer.from(na.message, 'utf8')));
  assert.equal(va.user.wallet, adminWallet);
  assert.equal(va.user.role, 'ADMIN');
  // Second allowlisted wallet is NOT bootstrapped once an ADMIN exists.
  const kp3 = generateKeyPairSync('ed25519');
  const otherWallet = base58Encode(kp3.publicKey.export({ format: 'der', type: 'spki' }).slice(-32));
  process.env.ADMIN_WALLETS = otherWallet;
  const no = await auth.issueNonce(otherWallet);
  const vo = await auth.verify(
    otherWallet,
    base58Encode(sign(null, Buffer.from(no.message, 'utf8'), kp3.privateKey)),
  );
  assert.equal(vo.user.role, 'USER');
  delete process.env.ADMIN_WALLETS;

  // 8. AuthGuard matrix.
  const guard = new AuthGuard(fake);
  assert.equal(await statusOf(() => guard.canActivate(ctxOf({ headers: {} }, () => 0, class A {}))), 401);
  assert.equal(
    await statusOf(() =>
      guard.canActivate(ctxOf({ headers: { authorization: 'Bearer nope' } }, () => 0, class A {})),
    ),
    401,
  );
  const reqOk: Row = { headers: { authorization: `Bearer ${v1.token}` } };
  assert.equal(await guard.canActivate(ctxOf(reqOk, () => 0, class A {})), true);
  assert.equal((reqOk.user as Row).wallet, wallet);

  // 9. RolesGuard matrix.
  const rg = new RolesGuard(new Reflector());
  const openHandler = (): number => 0;
  assert.equal(rg.canActivate(ctxOf({ user: { role: 'USER' } }, openHandler, class B {})), true);
  const adminHandler = (): number => 0;
  Reflect.defineMetadata('roles', ['ADMIN'], adminHandler);
  assert.equal(
    await statusOf(() => rg.canActivate(ctxOf({ user: { role: 'USER' } }, adminHandler, class B {}))),
    403,
  );
  assert.equal(rg.canActivate(ctxOf({ user: { role: 'ADMIN' } }, adminHandler, class B {})), true);
  assert.equal(await statusOf(() => rg.canActivate(ctxOf({}, adminHandler, class B {}))), 401);

  // 10. UsersService boundaries.
  await assert.rejects(() => users.setRole(wallet, 'SUPER'), /Role không hợp lệ/);
  await assert.rejects(() => users.setRole(base58Encode(Buffer.alloc(32, 5)), 'KOL'), /không tồn tại/);

  // 11. Cookie transport: guard accepts httpOnly cookie; Bearer wins on conflict;
  // builders emit correct flags; revoke kills the session.
  const { extractSessionToken, buildSessionCookie, clearSessionCookie } = await import(
    '../../common/auth/guards.js'
  );
  assert.equal(extractSessionToken({ headers: {} }), '');
  assert.equal(
    extractSessionToken({ headers: { cookie: `a=1; fomo_session=${v1.token}; b=2` } }),
    v1.token,
  );
  assert.equal(
    extractSessionToken({ headers: { authorization: 'Bearer ABC', cookie: `fomo_session=${v1.token}` } }),
    'ABC',
  );
  const setCookie = buildSessionCookie('T', false);
  assert.ok(setCookie.startsWith('fomo_session=T;') && setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax') && !setCookie.includes('Secure'));
  assert.ok(buildSessionCookie('T', true).includes('; Secure'));
  assert.ok(clearSessionCookie(false).includes('Max-Age=0'));
  const reqCookie: Row = { headers: { cookie: `fomo_session=${v1.token}` } };
  assert.equal(await guard.canActivate(ctxOf(reqCookie, () => 0, class A {})), true);
  assert.equal((reqCookie.user as Row).wallet, wallet);
  const revoked = await auth.revoke(v1.token);
  assert.equal(revoked.revoked, true);
  assert.equal(await statusOf(() => guard.canActivate(ctxOf(reqCookie, () => 0, class A {}))), 401);
  assert.equal((await auth.revoke('nope')).revoked, false);

  // 12. Credential auth: validation + scrypt + register/login.
  const { validateCredentials, hashPassword, verifyPassword } = await import(
    '../../common/auth/password.js'
  );
  assert.equal(validateCredentials({ username: 'alice_01', password: 's3cret!!' }), null);
  assert.ok((validateCredentials({ username: 'ab', password: 's3cret!!' }) ?? '').includes('Username'));
  assert.ok((validateCredentials({ username: 'alice_01', password: 'short' }) ?? '').includes('8 ký tự'));
  assert.ok((validateCredentials({ username: 'alice_01', email: 'nope', password: 's3cret!!' }) ?? '').includes('Email'));
  const hashed = await hashPassword('s3cret!!');
  assert.ok(hashed.startsWith('scrypt$'));
  assert.equal(await verifyPassword('s3cret!!', hashed), true);
  assert.equal(await verifyPassword('wrong', hashed), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);

  const reg = await auth.register({ username: 'alice_01', email: 'alice@x.test', password: 's3cret!!' });
  assert.equal(reg.user.role, 'USER');
  assert.equal(reg.token.length, 64);
  await assert.rejects(() => auth.register({ username: 'alice_01', password: 's3cret!!' }), /tồn tại/);
  await assert.rejects(
    () => auth.register({ username: 'bob_02', email: 'alice@x.test', password: 's3cret!!' }),
    /tồn tại/,
  );
  await assert.rejects(() => auth.register({ username: 'ab', password: 's3cret!!' }), /Username/);
  await assert.rejects(() => auth.register({ username: 'carol_03', password: 'short' }), /Mật khẩu/);

  const logged = await auth.login({ username: 'alice_01', password: 's3cret!!' });
  assert.equal(logged.user.wallet, reg.user.wallet);
  const reqCred: Row = { headers: { authorization: `Bearer ${logged.token}` } };
  assert.equal(await guard.canActivate(ctxOf(reqCred, () => 0, class A {})), true);
  assert.equal((reqCred.user as Row).role, 'USER');
  await assert.rejects(() => auth.login({ username: 'alice_01', password: 'wrongpw!!' }), /Sai tên đăng nhập/);
  await assert.rejects(() => auth.login({ username: 'ghost_99', password: 'whatever!!' }), /Sai tên đăng nhập/);

  // 13. setRole resolves credential identity by wallet, cred:wallet, or bare username.
  const byName = await users.setRole('alice_01', 'KOL');
  assert.equal(byName.role, 'KOL');
  const byCred = await users.setRole('cred:alice_01', 'ADMIN');
  assert.equal(byCred.role, 'ADMIN');
  const listed = await users.list();
  assert.ok(listed.some((u) => ((u as unknown) as Row).username === 'alice_01'));
  assert.equal(await statusOf(() => users.setRole('ghost_99', 'KOL')), 404);
  assert.equal(await statusOf(() => users.setRole('alice_01', 'SUPER')), 400);

  console.log('auth asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
