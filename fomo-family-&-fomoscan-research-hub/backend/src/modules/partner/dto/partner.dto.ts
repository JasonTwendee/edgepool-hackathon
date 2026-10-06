import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** POST /api/partner/apply body (public intake). */
export class ApplyDto {
  @IsString()
  @MinLength(2)
  fomoHandle!: string;

  @IsOptional()
  @IsString()
  xHandle?: string;

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(3)
  contact!: string;
}

/** POST /api/partner/payout-wallet/challenge body. */
export class PayoutChallengeDto {
  @IsString()
  @MinLength(32)
  wallet!: string;
}

/** POST /api/partner/payout-wallet body (signature over the challenge message). */
export class PayoutWalletDto {
  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(10)
  signature!: string;
}

/** PATCH /api/partner/pools/:id/settings body (owner or ADMIN). */
export class PoolSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  listing?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxSlots?: number;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(5)
  maxTraders?: number;

  @IsOptional()
  rulesJson?: Record<string, number>;
}

/** POST /api/partner/pools/:id/request-trader body. */
export class RequestTraderDto {
  @IsString()
  @MinLength(2)
  fomoHandle!: string;

  @IsOptional()
  @IsString()
  xHandle?: string;
}

/** POST /api/partner/applications/:id/review body (ADMIN). */
export class ReviewApplicationDto {
  @IsString()
  decision!: string;

  @IsOptional()
  @IsInt()
  vaultId?: number;

  @IsOptional()
  @IsInt()
  userId?: number;
}
