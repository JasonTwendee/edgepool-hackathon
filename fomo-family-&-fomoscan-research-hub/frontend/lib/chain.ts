/**
 * On-chain vault client (P3). Devnet connection, Anchor program, PDA helpers,
 * deposit/withdraw builders, browser-wallet send + confirm, VI error mapping.
 * Used only when pool detail carries a `chain` block (chain-bound vaults).
 */
import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import idl from './idl/edgepool_vault.json';
import { getInjectedProvider, type InjectedSolanaProvider } from './solana';
import { getStoredToken } from './api';

export const CHAIN_DEVNET_RPC = 'https://api.devnet.solana.com';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MIN_DEPOSIT_LAMPORTS = 500_000_000;

export interface ChainPdas {
  vault: PublicKey;
  treasury: PublicKey;
  shares: PublicKey;
  authority: PublicKey;
}

export interface ChainVaultState {
  totalShares: bigint;
  hwmPrice: bigint;
  marks: bigint;
  feeCredit: bigint;
  feeBps: number;
  withdrawFeeBps: number;
  paused: boolean;
  treasuryCash: bigint;
}

export function txUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function getChainConnection(): Connection {
  return new Connection(CHAIN_DEVNET_RPC, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: async (input, init) => {
      try {
        const primary = await fetch(input, init);
        if (primary.status !== 429 && primary.status < 500) return primary;
      } catch {
        // fall through to the server-side proxy
      }
      const token = getStoredToken();
      const headers = new Headers(init?.headers);
      headers.set('content-type', 'application/json');
      if (token) headers.set('authorization', `Bearer ${token}`);
      return fetch('/api/chain/rpc', {
        method: 'POST',
        headers,
        body: (init?.body ?? null) as BodyInit | null,
      });
    },
  });
}

async function confirmSignature(connection: Connection, signature: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const value = status.value[0];
    if (value?.err) throw new Error(`Giao dịch thất bại on-chain: ${JSON.stringify(value.err)}`);
    if (
      value &&
      (value.confirmationStatus === 'confirmed' ||
        value.confirmationStatus === 'finalized' ||
        value.confirmations === null)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Giao dịch chưa được xác nhận sau 90s — kiểm tra explorer rồi thử lại.');
}

export function pdasFor(vaultAddr: string, programId: string): ChainPdas {
  const pid = new PublicKey(programId);
  const vault = new PublicKey(vaultAddr);
  const [treasury] = PublicKey.findProgramAddressSync([Buffer.from('treasury'), vault.toBuffer()], pid);
  const [shares] = PublicKey.findProgramAddressSync([Buffer.from('shares'), vault.toBuffer()], pid);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from('authority'), vault.toBuffer()], pid);
  return { vault, treasury, shares, authority };
}

export function operationPda(
  programId: string,
  vaultAddr: string,
  walletAddress: string,
  kind: 0 | 1,
  operationId: number | bigint | string,
): PublicKey {
  const pid = new PublicKey(programId);
  const vault = new PublicKey(vaultAddr);
  const user = new PublicKey(walletAddress);
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, BigInt(operationId), true);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('operation'), Uint8Array.from([kind]), vault.toBuffer(), user.toBuffer(), id],
    pid,
  );
  return pda;
}

export function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata;
}

interface WalletAdapter {
  publicKey: PublicKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction(tx: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAllTransactions(txs: any[]): Promise<any[]>;
}

function wrapInjected(provider: InjectedSolanaProvider, address: string): WalletAdapter {
  const publicKey = new PublicKey(address);
  const p = provider as unknown as Record<string, unknown>;
  const signTransaction = async (tx: Transaction): Promise<Transaction> => {
    if (typeof p.signTransaction === 'function') {
      return (p.signTransaction as (tx: Transaction) => Promise<Transaction>).call(p, tx);
    }
    // Fallback: serialize, sign bytes, rebuild.
    const msg = tx.serializeMessage();
    const ret = await provider.signMessage(new Uint8Array(msg));
    const sig = ret instanceof Uint8Array ? ret : ret.signature;
    tx.addSignature(publicKey, Buffer.from(sig));
    return tx;
  };
  return {
    publicKey,
    signTransaction,
    signAllTransactions: async (txs: Transaction[]) => Promise.all(txs.map((t) => signTransaction(t))),
  };
}

export async function getChainProgram(
  connection: Connection,
  programId: string,
  walletAddress: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ program: any; wallet: WalletAdapter; provider: InjectedSolanaProvider }> {
  const injected = getInjectedProvider();
  if (!injected) throw new Error('Chưa thấy ví Solana trong trình duyệt. Cài Phantom hoặc OKX Wallet rồi thử lại.');
  const wallet = wrapInjected(injected, walletAddress);
  const provider = new AnchorProvider(connection, wallet as never, { commitment: 'confirmed' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idl as any, provider) as any;
  void programId;
  return { program, wallet, provider: injected };
}

export async function fetchChainState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: any,
  pdas: ChainPdas,
  connection: Connection,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ state: ChainVaultState; price: bigint }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (await program.account.vault.fetch(pdas.vault)) as any;
  const cash = BigInt(await connection.getBalance(pdas.treasury));
  const totalShares = BigInt(String(v.totalShares ?? 0));
  const marks = BigInt(String(v.marksLamports ?? 0));
  const feeCredit = BigInt(String(v.feeCredit ?? 0));
  const nav = cash + marks - feeCredit;
  const price = totalShares > 0n ? (nav * 1_000_000_000n) / totalShares : 1_000_000_000n;
  return {
    state: {
      totalShares,
      hwmPrice: BigInt(String(v.hwmPrice ?? 1_000_000_000)),
      marks,
      feeCredit,
      feeBps: Number(v.feeBps ?? 0),
      withdrawFeeBps: Number(v.withdrawFeeBps ?? 0),
      paused: Number(v.flags ?? 0) % 2 === 1,
      treasuryCash: cash,
    },
    price,
  };
}

export function estimateMint(amountLamports: bigint, supply: bigint, nav: bigint): bigint {
  if (supply === 0n) return amountLamports;
  if (nav <= 0n) throw new Error('NAV không hợp lệ để định giá lúc này.');
  return (amountLamports * supply) / nav;
}

export function estimatePayout(shares: bigint, nav: bigint, supply: bigint): bigint {
  if (supply === 0n) throw new Error('Vault chưa có share nào.');
  return (shares * nav) / supply;
}

/** Gửi deposit on-chain: trả về tx signature + số share ước tính. */
export async function chainDeposit(
  programId: string,
  vaultAddr: string,
  walletAddress: string,
  amountSol: number,
  operationId: number | bigint | string,
  opts: { confirm?: boolean } = {},
): Promise<{ signature: string; estimatedShares: string }> {
  if (!(amountSol >= 0.5)) throw new Error('Nạp tối thiểu 0.5 SOL.');
  const connection = getChainConnection();
  const { program } = await getChainProgram(connection, programId, walletAddress);
  const pdas = pdasFor(vaultAddr, programId);
  const { state, price } = await fetchChainState(program, pdas, connection);
  if (state.paused) throw new Error('Vault đang tạm dừng nạp tiền.');
  const amount = BigInt(Math.floor(amountSol * 1_000_000_000));
  if (amount < BigInt(MIN_DEPOSIT_LAMPORTS)) throw new Error('Nạp tối thiểu 0.5 SOL.');
  const nav = state.treasuryCash + state.marks - state.feeCredit;
  const minted = estimateMint(amount, state.totalShares, nav);
  if (minted <= 0n) throw new Error('Số tiền quá nhỏ, không mint được share nào.');
  const userAta = ataFor(new PublicKey(walletAddress), pdas.shares);
  const operation = operationPda(programId, vaultAddr, walletAddress, 0, operationId);
  const tx: Transaction = await program.methods
    .deposit(new BN(amount.toString()), new BN(operationId.toString()))
    .accounts({
      vault: pdas.vault,
      treasury: pdas.treasury,
      shareMint: pdas.shares,
      vaultAuthority: pdas.authority,
      user: new PublicKey(walletAddress),
      operation,
      userShareAta: userAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
  const signature = await sendViaWallet(connection, walletAddress, tx, opts.confirm !== false);
  void price;
  return { signature, estimatedShares: (Number(minted) / 1_000_000_000).toFixed(4) };
}

/** Gửi withdraw on-chain với min_payout guard (mặc định = estimate − 0.5%). */
export async function chainWithdraw(
  programId: string,
  vaultAddr: string,
  walletAddress: string,
  shares: number,
  minPayoutSol: number | undefined,
  operationId: number | bigint | string,
  opts: { confirm?: boolean } = {},
): Promise<{ signature: string; estimatedPayout: string }> {
  if (!(shares > 0)) throw new Error('Số share phải lớn hơn 0.');
  const connection = getChainConnection();
  const { program } = await getChainProgram(connection, programId, walletAddress);
  const pdas = pdasFor(vaultAddr, programId);
  const { state } = await fetchChainState(program, pdas, connection);
  const nav = state.treasuryCash + state.marks - state.feeCredit;
  const raw = BigInt(Math.floor(shares * 1_000_000_000));
  if (raw > state.totalShares) throw new Error('Số dư share không đủ.');
  const payout = estimatePayout(raw, nav, state.totalShares);
  const fee = (payout * BigInt(state.withdrawFeeBps)) / 10_000n;
  const paid = payout - fee;
  const minPayout =
    minPayoutSol !== undefined
      ? BigInt(Math.floor(minPayoutSol * 1_000_000_000))
      : (paid * 9_950n) / 10_000n;
  if (minPayout > paid) throw new Error('Ước tính payout thấp hơn ngưỡng tối thiểu — thử lại.');
  const userAta = ataFor(new PublicKey(walletAddress), pdas.shares);
  const operation = operationPda(programId, vaultAddr, walletAddress, 1, operationId);
  const tx: Transaction = await program.methods
    .withdraw(new BN(raw.toString()), new BN(minPayout.toString()), new BN(operationId.toString()))
    .accounts({
      vault: pdas.vault,
      treasury: pdas.treasury,
      shareMint: pdas.shares,
      vaultAuthority: pdas.authority,
      user: new PublicKey(walletAddress),
      operation,
      userShareAta: userAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
  const signature = await sendViaWallet(connection, walletAddress, tx, opts.confirm !== false);
  return { signature, estimatedPayout: (Number(paid) / 1_000_000_000).toFixed(4) };
}

async function sendViaWallet(
  connection: Connection,
  walletAddress: string,
  tx: Transaction,
  confirm = true,
): Promise<string> {
  const injected = getInjectedProvider();
  if (!injected) throw new Error('Chưa thấy ví Solana trong trình duyệt.');
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = new PublicKey(walletAddress);
  const p = injected as unknown as Record<string, unknown>;
  let signature: string;
  if (typeof p.signAndSendTransaction === 'function') {
    const ret = (await (p.signAndSendTransaction as (tx: Transaction) => Promise<{ signature: string } | string>).call(
      p,
      tx,
    )) as { signature: string } | string;
    signature = typeof ret === 'string' ? ret : ret.signature;
  } else if (typeof p.signTransaction === 'function') {
    const signed = (await (p.signTransaction as (tx: Transaction) => Promise<Transaction>).call(p, tx)) as Transaction;
    signature = await connection.sendRawTransaction(signed.serialize());
  } else {
    throw new Error('Ví không hỗ trợ ký giao dịch. Dùng Phantom hoặc OKX Wallet bản mới.');
  }
  if (confirm) await confirmSignature(connection, signature);
  return signature;
}

/** Lấy số dư SOL của ví (để hiện nút faucet khi thấp). */
export async function getWalletSol(address: string): Promise<number | null> {
  try {
    const bal = await getChainConnection().getBalance(new PublicKey(address));
    return bal / 1_000_000_000;
  } catch {
    return null;
  }
}

/** Map lỗi Anchor/program sang tiếng Việt, giữ nguyên văn khi không khớp. */
export function mapChainError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const table: [RegExp, string][] = [
    [/Vault is paused|VaultPaused/, 'Vault đang tạm dừng nạp tiền. Rút tiền vẫn hoạt động.'],
    [/StaleMarks|stale/i, 'Dữ liệu giá đã cũ — keeper đang refresh, thử lại sau ít phút.'],
    [/DepositTooSmall|below the 0.5/, 'Số tiền chưa đạt tối thiểu 0.5 SOL.'],
    [/InsufficientShares|not hold enough/, 'Số dư share không đủ cho lệnh rút này.'],
    [/InsufficientLiquidity/, 'Treasury không đủ tiền mặt trả payout lúc này — thử số nhỏ hơn.'],
    [/ReserveFloorBreached|reserve floor/, 'Lệnh rút chạm sàn dự trữ của vault — thử số nhỏ hơn.'],
    [/PayoutBelowMin|below min_payout/, 'Giá trượt quá ngưỡng tối thiểu — thử lại.'],
    [/NotKeeper|not the keeper/, 'Ví này không phải keeper của vault.'],
    [/NotManager|not the manager/, 'Ví này không phải manager của vault.'],
    [/User rejected|rejected the request/, 'Bạn đã từ chối ký trong ví.'],
    [/Blockhash not found|blockhash/i, 'Blockhash hết hạn — bấm lại để ký giao dịch mới.'],
  ];
  for (const [re, vi] of table) {
    if (re.test(msg)) return vi;
  }
  return msg;
}
