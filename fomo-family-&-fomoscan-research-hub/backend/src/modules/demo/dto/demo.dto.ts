import { IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

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
}
