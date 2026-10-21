#!/usr/bin/env tsx
/**
 * Devnet E2E — chạy trọn vòng đời `edgepool_vault` trên devnet thật.
 *
 * Flow: initialize_vault → fund user → deposit → update_marks → settle_epoch
 *       → withdraw (min_payout) → record_sim_trade → collect_fees + asserts.
 *
 * Usage:
 *   cd backend && npx tsx scripts/chain/devnet-e2e.ts
 *   E2E_KEYPAIR=/path/to/keypair.json  → override payer (default ~/.config/solana/id.json)
 *
 * Payer cần ≥ ~1.2 devnet SOL (init vault + 0.01 treasury fund + 0.7 fund user + fees).
 * Vault name sinh unique mỗi lần chạy (`e2e<base36-time>`) — không đụng vault cũ.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

// @coral-xyz/anchor là CJS — require() để tránh lỗi named-export interop của Node ESM.
const require = createRequire(import.meta.url);
const { AnchorProvider, BN, Program, Wallet } = require('@coral-xyz/anchor');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDL_PATH = path.resolve(__dirname, '../../../idls/edgepool_vault.json');
const RPC = process.env.CHAIN_E2E_RPC ?? 'https://api.devnet.solana.com';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const LAMPORTS = 1_000_000_000;
const MIN_DEPOSIT = 500_000_000;
const DEPOSIT_AMOUNT = 600_000_000;
const WITHDRAW_RAW = 300_000_000;
const USER_FUND = 0.7 * LAMPORTS;
const MARKS_AMOUNT = 100_000_000;

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

function pda(seeds: Array<Buffer | Uint8Array>, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return pda([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID);
}

function explorer(kind: 'address' | 'tx', v: string): string {
  return `https://explorer.solana.com/${kind}/${v}?cluster=devnet`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

// BN(a).eqn(number) hỏng với number > 2^26 trong bn.js của anchor — luôn dùng eq(bn(x)).
function bn(v: number | string): InstanceType<typeof BN> {
  return new BN(v.toString());
}

/** Ví user cho e2e: E2E_USER_KEYPAIR → VAULT_PRIVATE_KEY trong backend/.env → generate + LƯU file. */
function loadOrCreateUser(): { user: Keypair; source: string; persisted?: string } {
  if (process.env.E2E_USER_KEYPAIR) {
    return { user: loadKeypair(process.env.E2E_USER_KEYPAIR), source: process.env.E2E_USER_KEYPAIR };
  }
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const m = /^VAULT_PRIVATE_KEY=(.*)$/m.exec(fs.readFileSync(envPath, 'utf8'));
    if (m) {
      const raw = m[1].trim().replace(/^["']|["']$/g, '');
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 64) {
          return { user: Keypair.fromSecretKey(Uint8Array.from(arr)), source: 'backend/.env VAULT_PRIVATE_KEY (demo wallet)' };
        }
      } catch {
        /* fallthrough */
      }
    }
  }
  // Fallback: generate + LƯU LẠI để không mất vốn (bài học từ run 1).
  const savePath = '/tmp/opencode/e2e-user.json';
  if (fs.existsSync(savePath)) {
    return { user: loadKeypair(savePath), source: 'reused ' + savePath, persisted: savePath };
  }
  const user = Keypair.generate();
  fs.mkdirSync('/tmp/opencode', { recursive: true });
  fs.writeFileSync(savePath, JSON.stringify(Array.from(user.secretKey)), { mode: 0o600 });
  return { user, source: 'generated', persisted: savePath };
}

function fmtSol(lamports: bigint | number): string {
  return (Number(lamports) / LAMPORTS).toFixed(4) + ' SOL';
}

async function main(): Promise<void> {
  const payerPath = process.env.E2E_KEYPAIR ?? path.join(os.homedir(), '.config', 'solana', 'id.json');
  const payer = loadKeypair(payerPath);
  const conn = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: 'confirmed' });
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
  const program = new Program(idl, provider);
  const programId = program.programId;

  console.log(`— edgepool_vault devnet e2e —`);
  console.log(`RPC        : ${RPC}`);
  console.log(`Program    : ${programId.toBase58()}`);
  console.log(`Payer      : ${payer.publicKey.toBase58()}`);

  const payerBal = BigInt(await conn.getBalance(payer.publicKey));
  console.log(`Payer bal  : ${fmtSol(payerBal)}`);
  assert(payerBal >= BigInt(150_000_000), 'payer cần ≥ 0.15 SOL devnet (init + buffer + fees)');

  // ── user: ví demo project (backend/.env) — không generate để khỏi mất vốn ──
  const { user, source, persisted } = loadOrCreateUser();
  const userBal = BigInt(await conn.getBalance(user.publicKey));
  console.log(`User       : ${user.publicKey.toBase58()} (${source}, bal ${fmtSol(userBal)})`);
  if (persisted) console.log(`  ↳ keypair lưu tại ${persisted} (giữ để chạy lại)`);
  if (userBal < BigInt(650_000_000)) {
    const topUp = USER_FUND - Number(userBal);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: user.publicKey, lamports: topUp }),
      ),
      [payer],
    );
    console.log(`  ↳ top-up user +${fmtSol(topUp)}`);
  }

  // ── PDA ────────────────────────────────────────────────────────────
  const name = `e2e${Date.now().toString(36)}`;
  const vault = pda([Buffer.from('vault'), Buffer.from(name)], programId);
  const shareMint = pda([Buffer.from('shares'), vault.toBuffer()], programId);
  const treasury = pda([Buffer.from('treasury'), vault.toBuffer()], programId);
  const vaultAuthority = pda([Buffer.from('authority'), vault.toBuffer()], programId);
  const userAta = ata(user.publicKey, shareMint);
  console.log(`Vault "${name}" : ${vault.toBase58()}\n`);

  // ── 1. initialize_vault (fee 20%, marks cap 50%) ────────────────────
  const sigInit = await program.methods
    .initializeVault(name, payer.publicKey, 2000, 0, 0, 200, 5000, 0)
    .accounts({
      manager: payer.publicKey,
      vault,
      shareMint,
      treasury,
      vaultAuthority,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  let v = await program.account.vault.fetch(vault);
  assert(v.totalShares.eq(bn(0)), 'shares khởi tạo = 0');
  assert(v.hwmPrice.eq(bn(LAMPORTS)), `hwm khởi tạo = 1.0 (actual ${v.hwmPrice.toString()})`);
  assert(v.feeBps === 2000, 'fee_bps = 2000');
  assert(v.env === 0, 'env = devnet');
  console.log(`1. initialize_vault  ✓  ${sigInit}`);

  // ── 2. deposit 0.6 SOL (bootstrap 1:1) ──────────────────────────────
  const sigDep = await program.methods
    .deposit(new BN(DEPOSIT_AMOUNT))
    .accounts({
      vault,
      treasury,
      shareMint,
      vaultAuthority,
      user: user.publicKey,
      userShareAta: userAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ATA_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();
  const ataBal = await conn.getTokenAccountBalance(userAta);
  v = await program.account.vault.fetch(vault);
  assert(ataBal.value.amount === String(DEPOSIT_AMOUNT), `vSHARE = ${DEPOSIT_AMOUNT} raw`);
  assert(v.totalShares.eq(bn(DEPOSIT_AMOUNT)), 'total_shares khớp mint');
  const treBalAfterDep = BigInt(await conn.getBalance(treasury));
  assert(treBalAfterDep === BigInt(DEPOSIT_AMOUNT + 10_000_000), 'treasury = nạp + buffer 0.01');
  console.log(`2. deposit 0.6 SOL   ✓  ${sigDep}`);

  // ── 3. update_marks (+0.1 — trong delta cap 20% & trần 50%) ─────────
  const sigMarks = await program.methods
    .updateMarks(new BN(MARKS_AMOUNT))
    .accounts({ vault, treasury, keeper: payer.publicKey })
    .rpc();
  v = await program.account.vault.fetch(vault);
  assert(v.marksLamports.eq(bn(MARKS_AMOUNT)), 'marks = 0.1');
  console.log(`3. update_marks      ✓  ${sigMarks}`);

  // ── 4. settle_epoch — phí 20% phần giá vượt HWM ─────────────────────
  const sigSettle = await program.methods
    .settleEpoch()
    .accounts({ vault, treasury, keeper: payer.publicKey })
    .rpc();
  v = await program.account.vault.fetch(vault);
  const feeCredit: bigint = BigInt(v.feeCredit.toString());
  const hwmAfter: bigint = BigInt(v.hwmPrice.toString());
  assert(feeCredit > 0n, 'fee_credit > 0 sau settle');
  assert(hwmAfter > BigInt(LAMPORTS), 'HWM ratchet lên trên 1.0');
  assert(v.epoch.eq(bn(1)), 'epoch = 1');
  console.log(`4. settle_epoch      ✓  phí accrual ${fmtSol(feeCredit)} · HWM ${Number(hwmAfter) / LAMPORTS}`);

  // ── 5. withdraw 0.3 share + min_payout (tính off-chain từ state) ────
  const cash = BigInt(await conn.getBalance(treasury));
  const nav = cash + BigInt(v.marksLamports.toString()) - feeCredit;
  const totalShares = BigInt(v.totalShares.toString());
  const payout = (BigInt(WITHDRAW_RAW) * nav) / totalShares; // floor — khớp program
  const minPayout = (payout * 995n) / 1000n; // tolerance 0.5%
  const userBalBefore = BigInt(await conn.getBalance(user.publicKey));
  const sigWd = await program.methods
    .withdraw(new BN(WITHDRAW_RAW), new BN(minPayout.toString()))
    .accounts({
      vault,
      treasury,
      shareMint,
      vaultAuthority,
      user: user.publicKey,
      userShareAta: userAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();
  const userBalAfter = BigInt(await conn.getBalance(user.publicKey));
  const received = userBalAfter - userBalBefore;
  assert(received === payout, `payout chính xác: nhận ${received} == tính ${payout}`);
  const ataAfter = await conn.getTokenAccountBalance(userAta);
  assert(ataAfter.value.amount === String(DEPOSIT_AMOUNT - WITHDRAW_RAW), 'burn đúng số share');
  console.log(`5. withdraw 0.3      ✓  nhận ${fmtSol(received)} (min_payout ${fmtSol(minPayout)})`);

  // ── 6. record_sim_trade (keeper, devnet-only) ───────────────────────
  const sigSim = await program.methods
    .recordSimTrade(Keypair.generate().publicKey, 0, new BN(1_000), new BN(1_000), new BN(10))
    .accounts({ vault, keeper: payer.publicKey })
    .rpc();
  const txSim = await conn.getTransaction(sigSim, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  assert(
    !!txSim?.meta?.logMessages?.some((l) => l.includes('Instruction: RecordSimTrade')),
    'log RecordSimTrade có mặt',
  );
  console.log(`6. record_sim_trade  ✓  ${sigSim}`);

  // ── 7. collect_fees (toàn bộ fee_credit → fee_sink = manager) ───────
  const sigCollect = await program.methods
    .collectFees(new BN(feeCredit.toString()))
    .accounts({
      vault,
      treasury,
      feeSink: payer.publicKey,
      manager: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  v = await program.account.vault.fetch(vault);
  assert(v.feeCredit.eq(bn(0)), 'fee_credit về 0 sau collect');
  console.log(`7. collect_fees      ✓  ${sigCollect}`);

  // ── summary ─────────────────────────────────────────────────────────
  console.log(`\n— SUMMARY —`);
  console.log(`vault      : ${explorer('address', vault.toBase58())}`);
  console.log(`share mint : ${explorer('address', shareMint.toBase58())}`);
  console.log(`treasury   : ${explorer('address', treasury.toBase58())}`);
  console.log(`user (demo): ${explorer('address', user.publicKey.toBase58())}`);
  console.log(`\n✓ E2E PASS — ${name}`);
}

main().catch((err) => {
  console.error(`\n✗ E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
