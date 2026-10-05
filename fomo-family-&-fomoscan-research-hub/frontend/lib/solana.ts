/**
 * Browser-wallet signing via injected providers (Phantom / OKX / Solflare…).
 * Zero new deps — graceful fallback to paste-signature when no wallet is present.
 * NOTE: viem is EVM-only and cannot sign Solana (ed25519) messages, so Solana
 * login uses injected-provider signMessage (wallet-standard compatible shapes).
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(input: Uint8Array): string {
  let num = 0n;
  for (const b of input) num = (num << 8n) + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  let leading = 0;
  for (const b of input) {
    if (b === 0) leading++;
    else break;
  }
  return '1'.repeat(leading) + out;
}

export interface InjectedSolanaProvider {
  isPhantom?: boolean;
  isOkx?: boolean;
  isSolflare?: boolean;
  publicKey?: { toBase58(): string };
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(
    message: Uint8Array,
    display?: string,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
}

export type WalletId = 'phantom' | 'okx' | 'solflare' | 'generic';

export interface DetectedWallet {
  id: WalletId;
  label: string;
  installUrl: string;
  installed: boolean;
  provider: InjectedSolanaProvider | null;
}

interface WindowWithWallets {
  solana?: InjectedSolanaProvider;
  phantom?: { solana?: InjectedSolanaProvider };
  okxwallet?: { solana?: InjectedSolanaProvider };
  solflare?: InjectedSolanaProvider;
}

function asProvider(p: unknown): InjectedSolanaProvider | null {
  const c = p as InjectedSolanaProvider | null | undefined;
  return c && typeof c.signMessage === 'function' && typeof c.connect === 'function' ? c : null;
}

/** Detect installed Solana wallets (Phantom → OKX → Solflare → generic). */
export function detectWallets(): DetectedWallet[] {
  if (typeof window === 'undefined') return [];
  const w = window as unknown as WindowWithWallets;
  const phantom = asProvider(w.phantom?.solana) ?? (w.solana?.isPhantom ? asProvider(w.solana) : null);
  const okx = asProvider(w.okxwallet?.solana);
  const solflare =
    asProvider(w.solflare) ?? (!w.solana?.isPhantom && !okx ? asProvider(w.solana) : null);
  const generic = !phantom && !okx && !solflare ? asProvider(w.solana) : null;
  return [
    { id: 'phantom', label: 'Phantom', installUrl: 'https://phantom.app', installed: !!phantom, provider: phantom },
    { id: 'okx', label: 'OKX Wallet', installUrl: 'https://www.okx.com/web3', installed: !!okx, provider: okx },
    { id: 'solflare', label: 'Solflare', installUrl: 'https://solflare.com', installed: !!solflare, provider: solflare },
    ...(generic ? [{ id: 'generic' as WalletId, label: 'Browser wallet', installUrl: '', installed: true, provider: generic }] : []),
  ];
}

/** Legacy single-provider lookup (first available). Prefer detectWallets(). */
export function getInjectedProvider(): InjectedSolanaProvider | null {
  for (const d of detectWallets()) {
    if (d.installed && d.provider) return d.provider;
  }
  return null;
}

/** Connect a specific detected wallet and return its Base58 address. */
export async function connectProvider(provider: InjectedSolanaProvider): Promise<string> {
  const res = await provider.connect();
  const addr = res?.publicKey?.toBase58() ?? provider.publicKey?.toBase58();
  if (!addr) throw new Error('Wallet did not expose an address. Unlock it and retry.');
  return addr;
}

/** Connect the browser wallet and return its Base58 address. */
export async function connectBrowserWallet(): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      'No Solana wallet found in this browser. Install Phantom or OKX Wallet, or use paste-signature below.',
    );
  }
  return connectProvider(provider);
}

function normalizeSignature(ret: { signature: Uint8Array } | Uint8Array): Uint8Array {
  if (ret instanceof Uint8Array) return ret;
  if (ret && (ret as { signature?: unknown }).signature instanceof Uint8Array) {
    return (ret as { signature: Uint8Array }).signature;
  }
  throw new Error('Wallet returned an unrecognized signature shape.');
}

/** Sign an exact login message with the given provider → Base58 signature. */
export async function signWithProvider(
  provider: InjectedSolanaProvider,
  message: string,
): Promise<{ wallet: string; signature: string }> {
  if (!provider.publicKey) await provider.connect();
  const wallet = provider.publicKey?.toBase58();
  if (!wallet) throw new Error('Wallet did not expose an address. Unlock it and retry.');
  const ret = await provider.signMessage(new TextEncoder().encode(message));
  return { wallet, signature: base58Encode(normalizeSignature(ret)) };
}

/** Sign an exact login message with the browser wallet → Base58 signature. */
export async function signWithBrowserWallet(message: string): Promise<{ wallet: string; signature: string }> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No Solana wallet found in this browser.');
  return signWithProvider(provider, message);
}
