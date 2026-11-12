import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../sha256';

const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

afterEach(() => vi.unstubAllGlobals());

describe('sha256Hex: vetores oficiais (FIPS 180-4)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ])('hash de %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('1.000.000 de "a"', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('sha256Hex: confere com node:crypto', () => {
  it.each([54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000])('comprimento %i (fronteiras de bloco/padding)', (n) => {
    const s = 'x'.repeat(n);
    expect(sha256Hex(s)).toBe(node(s));
  });

  it('UTF-8 multibyte e emoji', () => {
    for (const s of ['café', 'Açaí 100% ☕', '😀🎉', 'ação — “aspas” …', '\u0000\u0001', 'ǅ ß İ']) {
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it('textos pseudoaleatórios determinísticos', () => {
    let state = 42;
    for (let i = 0; i < 200; i += 1) {
      let s = '';
      const len = (state = (state * 1103515245 + 12345) & 0x7fffffff) % 300;
      for (let j = 0; j < len; j += 1) s += String.fromCharCode(32 + ((state = (state * 1103515245 + 12345) & 0x7fffffff) % 2000));
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it('funciona sem crypto.subtle (contexto HTTP não seguro) e não o utiliza', () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined();
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    vi.stubGlobal('crypto', undefined);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
