import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ChainProgramClient } from './program.client.js';

export interface ChainPoolBinding {
  poolId: number;
  name: string;
  chain: {
    programId: string;
    vault: string;
    treasury: string;
    shares: string;
    authority: string;
    env: 'devnet';
  };
  signature: string;
}

/**
 * Admin-only devnet setup: create a dedicated unlisted demo pool and bind it
 * to a freshly initialized edgepool-vault account. Existing production pools
 * (public listings) are deliberately refused.
 */
/**
 * Devnet vault account name for a pool. The on-chain account is derived from
 * `demo-{poolId}`, NOT from the pool display name (`demo-chain-*`). Any PDA
 * derivation must use this helper or read `vaults.chainVault` from the DB.
 */
export function devnetVaultName(poolId: number): string {
  return `demo-${poolId}`.slice(0, 24);
}

@Injectable()
export class ChainAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChainProgramClient) private readonly program: ChainProgramClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createDemoPool(): Promise<ChainPoolBinding> {
    if (this.program.cluster() !== 'devnet') {
      throw new BadRequestException('Chain demo pool can only be created on devnet.');
    }
    if (!this.program.keeperForSetup()) {
      throw new BadRequestException('CHAIN_KEEPER_KEY is missing; cannot initialize devnet vault.');
    }
    const slug = Date.now().toString(36);
    const created = await this.prisma.vault.create({
      data: {
        name: `demo-chain-${slug}`,
        kind: 'basket',
        status: 'live',
        listing: 'unlisted',
        maxTraders: 5,
      },
    });
    try {
      return await this.initializePool(created.id);
    } catch (err) {
      // Do not leave an empty pool behind if on-chain init failed.
      await this.prisma.vault.delete({ where: { id: created.id } }).catch(() => undefined);
      throw err;
    }
  }

  async initializePool(poolId: number): Promise<ChainPoolBinding> {
    if (this.program.cluster() !== 'devnet') {
      throw new BadRequestException('Chain demo pool can only be initialized on devnet.');
    }
    if (!Number.isInteger(poolId) || poolId <= 0) {
      throw new BadRequestException('Invalid pool id.');
    }
    const vault = await this.prisma.vault.findUnique({ where: { id: poolId } });
    if (!vault) throw new NotFoundException(`Pool ${poolId} not found.`);
    if (vault.listing !== 'unlisted' || !vault.name.startsWith('demo-chain')) {
      throw new BadRequestException('Only unlisted demo-chain-* pools may be bound to the program.');
    }
    if (vault.chainVault && vault.chainProgramId) {
      // Guard against name/PDA drift: the account must match demo-{poolId}.
      const expected = this.program.derivePdas(devnetVaultName(poolId)).vault.toBase58();
      if (expected !== vault.chainVault) {
        console.warn(
          `[chain] vault ${poolId} chainVault ${vault.chainVault} does not match ${expected} (demo-${poolId}); using DB value`,
        );
      }
      return {
        poolId,
        name: vault.name,
        chain: {
          programId: vault.chainProgramId,
          vault: vault.chainVault,
          treasury: '',
          shares: '',
          authority: '',
          env: 'devnet',
        },
        signature: 'already-bound',
      };
    }

    const onchainName = devnetVaultName(poolId);
    const result = await this.program.initializeVault(onchainName, {
      feeBps: vault.feeBps,
      withdrawFeeBps: vault.withdrawFeeBps,
      reserveBps: vault.reserveBps,
      maxTradeBps: 200,
      maxMarksBps: 5000,
    });
    await this.prisma.vault.update({
      where: { id: poolId },
      data: {
        chainProgramId: result.programId,
        chainVault: result.vault,
        chainEnv: 'devnet',
        chainPaused: false,
      },
    });
    await this.audit
      .record({
        actor: 'system:admin',
        action: 'chain.pool_initialize',
        target: `vault:${poolId}`,
        reason: `devnet initialize ${onchainName}: ${result.signature}`,
        metaJson: {
          programId: result.programId,
          vault: result.vault,
          treasury: result.treasury,
          shares: result.shares,
          authority: result.authority,
          signature: result.signature,
        },
      })
      .catch(() => undefined);
    return {
      poolId,
      name: vault.name,
      chain: {
        programId: result.programId,
        vault: result.vault,
        treasury: result.treasury,
        shares: result.shares,
        authority: result.authority,
        env: 'devnet',
      },
      signature: result.signature,
    };
  }
}
