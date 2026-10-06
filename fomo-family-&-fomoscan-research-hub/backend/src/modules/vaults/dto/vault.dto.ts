import { IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** POST /api/vaults body (ADMIN). Mirrors openapi.yaml. */
export class CreateVaultDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

/** POST /api/vaults/:id/traders body (ADMIN). */
export class AssignTraderDto {
  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  weightBps?: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

/** POST /api/vaults/:id/policy body (ADMIN). Mirrors openapi.yaml. */
export class VaultPolicyDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  feeBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  reserveBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  withdrawFeeBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  lockHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  settlePeriodHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  settleLengthMin?: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

/** POST /api/vaults/deposit body. Mirrors openapi.yaml#VaultDepositDto. */
export class VaultDepositDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsOptional()
  @IsString()
  depositor?: string;

  @IsNumber()
  @Min(0.000000001)
  amountSol!: number;
}

/** POST /api/vaults/withdraw body. Mirrors openapi.yaml#VaultWithdrawDto. */
export class VaultWithdrawDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsOptional()
  @IsString()
  depositor?: string;

  @IsNumber()
  @Min(0.000000001)
  shares!: number;
}

/** POST /api/vaults/settle body. Mirrors openapi.yaml#VaultSettleDto. */
export class VaultSettleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  navSol?: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;
}
