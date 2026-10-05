/**
 * Executable evidence for P2 (audit interceptor + append-only store).
 * Run: `npx tsx src/modules/audit/assert-audit.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';

type Row = Record<string, unknown>;

function makeFake() {
  const db = { audit: [] as Row[] };
  let seq = 0;
  return {
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: (seq += 1), createdAt: new Date(), ...data };
        db.audit.push(r);
        return r;
      },
      count: async ({ where }: { where: Row }) =>
        db.audit.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)).length,
      findMany: async ({ where, take }: { where: Row; take: number }) =>
        db.audit
          .filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))
          .slice(-take)
          .reverse(),
    },
  } as never;
}

function ctxOf(req: Row, handler: unknown): never {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class C {},
  } as never;
}

function collect(obs: { subscribe: (o: { next: (v: unknown) => void }) => void }): Promise<unknown[]> {
  return new Promise((resolve) => {
    const out: unknown[] = [];
    obs.subscribe({ next: (v) => (out.push(v), resolve(out)) });
  });
}

async function main(): Promise<void> {
  const svc = new AuditService(makeFake());

  // 1. Append-only surface: create + list exist, update/delete do NOT.
  assert.equal(typeof svc.record, 'function');
  assert.equal(typeof svc.list, 'function');
  const surface = svc as unknown as Row;
  assert.equal(surface.update, undefined);
  assert.equal(surface.delete, undefined);
  assert.equal(surface.remove, undefined);

  // 2. Record + filtered list.
  await svc.record({ actor: 'admin-wallet', action: 'vault.create', target: '2', reason: 'demo' });
  await svc.record({ actor: 'admin-wallet', action: 'user.set_role', target: 'u1' });
  const all = await svc.list({});
  assert.equal(all.total, 2);
  const filtered = await svc.list({ actor: 'admin-wallet', action: 'user.set_role' });
  assert.equal(filtered.total, 1);
  const limited = await svc.list({ limit: 1 });
  assert.equal((limited.data as Row[]).length, 1);

  // 3. Interceptor: route without @Audit passes through, records nothing.
  const interceptor = new AuditInterceptor(svc, new Reflector());
  const plain = (): string => 'ok';
  const reqPlain: Row = { user: { wallet: 'w' }, params: {}, body: {} };
  const out1 = await collect(
    interceptor.intercept(ctxOf(reqPlain, plain), { handle: () => of('ok') }) as never,
  );
  assert.deepEqual(out1, ['ok']);
  assert.equal((await svc.list({})).total, 2);

  // 4. Interceptor: audited route records actor/action/target/reason after success.
  const { Audit } = await import('./audit.interceptor.js');
  void Audit;
  const audited = (): string => 'ok';
  Reflect.defineMetadata('audit:action', 'bot.set_mode', audited);
  const reqAudit: Row = {
    user: { wallet: 'admin-w', role: 'ADMIN' },
    params: { id: '7' },
    body: { reason: 'pause for demo' },
    method: 'POST',
    url: '/api/bots/7/mode',
  };
  const out2 = await collect(
    interceptor.intercept(ctxOf(reqAudit, audited), { handle: () => of('ok') }) as never,
  );
  assert.deepEqual(out2, ['ok']);
  await new Promise((x) => setTimeout(x, 50));
  const rows = await svc.list({ action: 'bot.set_mode' });
  assert.equal(rows.total, 1);
  const row = (rows.data as Row[])[0];
  assert.equal(row.actor, 'admin-w');
  assert.equal(row.target, '7');
  assert.equal(row.reason, 'pause for demo');

  // 5. Interceptor: anonymous request is skipped, never crashes.
  const reqAnon: Row = { params: {}, body: {} };
  const out3 = await collect(
    interceptor.intercept(ctxOf(reqAnon, audited), { handle: () => of('ok') }) as never,
  );
  assert.deepEqual(out3, ['ok']);

  console.log('audit asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
