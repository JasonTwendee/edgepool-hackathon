import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress, verifyEd25519Signature } from '../../common/auth/solana-verify.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { VaultService } from '../vaults/vault.service.js';
import { AuditService } from '../audit/audit.service.js';

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

function denied(message: string): never {
  throw new UnauthorizedException({ success: false, message });
}

function missing(message: string): never {
  throw new NotFoundException({ success: false, message });
}

const num = (v: { toNumber(): number } | number | string | null | undefined): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return v?.toNumber() ?? 0;
};

const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;

/** Allowed per-pool strategy override keys (design: pool rules · custom). */
const RULE_KEYS = new Set([
  'traderCapPctNav', 'entryNowPct', 'limitOffsetPct', 'stopMinPct', 'stopMaxPct',
  'timeStopHours', 'dailyKillSwitchPct', 'weeklyLossLimitPct',
  'tp1AtPct', 'tp1SellPct', 'tp2AtPct', 'tp2SellPct',
]);

export interface PartnerUser {
  id: number;
  wallet: string;
  role: string;
}

/** Challenge TTL for payout-wallet ownership proof (matches auth nonce TTL). */
export const PAYOUT_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Purpose-bound payout-wallet challenge message (fix 7). Binds the payout
 * key, the owner's login wallet, and freshness — pure, exported for asserts
 * and FE display. Verified with the PAYOUT key over this exact message.
 */
export function payoutChallengeMessage(payoutWallet: string, ownerLoginWallet: string, nonce: string, expiresAt: Date): string {
  return `Link payout wallet to Edgepool partner account\nwallet: ${payoutWallet}\nowner: ${ownerLoginWallet}\nnonce: ${nonce}\nexpires: ${expiresAt.toISOString()}`;
}

/**
 * Trader portal backend (pool app P4). Partners are KOL users whose pools are
 * assigned by ADMIN (Vault.ownerUserId). Claim is record-only in sandbox
 * (ACCRUED→PAID); on-chain transfer is a later phase.
 */
@Injectable()
export class PartnerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VaultService) private readonly vaults: VaultService,
    @Inject(DataStreamService) private readonly prices: DataStreamService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private assertWallet(wallet: string): string {
    const clean = (wallet ?? '').trim();
    try {
      decodeWalletAddress(clean);
    } catch {
      fail(`Invalid Solana wallet address: ${wallet}`);
    }
    return clean;
  }

  /** Public intake — always pending, Edgepool reviews in ADMIN console. */
  async apply(input: { fomoHandle: string; xHandle?: string; wallet: string; contact: string }): Promise<unknown> {    const wallet = this.assertWallet(input.wallet);
    const fomoHandle = (input.fomoHandle ?? '').trim().replace(/^@/, '');
    if (fomoHandle.length < 2) fail('FOMO handle is required.');
    const row = await this.prisma.partnerApplication.create({
      data: {
        fomoHandle,
        xHandle: input.xHandle?.trim() || null,
        wallet,
        contact: (input.contact ?? '').trim(),
        status: 'pending',
      },
    });
    return { id: row.id, status: row.status };
  }

  /** Public status check so applicants see "under review" without an account. */
  async applyStatus(wallet: string): Promise<{ status: string | null }> {
    const clean = (wallet ?? '').trim();
    if (!clean) return { status: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.prisma as any).partnerApplication.findFirst({
      where: { wallet: clean },
      orderBy: { id: 'desc' },
    });
    return { status: (row?.status as string) ?? null };
  }

  private async ownedVaults(user: PartnerUser): Promise<{ id: number }[]> {
    if (user.role === 'ADMIN') {
      return this.prisma.vault.findMany({ select: { id: true } });
    }
    return this.prisma.vault.findMany({ where: { ownerUserId: user.id }, select: { id: true } });
  }

  private async assertOwner(vaultId: number, user: PartnerUser): Promise<void> {
    if (user.role === 'ADMIN') return;
    const v = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!v) missing(`Vault ${vaultId} not found.`);
    if ((v.ownerUserId as number | null) !== user.id) {
      fail(`Vault ${vaultId} is not assigned to your account.`);
    }
  }

  /** Dashboard root: identity + pools + fees + basket status + requests. */
  async me(user: PartnerUser): Promise<Record<string, unknown>> {
    const [row, owned] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id } }),
      this.ownedVaults(user),
    ]);
    if (!row) missing(`User ${user.id} not found.`);
    const pools = await Promise.all(owned.map((v) => this.poolCard(v.id)));
    const fees = await this.fees(user);
    const basket = await this.basketStatus(user);
    const requests = await this.prisma.traderRequest.findMany({
      where: { vaultId: { in: owned.map((v) => v.id) } },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return {
      handle: (row.username as string | null) ?? (row.wallet as string).slice(0, 8),
      payoutWallet: (row.payoutWallet as string | null) ?? null,
      payoutWalletVerified: !!(row.payoutWalletVerifiedAt as unknown as Date | null),
      pools: pools.map((p) => ({ id: p.id, name: p.name, kind: p.kind, status: p.status, listing: p.listing, navSol: p.navSol })),
      fees,
      basket,
      requests: requests.map((r) => ({ id: r.id, vaultId: r.vaultId, fomoHandle: r.fomoHandle, status: r.status })),
    };
  }

  private async poolCard(vaultId: number): Promise<{ id: number; name: string; kind: string; status: string; listing: string; navSol: number; maxSlots: number; maxTraders: number; rulesJson: Record<string, number> | null }> {
    const v = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!v) missing(`Vault ${vaultId} not found.`);
    const last = await this.prisma.epochCheckpoint.findFirst({ where: { vaultId }, orderBy: { id: 'desc' } });
    return {
      id: v.id, name: v.name,
      kind: (v.kind as string) ?? 'basket', status: (v.status as string) ?? 'live',
      listing: (v.listing as string) ?? 'public', navSol: last ? num(last.navSol) : 0,
      maxSlots: (v.maxSlots as number) ?? 100, maxTraders: (v.maxTraders as number) ?? 5,
      rulesJson: (v.rulesJson as Record<string, number> | null) ?? null,
    };
  }

  /**
   * Fees: pending = unrealized partner share of open positions (winning trades
   * only); claimable = ACCRUED rows (settled above HWM); paid = PAID rows.
   * Split follows pool kind (basket 10/10, partner 15/5 of the 20% fee).
   */
  async fees(user: PartnerUser): Promise<Record<string, unknown>> {
    const owned = await this.ownedVaults(user);
    const ids = owned.map((v) => v.id);
    if (ids.length === 0) {
      return { pendingSol: 0, claimableSol: 0, paidSol: 0, nextCheckpointAt: null, byPool: [] };
    }
    let solPx = 0;
    try {
      const w = 'So11111111111111111111111111111111111111112';
      solPx = (await this.prices.bulkPrices([w]))[w] ?? 0;
    } catch {
      solPx = 0;
    }
    const [payouts, orders, vaults] = await Promise.all([
      this.prisma.partnerPayout.findMany({ where: { vaultId: { in: ids } } }),
      this.prisma.copyOrder.findMany({ where: { vaultId: { in: ids }, closedAt: null } }),
      this.prisma.vault.findMany({ where: { id: { in: ids } } }),
    ]);
    const kindOf = new Map(vaults.map((v) => [v.id, ((v.kind as string) ?? 'basket') as string]));
    const byPool: Record<string, unknown>[] = [];
    let claimable = 0;
    let paid = 0;
    let next: string | null = null;
    for (const vid of ids) {
      const kind = kindOf.get(vid) ?? 'basket';
      const rows = payouts.filter((p) => p.vaultId === vid);
      const acc = rows.filter((p) => p.status === 'ACCRUED').reduce((s, p) => s + num(p.amountSol), 0);
      const pd = rows.filter((p) => p.status === 'PAID').reduce((s, p) => s + num(p.amountSol), 0);
      claimable = r9(claimable + acc);
      paid = r9(paid + pd);
      const st = await this.vaults.status(vid).catch(() => null);
      const win = (st?.window ?? null) as { nextOpensAt?: string } | null;
      if (win?.nextOpensAt && (!next || win.nextOpensAt < next)) next = win.nextOpensAt;
      byPool.push({ vaultId: vid, kind, claimableSol: r9(acc), paidSol: r9(pd) });
    }
    // Pending via unrealized share of open positions (single priced pass per pool).
    let pending = 0;
    for (const vid of ids) {
      const kind = kindOf.get(vid) ?? 'basket';
      const share = kind === 'partner' ? 0.75 : 0.5;
      const open = orders.filter((x) => x.vaultId === vid && (x.action ?? 'BUY') === 'BUY' && x.tokenMint && num(x.entryPriceUsd) > 0);
      if (open.length === 0 || solPx <= 0) continue;
      const mints = [...new Set(open.map((o) => o.tokenMint as string))];
      let prices: Record<string, number> = {};
      try {
        prices = await this.prices.bulkPrices(mints);
      } catch {
        prices = {};
      }
      for (const o of open) {
        const live = prices[o.tokenMint as string];
        if (!live) continue;
        const qty = num(o.amountUsd) / num(o.entryPriceUsd);
        const unrealUsd = qty * live - num(o.amountUsd);
        if (unrealUsd > 0) pending = r9(pending + ((unrealUsd / solPx) * 0.2 * share));
      }
    }
    return { pendingSol: pending, claimableSol: r9(claimable), paidSol: r9(paid), nextCheckpointAt: next, byPool };
  }

  async setPayoutWallet(user: PartnerUser, wallet: string, signature: string): Promise<{ payoutWallet: string }> {
    const clean = this.assertWallet(wallet);
    if (!(signature ?? '').trim()) denied('Signature required. Get a challenge via POST /api/partner/payout-wallet/challenge, sign it with the payout wallet, then submit.');
    const challenge = await this.prisma.payoutWalletChallenge.findFirst({
      where: { userId: user.id, wallet: clean, consumedAt: null },
      orderBy: { id: 'desc' },
    });
    if (!challenge || (challenge.expiresAt as unknown as Date).getTime() <= Date.now()) {
      await this.audit
        .record({ actor: user.wallet, action: 'partner.verify_failed', target: clean.slice(0, 44), reason: 'expired-or-missing-challenge' })
        .catch(() => undefined);
      denied('Challenge expired or missing. Get a new challenge first.');
    }
    const message = payoutChallengeMessage(clean, user.wallet, challenge.nonce as string, challenge.expiresAt as unknown as Date);
    const ok = verifyEd25519Signature(Buffer.from(message, 'utf8'), (signature ?? '').trim(), clean);
    if (!ok) {
      await this.audit
        .record({ actor: user.wallet, action: 'partner.verify_failed', target: clean.slice(0, 44), reason: 'bad-signature' })
        .catch(() => undefined);
      denied('Invalid signature for this payout wallet.');
    }
    await this.prisma.payoutWalletChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    // Setting a (new) wallet always re-verifies from this challenge.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { payoutWallet: clean, payoutWalletVerifiedAt: new Date() },
    });
    await this.audit
      .record({ actor: user.wallet, action: 'partner.payout_wallet_verified', target: clean.slice(0, 44) })
      .catch(() => undefined);
    return { payoutWallet: clean };
  }

  /** Issue an ownership challenge for a payout wallet (5min TTL, single-use). */
  async issuePayoutChallenge(user: PartnerUser, wallet: string): Promise<{ wallet: string; nonce: string; message: string; expiresAt: string }> {
    const clean = this.assertWallet(wallet);
    const nonce = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + PAYOUT_CHALLENGE_TTL_MS);
    await this.prisma.payoutWalletChallenge.create({ data: { userId: user.id, wallet: clean, nonce, expiresAt } });
    return { wallet: clean, nonce, message: payoutChallengeMessage(clean, user.wallet, nonce, expiresAt), expiresAt: expiresAt.toISOString() };
  }

  /** Claim all ACCRUED rows of owned pools → PAID (record-only in sandbox). */
  async claim(user: PartnerUser): Promise<{ claimedSol: number; rows: number }> {
    const me = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!me) missing(`User ${user.id} not found.`);
    if (!(me.payoutWallet as string | null)) fail('Connect a payout wallet first.');
    // Fix 7 fail-closed: a wallet on file proves nothing until the ownership
    // challenge is verified (prevents funds flowing to an attacker's wallet).
    if (!(me.payoutWalletVerifiedAt as unknown as Date | null)) fail('Verify your payout wallet first.');
    const owned = await this.ownedVaults(user);
    const ids = owned.map((v) => v.id);
    if (ids.length === 0) return { claimedSol: 0, rows: 0 };
    const rows = await this.prisma.partnerPayout.findMany({ where: { vaultId: { in: ids }, status: 'ACCRUED' } });
    const total = r9(rows.reduce((s, p) => s + num(p.amountSol), 0));
    if (rows.length > 0) {
      await this.prisma.partnerPayout.updateMany({
        where: { id: { in: rows.map((p) => p.id) }, status: 'ACCRUED' },
        data: { status: 'PAID' },
      });
    }
    return { claimedSol: total, rows: rows.length };
  }

  async updateSettings(vaultId: number, user: PartnerUser, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Pool ops moved to /terminal (ADMIN-only): KOL portal is Fees/Share/
    // Signals/Payouts + request-trader only. Guard stays here too so a direct
    // API call from a KOL session is refused even if the route guard is bypassed.
    if (user.role !== 'ADMIN') fail('ADMIN only: pool settings are managed in /terminal.');
    await this.assertOwner(vaultId, user);
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = String(patch.name ?? '').trim();
      if (name.length < 2) fail('Pool name is required.');
      data.name = name;
    }
    if (patch.listing !== undefined) {
      const listing = String(patch.listing).toLowerCase();
      if (!['public', 'unlisted'].includes(listing)) fail('listing must be public|unlisted.');
      data.listing = listing;
    }
    if (patch.status !== undefined) {
      const status = String(patch.status).toLowerCase();
      if (!['live', 'paused'].includes(status)) fail('status must be live|paused.');
      data.status = status;
    }
    if (patch.maxSlots !== undefined) {
      const maxSlots = patch.maxSlots as number;
      if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 1000) fail('maxSlots must be an integer 1..1000.');
      const holders = await this.prisma.deposit.findMany({ where: { vaultId, status: 'SETTLED' }, select: { depositor: true } });
      const used = new Set(holders.map((h) => h.depositor)).size;
      if (maxSlots < used) fail(`maxSlots cannot go below current depositors (${used}).`);
      data.maxSlots = maxSlots;
    }
    if (patch.maxTraders !== undefined) {
      const maxTraders = patch.maxTraders as number;
      if (!Number.isInteger(maxTraders) || maxTraders < 3 || maxTraders > 5) fail('maxTraders must be 3, 4 or 5.');
      data.maxTraders = maxTraders;
    }
    if (patch.rulesJson !== undefined) {
      const rules = patch.rulesJson as Record<string, unknown>;
      if (!rules || typeof rules !== 'object') fail('rulesJson must be an object.');
      for (const k of Object.keys(rules)) {
        if (!RULE_KEYS.has(k)) fail(`Unknown rule key: ${k}.`);
        if (typeof rules[k] !== 'number' || !Number.isFinite(rules[k] as number)) fail(`Rule ${k} must be a number.`);
      }
      data.rulesJson = rules as never;
    }
    if (Object.keys(data).length === 0) fail('Nothing to update.');
    const updated = await this.prisma.vault.update({ where: { id: vaultId }, data });
    return { id: updated.id, name: updated.name, kind: updated.kind, status: updated.status, listing: updated.listing, maxSlots: updated.maxSlots, maxTraders: updated.maxTraders, rulesJson: updated.rulesJson ?? null };
  }

  /** Per-trader table: status, signals 7d, profit, fee earned (owner scope). */
  async poolTraders(vaultId: number, user: PartnerUser): Promise<unknown[]> {
    await this.assertOwner(vaultId, user);
    const [trs, orders, payouts, tracked] = await Promise.all([
      this.prisma.vaultTrader.findMany({ where: { vaultId }, orderBy: { id: 'asc' } }),
      this.prisma.copyOrder.findMany({ where: { vaultId }, orderBy: { id: 'desc' }, take: 500 }),
      this.prisma.partnerPayout.findMany({ where: { vaultId } }),
      this.prisma.trackedWallet.findMany({ select: { address: true, handle: true } }),
    ]);
    const handleOf = new Map(tracked.map((t) => [t.address, t.handle]));
    const weekAgo = Date.now() - 7 * 86400000;
    return trs.map((t) => {
      const mine = orders.filter((o) => o.masterWallet === t.wallet);
      return {
        wallet: t.wallet,
        handle: handleOf.get(t.wallet) ?? t.wallet.slice(0, 6),
        isActive: t.isActive,
        weightBps: t.weightBps,
        signals7d: mine.filter((o) => new Date(o.createdAt as unknown as string).getTime() >= weekAgo).length,
        profitUsd: Math.round(mine.filter((o) => o.closedAt).reduce((s, o) => s + num(o.realizedPnlUsd), 0)),
        feeSol: r9(payouts.filter((p) => p.trader === t.wallet).reduce((s, p) => s + num(p.amountSol), 0)),
      };
    });
  }

  async pauseTrader(vaultId: number, user: PartnerUser, wallet: string, active: boolean): Promise<unknown> {
    if (user.role !== 'ADMIN') fail('ADMIN only: trader pause/remove is managed in /terminal.');
    await this.assertOwner(vaultId, user);
    if (active) return this.vaults.assignTrader(vaultId, wallet, 0);
    return this.vaults.removeTrader(vaultId, wallet);
  }

  async requestTrader(vaultId: number, user: PartnerUser, input: { fomoHandle: string; xHandle?: string }): Promise<unknown> {
    await this.assertOwner(vaultId, user);
    const fomoHandle = (input.fomoHandle ?? '').trim().replace(/^@/, '');
    if (fomoHandle.length < 2) fail('FOMO handle is required.');
    const row = await this.prisma.traderRequest.create({
      data: { vaultId, fomoHandle, xHandle: input.xHandle?.trim() || null, status: 'pending' },
    });
    return { id: row.id, status: row.status };
  }

  /** My signals in my pools: recent orders by pool traders with per-trade profit. */
  async signals(user: PartnerUser, vaultId?: number): Promise<unknown[]> {
    const owned = await this.ownedVaults(user);
    const ids = vaultId ? owned.map((v) => v.id).filter((id) => id === vaultId) : owned.map((v) => v.id);
    if (ids.length === 0) return [];
    const [trs, orders] = await Promise.all([
      this.prisma.vaultTrader.findMany({ where: { vaultId: { in: ids } } }),
      this.prisma.copyOrder.findMany({ where: { vaultId: { in: ids } }, orderBy: { id: 'desc' }, take: 100 }),
    ]);
    const inScope = new Set(trs.filter((t) => t.isActive).map((t) => `${t.vaultId}:${t.wallet}`));
    return orders
      .filter((o) => inScope.has(`${o.vaultId}:${o.masterWallet}`))
      .slice(0, 50)
      .map((o) => ({
        id: o.id, vaultId: o.vaultId, token: o.symbol ?? o.tokenMint?.slice(0, 8) ?? '—',
        trader: o.masterHandle ?? o.masterWallet?.slice(0, 8) ?? '—',
        status: o.status, profitUsd: o.closedAt ? Math.round(num(o.realizedPnlUsd)) : null,
        createdAt: new Date(o.createdAt as unknown as string).toISOString(),
      }));
  }

  async payouts(user: PartnerUser): Promise<unknown[]> {
    const owned = await this.ownedVaults(user);
    const ids = owned.map((v) => v.id);
    if (ids.length === 0) return [];
    const rows = await this.prisma.partnerPayout.findMany({ where: { vaultId: { in: ids } }, orderBy: { id: 'desc' }, take: 100 });
    return rows.map((p) => ({
      id: p.id, vaultId: p.vaultId, trader: p.trader, amountSol: num(p.amountSol),
      epochId: p.epochId ?? null, kind: p.kind, status: p.status,
      createdAt: new Date(p.createdAt as unknown as string).toISOString(),
    }));
  }

  /** Edgepool basket status for the partner's traders (10% note vs 15% own-pool). */
  async basketStatus(user: PartnerUser): Promise<unknown[]> {
    const owned = await this.ownedVaults(user);
    const ids = owned.map((v) => v.id);
    if (ids.length === 0) return [];
    const flagship = await this.prisma.vault.findFirst({ where: { kind: 'basket' }, orderBy: { id: 'asc' } });
    if (!flagship) return [];
    const [mine, basket, tracked] = await Promise.all([
      this.prisma.vaultTrader.findMany({ where: { vaultId: { in: ids }, isActive: true } }),
      this.prisma.vaultTrader.findMany({ where: { vaultId: flagship.id, isActive: true } }),
      this.prisma.trackedWallet.findMany({ select: { address: true, handle: true, fomoRank: true, rank24h: true, rank7d: true, rank30d: true } }),
    ]);
    const inBasket = new Set(basket.map((t) => t.wallet));
    const rankOf = new Map(tracked.map((t) => [t.address, { handle: t.handle, rank: t.fomoRank ?? null, ranks: { h24: t.rank24h ?? null, d7: t.rank7d ?? null, d30: t.rank30d ?? null } }]));
    const seen = new Set<string>();
    return mine
      .filter((t) => !seen.has(t.wallet) && (seen.add(t.wallet), true))
      .map((t) => ({
        wallet: t.wallet,
        handle: rankOf.get(t.wallet)?.handle ?? t.wallet.slice(0, 6),
        rank: rankOf.get(t.wallet)?.rank ?? null,
        ranks: rankOf.get(t.wallet)?.ranks ?? { h24: null, d7: null, d30: null },
        inBasket: inBasket.has(t.wallet),
        note: inBasket.has(t.wallet) ? '10% of profit your signals make here (Edgepool takes 10%)' : 'Not in the Edgepool basket',
      }));
  }

  async applications(user: PartnerUser): Promise<unknown[]> {
    if (user.role !== 'ADMIN') fail('ADMIN only.');
    return this.prisma.partnerApplication.findMany({ orderBy: { id: 'desc' }, take: 100 });
  }

  async reviewApplication(id: number, user: PartnerUser, input: { decision: string; vaultId?: number; userId?: number }): Promise<unknown> {
    if (user.role !== 'ADMIN') fail('ADMIN only.');
    const decision = String(input.decision ?? '').toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) fail('decision must be approved|rejected.');
    const row = await this.prisma.partnerApplication.findUnique({ where: { id } });
    if (!row) missing(`Application ${id} not found.`);
    await this.prisma.partnerApplication.update({ where: { id }, data: { status: decision } });
    if (decision === 'approved' && input.vaultId && input.userId) {
      await this.prisma.vault.update({ where: { id: input.vaultId }, data: { ownerUserId: input.userId } });
    }
    return { id, status: decision };
  }
}
