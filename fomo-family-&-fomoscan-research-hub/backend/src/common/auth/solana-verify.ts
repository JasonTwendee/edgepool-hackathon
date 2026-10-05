import { createPublicKey, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

/** Minimal base58 codec (Solana addresses/signatures). No external deps. */
export function base58Decode(input: string): Buffer {
  if (!input || typeof input !== 'string') throw new Error('Empty base58 input.');
  let num = 0n;
  for (const ch of input) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error(`Invalid base58 character: ${ch}`);
    num = num * BASE + BigInt(digit);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }
  // Leading '1's are leading zero bytes.
  let leading = 0;
  for (const ch of input) {
    if (ch === '1') leading += 1;
    else break;
  }
  const out = Buffer.alloc(leading + bytes.length);
  Buffer.from(bytes).copy(out, leading);
  return out;
}

export function base58Encode(input: Buffer | Uint8Array): string {
  const bytes = Buffer.from(input);
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % BASE)] + out;
    num = num / BASE;
  }
  let leading = 0;
  for (const b of bytes) {
    if (b === 0) leading += 1;
    else break;
  }
  return '1'.repeat(leading) + (out || (bytes.length > 0 ? '' : ''));
}

/** Validate a Solana wallet address (base58, 32 bytes when decoded). */
export function decodeWalletAddress(address: string): Buffer {
  const raw = base58Decode(address.trim());
  if (raw.length !== 32) throw new Error('Địa chỉ ví Solana không hợp lệ (phải là 32 bytes).');
  return raw;
}

// DER prefix for Ed25519 SPKI: SEQUENCE { SEQUENCE { OID 1.3.101.112 } } + BIT STRING.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify an Ed25519 signature over a message with a raw 32-byte public key.
 * Pure function (no DI) — used by auth.service.ts and unit asserts.
 */
export function verifyEd25519Signature(
  message: Uint8Array,
  signatureBase58: string,
  publicKeyBase58: string,
): boolean {
  let sig: Buffer;
  let pub: Buffer;
  try {
    sig = base58Decode(signatureBase58.trim());
    pub = decodeWalletAddress(publicKeyBase58);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pub]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, message, key, sig);
  } catch {
    return false;
  }
}
