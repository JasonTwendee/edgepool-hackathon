import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** POST /api/vaults/deposit/challenge body. */
export class DepositChallengeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsNumber()
  @Min(0.5)
  amountSol!: number;

  @IsString()
  wallet!: string;
}

/** POST /api/vaults/withdraw/challenge body. */
export class WithdrawChallengeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsNumber()
  @Min(0.000000001)
  shares!: number;

  @IsString()
  wallet!: string;
}
