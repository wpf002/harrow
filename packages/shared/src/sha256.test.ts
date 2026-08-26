import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';

import { Sha256, sha256 } from './sha256.js';

describe('FIPS 180-4 test vectors', () => {
  test.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('sha256(%j)', (input, expected) => {
    expect(sha256(input)).toBe(expected);
  });

  test('one million "a"', () => {
    const h = new Sha256();
    const chunk = 'a'.repeat(1000);
    for (let i = 0; i < 1000; i++) h.update(chunk);
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('agreement with node:crypto', () => {
  test.each([0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 16_384])(
    'matches on a %i-byte buffer',
    (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(sha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    },
  );

  test('streaming in odd chunks matches a single pass', () => {
    const bytes = new Uint8Array(5000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;

    const streamed = new Sha256();
    for (let i = 0; i < bytes.length; i += 37) streamed.update(bytes.subarray(i, i + 37));

    expect(streamed.hex()).toBe(sha256(bytes));
    expect(streamed.hex.bind(streamed)).toThrow(/already been finalised/);
  });

  test('unicode is hashed as UTF-8, not as UTF-16 code units', () => {
    for (const s of ['göing', '½ furlong', '🏇 ascot']) {
      expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});
