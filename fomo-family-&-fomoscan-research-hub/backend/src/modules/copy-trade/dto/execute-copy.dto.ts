import { Equals, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/** POST /api/copy-trade/execute body. Mirrors openapi.yaml#ExecuteCopyDto.
 * Legacy sim: all-optional. Paper mode: `mode:'paper'` + `confirm:true`
 * required (devnet only, 1-click gate). */
export class ExecuteCopyDto {
  @IsOptional()
  @IsString()
  masterTxHash?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsNumber()
  amountUsd?: number;

  @IsOptional()
  @IsString()
  venue?: string;

  /** Token mint for Qualify (RugCheck) + Manage pricing. */
  @IsOptional()
  @IsString()
  tokenMint?: string;

  @IsOptional()
  @IsString()
  masterWallet?: string;

  @IsOptional()
  @IsString()
  masterHandle?: string;

  @IsOptional()
  @IsIn(['paper'])
  mode?: 'paper';

  @IsOptional()
  @Equals(true)
  confirm?: true;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxSlippageBps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  @Max(0.01)
  paperAmountSol?: number;

  /** Solution v2 (A1): immediate = fire 100% on qualify (default);
   * scaled|patient reserved for the Manage engine (B2). */
  @IsOptional()
  @IsIn(['immediate', 'scaled', 'patient'])
  entryMode?: 'immediate' | 'scaled' | 'patient';

  @IsOptional()
  @IsNumber()
  @Min(1)
  tp1Pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(90)
  stopPct?: number;

  /** Measured % price run-up master fill → vault fill (B1 auto-computes
   * from candles; v1 accepts FE-provided value or null). */
  @IsOptional()
  @IsNumber()
  delayDragPct?: number;

  /** Per-order ladder config (null = engine defaults: 5000/20/200).
   * tp1ShareBps 1..10000, trailPct 1..100, tp2MultPct 101..1000. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  tp1ShareBps?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  trailPct?: number;

  @IsOptional()
  @IsInt()
  @Min(101)
  @Max(1000)
  tp2MultPct?: number;

  /** ATR regime auto-tune (default true). False = fixed 60/30/20 defaults
   * unless explicit tp1/stop/trail params are given (explicit always wins). */
  @IsOptional()
  @IsBoolean()
  autoTune?: boolean;
}
