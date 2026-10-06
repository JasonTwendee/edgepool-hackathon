import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** POST /api/copy-trade/auto-fire/tick body (ADMIN). Mirrors openapi.yaml. */
export class AutoFireTickDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
