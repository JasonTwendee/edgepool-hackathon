import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthedUser } from '../../common/auth/guards.js';
import { ChainIndexerService } from './indexer.service.js';
import { ChainOperationService } from './chain-operation.service.js';

@Controller('api/chain')
export class ChainOperationController {
  constructor(
    @Inject(ChainOperationService) private readonly operations: ChainOperationService,
    @Inject(ChainIndexerService) private readonly indexer: ChainIndexerService,
  ) {}

  @Post('pools/:id/operations')
  @UseGuards(AuthGuard)
  async create(
    @Req() req: { user?: AuthedUser },
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!req.user) throw new Error('Authentication required.');
    const vaultId = parseInt(id, 10);
    const result = await this.operations.create(req.user, vaultId, idempotencyKey ?? '', body);
    return { success: true, data: result };
  }

  @Post('operations/:id/submit')
  @HttpCode(202)
  @UseGuards(AuthGuard)
  async submit(
    @Req() req: { user?: AuthedUser },
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!req.user) throw new Error('Authentication required.');
    const operationId = parseInt(id, 10);
    const operation = await this.operations.submit(
      req.user,
      operationId,
      String(body.signature ?? ''),
    );
    if (operation.txSignature) {
      this.indexer.enqueueSignature(operation.vaultId, operation.txSignature);
    }
    return { success: true, data: operation };
  }

  @Get('operations/:id')
  @UseGuards(AuthGuard)
  async get(
    @Req() req: { user?: AuthedUser },
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    if (!req.user) throw new Error('Authentication required.');
    return { success: true, data: await this.operations.get(req.user, parseInt(id, 10)) };
  }
}
