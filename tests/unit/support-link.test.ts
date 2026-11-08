// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { SUPPORT_SCHEME, parseSupportUrl } from '@inksplat/defaults';
import { linkFromArgv } from '../../support-app/src/main/link';
import { forbiddenSwitches } from '../../support-app/src/main/switches';

// How the app takes a link from its command line, and which switches a packaged app refuses
// (spec/08_remote_support/DESIGN.md sections 4.1, 7.3 R10 and R14).

const token = 'abcdefghijklmnopqrstuv';
const link = `${SUPPORT_SCHEME}://join#inksplat=${token}`;

describe('the link on the command line', () => {
  it('is the argument after --, and only that one', () => {
    expect(linkFromArgv(['app.exe', '--', link])).toBe(link);
    expect(linkFromArgv(['app.exe', '--', 'other', link])).toBeNull();
    expect(linkFromArgv(['electron', 'main.js', '--', link])).toBe(link);
  });

  it('is the last argument with the scheme when there is no separator (a desktop file)', () => {
    expect(linkFromArgv(['app', link])).toBe(link);
    expect(linkFromArgv(['app', '--flag'])).toBeNull();
    expect(linkFromArgv(['app'])).toBeNull();
    expect(linkFromArgv(['app', `${link}&tr=${'x'.repeat(3000)}`])).toBeNull();
  });

  it('never makes a switch out of a hostile link, and the parser refuses what is not a link', () => {
    for (const bad of [
      `${SUPPORT_SCHEME}://join --gpu-launcher="calc" #inksplat=${token}`,
      `${SUPPORT_SCHEME}:--inspect`,
      `${SUPPORT_SCHEME}://join#inksplat=${token}" --no-sandbox "`,
      `${SUPPORT_SCHEME}://evil.example/#inksplat=${token}`,
      `${SUPPORT_SCHEME}://join/../../#inksplat=${token}`,
      `${SUPPORT_SCHEME}://join#inksplat=${token}&tr=javascript:alert(1)`,
    ]) {
      const taken = linkFromArgv(['app.exe', '--', bad]);
      expect(taken === null || parseSupportUrl(taken)?.trackers === undefined).toBe(true);
      if (taken !== null && parseSupportUrl(taken)) {
        // What parses is only ever the token (and ws(s) trackers).
        expect(parseSupportUrl(taken)).toEqual({ token });
      }
    }
  });

  it('survives any short random input', () => {
    const chars = `${SUPPORT_SCHEME}:/#=&?%-_ "'\\\\\`$;|<>abcdefXYZ0123456789\\u0000\\u202e`;
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: rand(80) }, () => chars[rand(chars.length)]).join('');
      expect(() => parseSupportUrl(s)).not.toThrow();
      expect(() => linkFromArgv(['app', '--', s])).not.toThrow();
    }
  });
});

describe('switches a packaged app refuses', () => {
  it('finds debugging, inspection, sandbox and proxy switches before --', () => {
    expect(
      forbiddenSwitches([
        'app.exe',
        '--inspect=9229',
        '--remote-debugging-port=9222',
        '--js-flags=--allow-natives-syntax',
        '--no-sandbox',
        '--proxy-server=evil:80',
        '--gpu-launcher=calc',
        '--lang=es',
      ]),
    ).toEqual([
      '--inspect=9229',
      '--remote-debugging-port=9222',
      '--js-flags=--allow-natives-syntax',
      '--no-sandbox',
      '--proxy-server=evil:80',
      '--gpu-launcher=calc',
    ]);
  });

  it('ignores everything after --, where the link is', () => {
    expect(forbiddenSwitches(['app.exe', '--', '--inspect'])).toEqual([]);
    expect(forbiddenSwitches(['app.exe', '--', link])).toEqual([]);
  });
});
