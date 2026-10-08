/** Integration test; set POSTGRES_* to an isolated local database ending in _test. */
import assert from 'node:assert/strict';
import { getConfig } from '../../config/configuration.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { VaultService } from './vault.service.js';
import { vaultLoss } from '../copy-trade/kill-switch.js';

const config = getConfig().db;
if (!['localhost', '127.0.0.1'].includes(config.host) || !config.name.endsWith('_test')) {
  throw new Error('Use an isolated local database whose name ends in _test.');
}
const WSOL = 'So11111111111111111111111111111111111111112';
const createDb = () => new PrismaClient({ adapter: new PrismaPg({
  host: config.host, port: config.port, user: config.user, password: config.password, database: config.name,
}) });
const db = createDb();
const otherDb = createDb();
const prices: Record<string, number> = { [WSOL]: 100, ACCOUNTING_TEST_TOKEN: 12 };
const market = { bulkPrices: async (mints: string[]) => Object.fromEntries(mints.map((m) => [m, prices[m]])) };
const service = new VaultService(db as never, market as never);
const other = new VaultService(otherDb as never, market as never);
const ids: number[] = [];
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

async function main() {
  await Promise.all([db.$connect(), otherDb.$connect()]);
  const vault = await service.getOrCreateVault(`accounting-test-${Date.now()}`);
  ids.push(vault.id);
  await service.deposit(vault.id, 'alice', 1);
  close(await service.computeNav(vault.id), 1);
  const concurrent = await Promise.all([service.settleEpoch(vault.id), other.settleEpoch(vault.id)]);
  assert.equal(concurrent.reduce((n, s) => n + s.settledDeposits.length, 0), 1);
  close(await service.depositorShares(vault.id, 'alice'), 1);
  for (const s of concurrent) close(s.navSol, 1);

  const order = await db.copyOrder.create({ data: {
    vaultId: vault.id, mode: 'paper', status: 'CONFIRMED', action: 'BUY',
    tokenMint: 'ACCOUNTING_TEST_TOKEN', amountUsd: 10, entryPriceUsd: 10,
  } });
  close(await service.computeNav(vault.id), 1.02);
  close((await service.settleEpoch(vault.id)).navSol, 1.02);
  close((await service.settleEpoch(vault.id)).navSol, 1.02);

  // Half exited: $1 realized + $1 unrealized; no double-count.
  await db.copyOrderLeg.create({ data: { orderId: order.id, leg: 'TP1', fraction: 0.5, exitPriceUsd: 12, realizedPnlUsd: 1, closedAt: new Date() } });
  await db.copyOrder.update({ where: { id: order.id }, data: { realizedPnlUsd: 1 } });
  close(await service.computeNav(vault.id), 1.02);
  const statement = (await service.ledger(vault.id)).statement as Record<string, number>;
  close(statement.openAllocatedUsd, 5);
  close(statement.realizedUsd, 1);
  close(statement.unrealizedUsd, 1);
  close((await service.settleEpoch(vault.id)).navSol, 1.02);
  prices.ACCOUNTING_TEST_TOKEN = 14;
  close(await service.computeNav(vault.id), 1.03);
  close((await service.settleEpoch(vault.id)).navSol, 1.03);
  await db.copyOrderLeg.create({ data: { orderId: order.id, leg: 'TP2', fraction: 0.5, exitPriceUsd: 14, realizedPnlUsd: 2, closedAt: new Date() } });
  await db.copyOrder.update({ where: { id: order.id }, data: { closedAt: new Date(), realizedPnlUsd: 3 } });
  close((await service.settleEpoch(vault.id)).navSol, 1.03);

  await service.deposit(vault.id, 'bob', 0.515);
  const deposit = await service.settleEpoch(vault.id);
  close(deposit.navSol, 1.545);
  close(deposit.sharePrice, 1.03);
  close(await service.depositorShares(vault.id, 'bob'), 0.5);
  await service.requestWithdraw(vault.id, 'alice', 0.25);
  const withdrawals = await Promise.all([service.settleEpoch(vault.id), other.settleEpoch(vault.id)]);
  assert.equal(withdrawals.reduce((sum, s) => sum + s.settledWithdrawals.length, 0), 1);
  close(await service.computeNav(vault.id), 1.2875);
  close(await service.depositorShares(vault.id, 'alice'), 0.75);
  close((await service.settleEpoch(vault.id)).sharePrice, 1.03);

  const epochs = await db.epochCheckpoint.findMany({ where: { vaultId: vault.id }, orderBy: { id: 'asc' } });
  const old = new Date(Date.now() - 2 * 86400000);
  const last = epochs[epochs.length - 1];
  close(vaultLoss([{ navSol: 1.545, sharePrice: 1.03, createdAt: old }, last]).dayPct, 0);
  close(vaultLoss([{ navSol: 1, sharePrice: 1, createdAt: old }, { navSol: 2, sharePrice: 0.94, createdAt: new Date() }]).dayPct, -6);

  await db.epochCheckpoint.update({ where: { id: last.id }, data: { pnlSol: null } });
  await assert.rejects(() => service.settleEpoch(vault.id), /Historical NAV/);
  close((await service.settleEpoch(vault.id, 1.2875)).navSol, 1.2875);
  close((await service.settleEpoch(vault.id)).navSol, 1.2875);

  const open = await db.copyOrder.create({ data: { vaultId: vault.id, mode: 'paper', status: 'CONFIRMED', action: 'BUY', tokenMint: 'MISSING', amountUsd: 1, entryPriceUsd: 1 } });
  const before = await db.epochCheckpoint.count({ where: { vaultId: vault.id } });
  await assert.rejects(() => service.settleEpoch(vault.id), /cannot be valued/);
  assert.equal(await db.epochCheckpoint.count({ where: { vaultId: vault.id } }), before);
  await db.copyOrder.delete({ where: { id: open.id } });
  const previousSolPrice = prices[WSOL];
  delete prices[WSOL];
  await assert.rejects(() => service.settleEpoch(vault.id), /SOL price unavailable/);
  assert.equal(await db.epochCheckpoint.count({ where: { vaultId: vault.id } }), before);
  prices[WSOL] = previousSolPrice;


  const feeVault = await service.getOrCreateVault(`accounting-fee-test-${Date.now()}`);
  ids.push(feeVault.id);
  await service.setPolicy(feeVault.id, { feeBps: 2000 });
  await service.deposit(feeVault.id, 'carol', 1);
  await service.settleEpoch(feeVault.id);
  await db.copyOrder.create({ data: { vaultId: feeVault.id, mode: 'paper', status: 'CONFIRMED', action: 'BUY', tokenMint: 'ACCOUNTING_TEST_TOKEN', amountUsd: 10, entryPriceUsd: 10 } });
  const failing = new VaultService(db as never, market as never);
  Object.defineProperty(failing, 'bookFeeSplit', { value: async () => { throw new Error('Injected settlement failure'); } });
  await service.deposit(feeVault.id, 'dave', 0.5);
  await assert.rejects(() => failing.settleEpoch(feeVault.id), /Injected settlement failure/);
  close(await service.depositorShares(feeVault.id, 'dave'), 0);
  const fees = await Promise.all([service.settleEpoch(feeVault.id), other.settleEpoch(feeVault.id)]);
  close(fees.reduce((sum, s) => sum + s.feeSol, 0), 0.008);
  close(fees.reduce((sum, s) => sum + s.settledDeposits.length, 0), 1);
  close((await service.settleEpoch(feeVault.id)).feeSol, 0);
  const carolShares = await service.depositorShares(feeVault.id, 'carol');
  const daveShares = await service.depositorShares(feeVault.id, 'dave');
  await service.setPolicy(feeVault.id, { withdrawFeeBps: 1000 });
  await service.requestWithdraw(feeVault.id, 'carol', carolShares);
  await service.requestWithdraw(feeVault.id, 'dave', daveShares);
  const drained = await service.settleEpoch(feeVault.id);
  close(drained.navSol, 0);
  close(drained.sharesOutstanding, 0);
  const withdrawn = drained.settledWithdrawals.reduce((sum, w) => sum + w.payoutSol, 0);
  close(withdrawn, 1.3788);
  const feeState = await service.status(feeVault.id);
  // No active traders: the entire performance fee belongs to treasury.
  close(feeState.treasurySol, 0.1612);

  console.log('Postgres accounting: concurrent mint/burn, partial exits, repeated epochs, cash flows, fees, rollback, legacy baseline and price failures ALL GREEN');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  try {
    for (const id of ids) {
      await db.copyOrder.deleteMany({ where: { vaultId: id } });
      await db.vault.delete({ where: { id } });
    }
  } finally { await Promise.all([db.$disconnect(), otherDb.$disconnect()]); }
});
