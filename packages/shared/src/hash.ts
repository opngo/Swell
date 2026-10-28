/**
 * Hashing — duplicate detection, cache keys, catalog integrity.
 *
 * `sha256Hex` uses SubtleCrypto when available (renderer + worker) and falls
 * back to a small pure-JS SHA-256 so the same code runs in tests under Node
 * without the webcrypto global.
 */

/* --------------------------------------------------------------- sha-256 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Bytes(msg: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const l = msg.length;
  const withPad = new Uint8Array((((l + 9) >> 6) + 1) << 6);
  withPad.set(msg);
  withPad[l] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, (l * 8) >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor((l * 8) / 4294967296), false);
  const w = new Uint32Array(64);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = H[0]!,
      b = H[1]!,
      c = H[2]!,
      d = H[3]!,
      e = H[4]!,
      f = H[5]!,
      g = H[6]!,
      h = H[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]!, false);
  return out;
}

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

export const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (cryptoObj?.subtle) {
    try {
      const digest = await cryptoObj.subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return toHex(new Uint8Array(digest));
    } catch {
      /* fall through to the JS implementation (e.g. insecure origin) */
    }
  }
  return toHex(sha256Bytes(bytes));
}

/** Fast non-crypto string hash for cache keys and LUT signatures. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/* ---------------------------------------------------- perceptual hashing */

/**
 * dHash: 8×8 difference hash over a grayscale downsample.
 * Hamming distance ≤ 6 is a strong near-duplicate signal (§8.4).
 */
export function dHashFromGray(gray: Uint8Array | Float32Array, w: number, h: number): bigint {
  const SW = 9,
    SH = 8;
  const small = new Float32Array(SW * SH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / SW));
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / SH));
      small[y * SW + x] = gray[sy * w + sx] as number;
    }
  }
  let out = 0n;
  let bit = 0;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW - 1; x++) {
      if (small[y * SW + x]! < small[y * SW + x + 1]!) out |= 1n << BigInt(bit);
      bit++;
    }
  }
  return out;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export const dHashToHex = (h: bigint): string => h.toString(16).padStart(16, '0');

/** Average hash — used as a cheap pre-filter before dHash comparison. */
export function aHashFromGray(gray: Uint8Array | Float32Array, w: number, h: number): bigint {
  const S = 8;
  const small = new Float32Array(S * S);
  let sum = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / S));
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / S));
      const v = gray[sy * w + sx] as number;
      small[y * S + x] = v;
      sum += v;
    }
  }
  const avg = sum / (S * S);
  let out = 0n;
  for (let i = 0; i < S * S; i++) if (small[i]! > avg) out |= 1n << BigInt(i);
  return out;
}
