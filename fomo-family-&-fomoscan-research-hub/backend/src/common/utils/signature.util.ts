const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Random 88-char Base58 signature for simulated copy-trade vault tx. */
export function generateRandomSignature(): string {
  let out = '';
  for (let i = 0; i < 88; i++) {
    out += BASE58[Math.floor(Math.random() * BASE58.length)];
  }
  return out;
}

export function isBase58Address(value: string): boolean {
  return typeof value === 'string' && value.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}
