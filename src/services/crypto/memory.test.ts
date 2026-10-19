import { describe, it, expect } from 'vitest';
import { digestHex } from './memory';

describe('digestHex', () => {
  it('hashes only the bytes inside a subarray view', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

    const viewDigest = await digestHex(bytes.subarray(4, 20));
    const copyDigest = await digestHex(new Uint8Array(bytes.slice(4, 20)));

    expect(viewDigest).toEqual(copyDigest);
  });

  it('hashes a view with a non-zero byteOffset', async () => {
    const backing = new Uint8Array([9, 9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8]);
    const view = new Uint8Array(backing.buffer, 4, 8);

    expect(view.byteOffset).toBe(4);
    expect(await digestHex(view)).toEqual(await digestHex(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
  });
});
