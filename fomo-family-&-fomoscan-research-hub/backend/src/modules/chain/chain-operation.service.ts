import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

export type ChainOperationKind = 'DEPOSIT' | 'WITHDRAW';
export type ChainOperationStatus = 'PENDING' | 'SUBMITTED' | 'INDEXED' | 'FAILED';

export interface ChainOperationDto {
  id: number;
  vaultId: number;
  kind: ChainOperationKind;
  wallet: string;
  onchainOperationId: string;
  amountSol: number | null;
  shares: number | null;
  status: ChainOperationStatus;
  txSignature: string | null;
  error: string | null;
  createdAt: string;
  submittedAt: string | null;
  indexedAt: string | null;
}

function fail(status: number, message: string): never {
  throw new HttpException({ success: false, message }, status);
}

function badRequest(message: string): never {
  fail(HttpStatus.BAD_REQUEST, message);
}

function conflict(message: string): never {
  fail(HttpStatus.CONFLICT, message);
}

@Injectable()
export class ChainOperationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private dto(row: {
    id: number;
    vaultId: number;
    kind: string;
    wallet: string;
    onchainOperationId: bigint;
    amountSol: unknown;
    shares: unknown;
    status: string;
    txSignature: string | null;
    error: string | null;
    createdAt: Date;
    submittedAt: Date | null;
    indexedAt: Date | null;
  }): ChainOperationDto {
    return {
      id: row.id,
      vaultId: row.vaultId,
      kind: row.kind as ChainOperationKind,
      wallet: row.wallet,
      onchainOperationId: row.onchainOperationId.toString(),
      amountSol: row.amountSol === null ? null : Number(row.amountSol),
      shares: row.shares === null ? null : Number(row.shares),
      status: row.status as ChainOperationStatus,
      txSignature: row.txSignature,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      indexedAt: row.indexedAt?.toISOString() ?? null,
    };
  }

  /** Positive 63-bit random id; fits Postgres BIGINT and Solana u64. */
  private randomOperationId(): bigint {
    for (;;) {
      const id = randomBytes(8).readBigUInt64LE(0) & 0x7fffffffffffffffn;
      if (id > 0n) return id;
    }
  }

  private validateKey(key: string): string {
    const clean = String(key ?? '').trim();
    if (clean.length < 8 || clean.length > 128) {
      badRequest('Idempotency-Key must be 8-128 characters.');
    }
    return clean;
  }

  async create(
    user: { id: number; wallet: string },
    vaultId: number,
    idempotencyKey: string,
    body: Record<string, unknown>,
  ): Promise<{ operation: ChainOperationDto; reused: boolean }> {
    const key = this.validateKey(idempotencyKey);
    const kind = String(body.kind ?? '').toUpperCase() as ChainOperationKind;
    if (kind !== 'DEPOSIT' && kind !== 'WITHDRAW') badRequest('kind must be DEPOSIT or WITHDRAW.');
    if (!Number.isInteger(vaultId) || vaultId <= 0) badRequest('Invalid pool id.');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(user.wallet)) {
      badRequest('A Solana wallet session is required for on-chain operations.');
    }
    const vault = await this.prisma.vault.findUnique({
      where: { id: vaultId },
      select: { chainVault: true },
    });
    if (!vault?.chainVault) badRequest('Pool is not bound to the on-chain vault.');
    const amountSol = body.amountSol === undefined ? null : Number(body.amountSol);
    const shares = body.shares === undefined ? null : Number(body.shares);
    if (kind === 'DEPOSIT') {
      if (!(amountSol !== null && Number.isFinite(amountSol) && amountSol >= 0.5)) {
        badRequest('Deposit amount must be >= 0.5 SOL.');
      }
    } else if (!(shares !== null && Number.isFinite(shares) && shares > 0)) {
      badRequest('Withdraw shares must be > 0.');
    }

    const existing = await this.prisma.chainOperation.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: key } },
    });
    if (existing) {
      const same =
        existing.vaultId === vaultId &&
        existing.kind === kind &&
        existing.wallet === user.wallet &&
        (kind === 'DEPOSIT'
          ? Number(existing.amountSol ?? 0) === amountSol
          : Number(existing.shares ?? 0) === shares);
      if (!same) conflict('Idempotency-Key was already used with a different payload.');
      return { operation: this.dto(existing), reused: true };
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const created = await this.prisma.chainOperation.create({
          data: {
            userId: user.id,
            vaultId,
            idempotencyKey: key,
            onchainOperationId: this.randomOperationId(),
            kind,
            wallet: user.wallet,
            amountSol,
            shares,
          },
        });
        return { operation: this.dto(created), reused: false };
      } catch (e) {
        // Two concurrent retries can race on the idempotency key; return the
        // winner. A rare random-id collision retries the create.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const winner = await this.prisma.chainOperation.findUnique({
            where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: key } },
          });
          if (winner) return { operation: this.dto(winner), reused: true };
          continue;
        }
        throw e;
      }
    }
    throw new Error('Could not allocate a unique on-chain operation id.');
  }

  async submit(
    user: { id: number; wallet: string },
    id: number,
    signature: string,
  ): Promise<ChainOperationDto> {
    const sig = String(signature ?? '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,96}$/.test(sig)) badRequest('Invalid transaction signature.');
    const row = await this.prisma.chainOperation.findUnique({ where: { id } });
    if (!row) fail(HttpStatus.NOT_FOUND, 'Operation not found.');
    if (row.userId !== user.id || row.wallet !== user.wallet) {
      fail(HttpStatus.FORBIDDEN, 'Operation belongs to another wallet.');
    }
    if (row.txSignature && row.txSignature !== sig) {
      conflict('Operation already has a different transaction signature.');
    }
    if (row.status === 'INDEXED') return this.dto(row);
    const updated = await this.prisma.chainOperation.update({
      where: { id },
      data: {
        txSignature: sig,
        status: 'SUBMITTED',
        submittedAt: row.submittedAt ?? new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    });
    return this.dto(updated);
  }

  async get(user: { id: number }, id: number): Promise<ChainOperationDto> {
    const row = await this.prisma.chainOperation.findUnique({ where: { id } });
    if (!row) fail(HttpStatus.NOT_FOUND, 'Operation not found.');
    if (row.userId !== user.id) fail(HttpStatus.FORBIDDEN, 'Operation belongs to another user.');
    return this.dto(row);
  }

  async markIndexed(signature: string): Promise<void> {
    await this.prisma.chainOperation.updateMany({
      where: { txSignature: signature, status: { in: ['SUBMITTED', 'FAILED'] } },
      data: { status: 'INDEXED', indexedAt: new Date(), error: null },
    });
  }

  async markFailed(signature: string, message: string): Promise<void> {
    await this.prisma.chainOperation.updateMany({
      where: { txSignature: signature, status: { in: ['PENDING', 'SUBMITTED'] } },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
  }
}
