import { IsIn, IsString, MinLength } from 'class-validator';

/** POST /api/users/:wallet/role body. Mirrors openapi.yaml. */
export class SetRoleDto {
  @IsIn(['USER', 'KOL', 'ADMIN'])
  role!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}
