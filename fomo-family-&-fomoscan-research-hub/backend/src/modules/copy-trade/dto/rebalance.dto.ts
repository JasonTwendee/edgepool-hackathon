import { IsInt, IsOptional, Min } from 'class-validator';

/** POST /api/copy-trade/allocation/rebalance body (ADMIN). Mirrors openapi.yaml. */
export class RebalanceDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;
}
