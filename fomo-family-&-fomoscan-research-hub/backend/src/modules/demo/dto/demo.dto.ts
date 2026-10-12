import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** POST /api/demo/seed body. All optional — sane demo defaults. */
export class SeedDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  depositSol?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  traderCount?: number;
}

/** POST /api/demo/replay body. vaultId/botId omitted → latest demo pair. */
export class ReplayDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  botId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  skipClose?: boolean;
}

/** POST /api/demo/clone body. */
export class CloneDto {
  @IsInt()
  @Min(1)
  vaultId!: number;
}
/** POST /api/demo/partial-close body (demo vaults only). */
export class PartialCloseDto {
  @IsInt()
  @Min(1)
  vaultId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderId?: number;

  @IsOptional()
  @IsNumber()
  fraction?: number;
}
