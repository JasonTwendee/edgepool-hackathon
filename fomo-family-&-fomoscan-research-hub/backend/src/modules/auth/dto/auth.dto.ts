import { IsString, MinLength } from 'class-validator';

/** POST /api/auth/nonce body. Mirrors openapi.yaml#AuthNonce flow. */
export class NonceDto {
  @IsString()
  @MinLength(32)
  wallet!: string;
}

/** POST /api/auth/verify body. */
export class VerifyDto {
  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(64)
  signature!: string;
}

/** POST /api/auth/login body. */
export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}
