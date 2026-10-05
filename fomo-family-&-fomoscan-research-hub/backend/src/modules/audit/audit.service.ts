import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export interface AuditRecordInput {
  actor: string;
  action: string;
  target?: string;
  reason?: string;
  metaJson?: Record<string, unknown>;
}

/**
 * Append-only audit store. This service exposes create + list ONLY —
 * no update/delete method may ever be added here (see schema comment).
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<{ id: number }> {
    const row = await this.prisma.auditLog.create({
      data: {
        actor: input.actor,
        action: input.action,
        target: input.target ?? null,
        reason: input.reason ?? null,
        metaJson: (input.metaJson ?? null) as never,
      },
    });
    return { id: row.id };
  }

  async list(filters: { actor?: string; action?: string; limit?: number }): Promise<{
    total: number;
    data: unknown[];
  }> {
    const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
    const where: Record<string, unknown> = {};
    if (filters.actor) where.actor = filters.actor;
    if (filters.action) where.action = filters.action;
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit }),
    ]);
    return { total, data: rows };
  }
}
