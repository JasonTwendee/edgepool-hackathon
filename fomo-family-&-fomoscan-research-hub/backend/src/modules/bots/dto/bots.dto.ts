import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** POST /api/bots body. Mirrors openapi.yaml. */
export class CreateBotDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  vaultId?: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

/** POST /api/bots/:id/mode body. */
export class SetBotModeDto {
  @IsIn(['AUTO', 'PAUSED'])
  mode!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}
