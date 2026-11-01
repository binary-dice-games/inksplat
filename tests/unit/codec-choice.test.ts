// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { hardwareFirst } from '../../viewer/src/codec-choice';

// The presenter's codec order (viewer/src/codec-choice.ts): hardware-encoded codecs first.

const ALL = ['video/AV1', 'video/H264', 'video/VP8'];

describe('hardwareFirst', () => {
  it('moves the codecs encoded in hardware first, keeping each group in order', async () => {
    const hw = new Set(['video/H264', 'video/VP8']);
    expect(await hardwareFirst(ALL, async (c) => hw.has(c))).toEqual([
      'video/H264',
      'video/VP8',
      'video/AV1',
    ]);
  });

  it('keeps the order when nothing is in hardware', async () => {
    expect(await hardwareFirst(ALL, async () => false)).toEqual(ALL);
  });

  it('counts a failing or slow probe as no', async () => {
    const probe = (c: string) =>
      c === 'video/AV1'
        ? Promise.reject(new Error('no'))
        : c === 'video/H264'
          ? new Promise<boolean>(() => {}) // never answers
          : Promise.resolve(true);
    expect(await hardwareFirst(ALL, probe, 20)).toEqual(['video/VP8', 'video/AV1', 'video/H264']);
  });

  it('keeps the order where the browser cannot tell (no mediaCapabilities)', async () => {
    expect(await hardwareFirst(ALL)).toEqual(ALL);
  });
});
