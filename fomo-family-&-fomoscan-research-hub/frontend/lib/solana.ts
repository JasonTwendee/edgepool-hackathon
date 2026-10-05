/**
 * Browser-wallet signing via injected provider (Phantom / Solflare `window.solana`).
 * Zero new deps — graceful fallback to paste-signature when no wallet is present.
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
  publicKey?: { toBase58(): string };
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
}

export function getInjectedProvider(): InjectedSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { solana?: InjectedSolanaProvider };
  return w.solana && typeof w.solana.signMessage === 'function' ? w.solana : null;
}

/** Connect the browser wallet and return its Base58 address. */
export async function connectBrowserWallet(): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error('No Solana wallet found in this browser. Install Phantom/Solflare or use paste-signature below.');
  }
  const res = await provider.connect();
  return res.publicKey.toBase58();
}

/** Sign an exact login message with the browser wallet → Base58 signature. */
export async function signWithBrowserWallet(message: string): Promise<{ wallet: string; signature: string }> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No Solana wallet found in this browser.');
  if (!provider.publicKey) await provider.connect();
  const wallet = provider.publicKey?.toBase58();
  if (!wallet) throw new Error('Wallet did not expose an address.');
  const { signature } = await provider.signMessage(new TextEncoder().encode(message));
  return { wallet, signature: base58Encode(signature) };
}
