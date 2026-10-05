import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Explicit DTO validation — required because tsx/esbuild does not emit
 * decorator metadata, so the global ValidationPipe cannot infer @Query/@Body
 * types at runtime (it stays as a second layer for tsc builds).
 * Call this in controllers before passing bodies to services.
 */
export async function validateDto<T extends object>(
  cls: new () => T,
  plain: unknown,
): Promise<T> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
  if (errors.length > 0) {
    const message =
      errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') ||
      'Invalid request data.';
    throw new BadRequestException({ success: false, message });
  }
  return dto;
}
