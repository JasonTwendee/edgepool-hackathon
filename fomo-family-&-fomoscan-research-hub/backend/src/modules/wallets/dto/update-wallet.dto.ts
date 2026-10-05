import { IsBoolean, IsNumber, IsOptional, Max } from 'class-validator';

/** PATCH /api/wallets/:address body. Mirrors openapi.yaml#UpdateWalletDto. */
export class UpdateWalletDto {
  @IsOptional()
  @IsBoolean()
  isCopyEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Max(99.99) // DB: allocation_weight NUMERIC(4,2)
  allocationWeight?: number;
}
