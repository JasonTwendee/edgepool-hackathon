import { IsNotEmpty, IsNumber, IsOptional, IsString, Max } from 'class-validator';

/** POST /api/wallets body. Mirrors openapi.yaml#CreateWalletDto. */
export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  handle?: string;

  @IsOptional()
  @IsNumber()
  @Max(99.99) // DB: allocation_weight NUMERIC(4,2)
  allocationWeight?: number;
}
