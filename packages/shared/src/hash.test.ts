import { expect, test } from 'vitest';
import { canonicalJson, hashInputs, hashRawReading, sha256Hex } from './hash.js';

test('key order does not change the hash', () => {
  expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
});

test('nested key order does not change the hash', () => {
  expect(hashInputs({ x: { p: 1, q: 2 }, y: [1, 2] })).toBe(
    hashInputs({ y: [1, 2], x: { q: 2, p: 1 } }),
  );
});

test('array order does change the hash', () => {
  expect(hashInputs([1, 2])).not.toBe(hashInputs([2, 1]));
});

test('negative zero normalises', () => {
  expect(canonicalJson(-0)).toBe('0');
});

test('non-finite numbers are refused rather than hashed as null', () => {
  expect(() => hashInputs({ v: Number.NaN })).toThrow(/non-finite/);
  expect(() => hashInputs({ v: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
});

test('hash is stable across runs', () => {
  expect(sha256Hex('harrow')).toBe(sha256Hex('harrow'));
  expect(hashInputs({ indexName: 'physical_index', version: 'v1' })).toHaveLength(64);
});

test('raw reading hash depends on the bytes and not on anything derived', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([5, 6, 7, 8]);
  const takenAt = new Date('2026-03-14T07:30:00.000Z');
  const base = {
    instrumentSerial: 'HR-0001',
    takenAt,
    forceDepthCurve: a,
    driveRateProfile: b,
  };
  expect(hashRawReading(base)).toBe(hashRawReading({ ...base }));
  expect(hashRawReading(base)).toBe(hashRawReading({ ...base, takenAt: takenAt.toISOString() }));
  expect(hashRawReading(base)).not.toBe(
    hashRawReading({ ...base, forceDepthCurve: new Uint8Array([1, 2, 3, 5]) }),
  );
  expect(hashRawReading(base)).not.toBe(hashRawReading({ ...base, instrumentSerial: 'HR-0002' }));
});
