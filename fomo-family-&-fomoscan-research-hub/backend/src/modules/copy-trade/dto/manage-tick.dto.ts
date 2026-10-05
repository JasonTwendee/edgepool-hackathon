import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** POST /api/copy-trade/manage/tick body (ADMIN). Mirrors openapi.yaml. */
export class ManageTickDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
