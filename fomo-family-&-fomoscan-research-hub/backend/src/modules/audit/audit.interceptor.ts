import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthedUser } from '../../common/auth/guards.js';
import { AuditService } from './audit.service.js';

/** Mark a route as audited. Guards (AuthGuard+RolesGuard) must run first. */
export const Audit = (action: string): MethodDecorator & ClassDecorator =>
  SetMetadata('audit:action', action) as MethodDecorator & ClassDecorator;

/**
 * Records an audit row AFTER the handler succeeds. Audit failure never breaks
 * the operation itself (warn + continue) — availability over audit completeness,
 * documented tradeoff; the review gate must confirm this stays acceptable.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>('audit:action', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return next.handle();
    const req = context.switchToHttp().getRequest() as {
      user?: AuthedUser;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      method?: string;
      url?: string;
    };
    // Only audited (guarded) routes reach here with a user; skip anonymous.
    const user = req.user;
    if (!user) return next.handle();
    return next.handle().pipe(
      tap({
        next: () => {
          const params = req.params ?? {};
          const target =
            params.wallet ?? params.id ?? params.address ?? `${req.method ?? ''} ${req.url ?? ''}`;
          const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
          void this.audit
            .record({ actor: user.wallet, action, target: String(target).slice(0, 200), reason })
            .catch((e: unknown) => {
              console.warn('[audit] record failed (op already succeeded):', (e as Error).message);
            });
        },
      }),
    );
  }
}
