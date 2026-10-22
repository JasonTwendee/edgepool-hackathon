/**
 * Devnet faucet (P2). Authenticated users can request a small SOL airdrop
 * for chain testing. Genesis-gated to devnet (same gate as the paper
 * executor), rate-limited per user per 24h, disabled unless CHAIN_ENABLED.
 */
import { Body, Controller, HttpException, HttpStatus, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { AuthGuard, AuthedUser } from '../../common/auth/guards.js';
import { DEVNET_GENESIS_HASH } from '../copy-trade/paper-executor.service.js';
import { isFaucetAllowed } from './events.js';
import { ChainProgramClient } from './program.client.js';
import { ChainIndexerService } from './indexer.service.js';

const MIN_SOL = 0.1;
const MAX_SOL = 2;
const DEFAULT_SOL = 1;
const RATE_LIMIT_MS = 24 * 3600_000;

function fail(status: number, message: string): never {
  throw new HttpException({ success: false, error: message }, status);
}

function parseAddress(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 32 || value.trim().length > 44) {
    fail(HttpStatus.BAD_REQUEST, 'address must be a base58 wallet string (32-44 chars).');
  }
  try {
    new PublicKey((value as string).trim());
  } catch {
    fail(HttpStatus.BAD_REQUEST, 'address is not a valid Solana pubkey.');
  }
  return (value as string).trim();
}

function parseAmount(value: unknown): number {
  const n = value === undefined || value === null ? DEFAULT_SOL : Number(value);
  if (!Number.isFinite(n) || n < MIN_SOL || n > MAX_SOL) {
    fail(HttpStatus.BAD_REQUEST, `amountSol must be between ${MIN_SOL} and ${MAX_SOL}.`);
  }
  return n;
}

@Controller('api/chain')
export class ChainFaucetController {
  private readonly lastGrant = new Map<string, number>();

  constructor(
    @Inject(ChainProgramClient) private readonly program: ChainProgramClient,
    @Inject(ChainIndexerService) private readonly indexer: ChainIndexerService,
  ) {}

  @Post('faucet')
  @UseGuards(AuthGuard)
  async faucet(@Req() req: { user?: AuthedUser }, @Body() body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!isFaucetAllowed(this.program.cluster(), this.program.enabled())) {
      fail(HttpStatus.FORBIDDEN, 'Chain module is disabled or not on devnet.');
    }
    const user = req.user;
    if (!user || typeof user.id !== 'number') {
      fail(HttpStatus.UNAUTHORIZED, 'Authentication required.');
    }
    const address = parseAddress(body.address);
    const amountSol = parseAmount(body.amountSol);
    const key = `${user.id}`;
    const last = this.lastGrant.get(key) ?? 0;
    if (Date.now() - last < RATE_LIMIT_MS) {
      fail(HttpStatus.TOO_MANY_REQUESTS, 'Faucet rate limit: one grant per 24h per user.');
    }
    // Helius devnet does not implement requestAirdrop; keep faucet on the
    // public devnet RPC even when the chain reads/writes use a fallback.
    const connection = this.program.faucetConnection();
    const genesis = await connection.getGenesisHash();
    if (genesis !== DEVNET_GENESIS_HASH) {
      fail(HttpStatus.BAD_REQUEST, 'Faucet runs on devnet only.');
    }
    const sig = await connection.requestAirdrop(new PublicKey(address), Math.floor(amountSol * LAMPORTS_PER_SOL));
    this.lastGrant.set(key, Date.now());
    return { success: true, data: { signature: sig, address, amountSol } };
  }

  /** User-triggered post-deposit/withdraw poll so the UI sees shares immediately. */
  @Post('pools/:id/sync')
  @UseGuards(AuthGuard)
  async sync(@Param('id') id: string, @Req() req: { user?: AuthedUser }): Promise<Record<string, unknown>> {
    if (!req.user) fail(HttpStatus.UNAUTHORIZED, 'Authentication required.');
    const vaultId = parseInt(id, 10);
    if (!Number.isInteger(vaultId) || vaultId <= 0) fail(HttpStatus.BAD_REQUEST, 'Invalid pool id.');
    const result = await this.indexer.syncVault(vaultId);
    return { success: true, data: result };
  }

  /** Same-origin RPC fallback for browser chain reads/writes; key stays server-side. */
  @Post('rpc')
  @UseGuards(AuthGuard)
  async rpc(@Body() body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!body || typeof body !== 'object') fail(HttpStatus.BAD_REQUEST, 'Invalid JSON-RPC body.');
    return this.program.proxyRpc(body);
  }
}
