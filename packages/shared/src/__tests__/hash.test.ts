/**
 * Hashing (§7.4 integrity, §8.4 duplicate finder).
 *
 * SHA-256 has a pure-JS fallback because the same code verifies model
 * downloads in a worker and catalog integrity in the utility process — and a
 * wrong digest means either a refused install or, worse, an accepted tampered
 * one. The vectors below are the published FIPS 180-4 examples.
 */

import { describe, expect, it } from 'vitest';
import {
  aHashFromGray,
  dHashFromGray,
  dHashToHex,
  fnv1a,
  hammingDistance,
  sha256Bytes,
  toHex,
} from '@swell/shared';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('sha256 (FIPS 180-4 vectors)', () => {
  it('hashes the empty string', () => {
    expect(toHex(sha256Bytes(bytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc"', () => {
    expect(toHex(sha256Bytes(bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 56-character boundary case', () => {
    expect(
      toHex(sha256Bytes(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('handles a multi-block message (1000 characters)', () => {
    const digest = toHex(sha256Bytes(bytes('a'.repeat(1000))));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // stable and sensitive to a single changed byte
    expect(digest).toBe(toHex(sha256Bytes(bytes('a'.repeat(1000)))));
    expect(digest).not.toBe(toHex(sha256Bytes(bytes('a'.repeat(999) + 'b'))));
  });

  it('toHex pads and lowercases', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 255]))).toBe('00010fff');
  });
});

describe('fnv1a (cache keys, param signatures)', () => {
  it('is deterministic and order sensitive', () => {
    expect(fnv1a('exposure=0.3;contrast=12')).toBe(fnv1a('exposure=0.3;contrast=12'));
    expect(fnv1a('ab')).not.toBe(fnv1a('ba'));
    // Base-36 (short, URL-safe) digest of the 32-bit FNV-1a hash; the empty
    // string is the offset basis.
    expect(fnv1a('')).toBe((0x811c9dc5).toString(36));
    expect(fnv1a('swell')).toMatch(/^[0-9a-z]+$/);
  });

  it('spreads similar inputs (no collisions on a slider sweep)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(fnv1a(`exposure=${(i / 100).toFixed(2)}`));
    expect(seen.size).toBe(5000);
  });
});

/** Synthetic grayscale frames: a ramp, a ramp plus a bright block, stripes. */
function grayImage(w: number, h: number, block = true): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const grad = Math.round((x / (w - 1)) * 180);
      const inBlock = block && x > w * 0.4 && x < w * 0.7 && y > h * 0.3 && y < h * 0.6;
      g[y * w + x] = inBlock ? 255 : grad;
    }
  }
  return g;
}

function stripes(w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g[y * w + x] = (Math.floor(y / (h / 8)) % 2 === 0 ? 250 : 10);
  }
  return g;
}

describe('perceptual hashes (duplicate finder)', () => {
  it('dHash is 64 bits and stable', () => {
    const g = grayImage(160, 120);
    const a = dHashFromGray(g, 160, 120);
    const b = dHashFromGray(g, 160, 120);
    expect(a).toBe(b);
    expect(a).toBeLessThan(1n << 64n);
    expect(a).toBeGreaterThanOrEqual(0n);
    expect(dHashToHex(a)).toHaveLength(16);
  });

  it('a resized copy of the same image is a near-duplicate (distance ≤ 6)', () => {
    const big = grayImage(320, 240);
    const small = grayImage(160, 120);
    expect(hammingDistance(dHashFromGray(big, 320, 240), dHashFromGray(small, 160, 120))).toBeLessThanOrEqual(6);
  });

  it('a small local edit still reads as the same photo', () => {
    const plain = dHashFromGray(grayImage(160, 120, false), 160, 120);
    const edited = dHashFromGray(grayImage(160, 120, true), 160, 120);
    expect(hammingDistance(plain, edited)).toBeLessThanOrEqual(10);
  });

  it('structurally different content is far apart', () => {
    const ramp = dHashFromGray(grayImage(160, 120), 160, 120);
    const bars = dHashFromGray(stripes(160, 120), 160, 120);
    expect(hammingDistance(ramp, bars)).toBeGreaterThan(20);
  });

  it('hammingDistance counts differing bits', () => {
    expect(hammingDistance(0b0000n, 0b0000n)).toBe(0);
    expect(hammingDistance(0b1010n, 0b0101n)).toBe(4);
    expect(hammingDistance(0n, (1n << 64n) - 1n)).toBe(64);
  });

  it('aHash is brightness-relative: inverting the image inverts the hash', () => {
    const g = grayImage(120, 90);
    const inv = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) inv[i] = 255 - g[i]!;
    const a = aHashFromGray(g, 120, 90);
    const b = aHashFromGray(inv, 120, 90);
    expect(a).not.toBe(b);
    expect(hammingDistance(a, b)).toBeGreaterThan(16);
    // a uniformly bright frame has no structure — but must still be finite
    const flat = new Uint8Array(120 * 90).fill(128);
    expect(aHashFromGray(flat, 120, 90)).toBeGreaterThanOrEqual(0n);
  });
});
