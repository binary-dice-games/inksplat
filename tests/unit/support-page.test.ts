// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { SUPPORT_SCHEME, parseSupportUrl } from '@inksplat/defaults';
import {
  allDownloads,
  appUrlFromHash,
  detectSystem,
  downloadUrl,
} from '../../viewer/src/support-page';
import {
  supportCodeHint,
  supportInvitation,
  supportNotice,
  supportStatusText,
} from '../../viewer/src/model';

// The support landing page and the helper's texts (spec/08_remote_support section 3).

describe('the support landing page', () => {
  it('tells the systems apart, and phones and tablets from computers', () => {
    const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15 Safari/605.1';
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';
    expect(detectSystem(win)).toBe('windows');
    expect(detectSystem(mac)).toBe('mac');
    expect(detectSystem(linux)).toBe('linux');
    expect(detectSystem(android)).toBe('other');
    expect(detectSystem(iphone)).toBe('other');
    expect(detectSystem('', 'Win32')).toBe('windows');
    expect(detectSystem('Something')).toBe('other');
  });

  it("offers the visitor's installer from the latest release, and all of them in a list", () => {
    expect(downloadUrl('windows')).toMatch(/releases\/latest\/download\/.+\.exe$/);
    expect(downloadUrl('mac')).toMatch(/\.dmg$/);
    expect(downloadUrl('linux')).toMatch(/\.AppImage$/);
    expect(downloadUrl('other')).toBeNull();
    expect(allDownloads()).toHaveLength(4);
    for (const [, url] of allDownloads()) {
      expect(url.startsWith('https://github.com/binary-dice-games/inksplat/releases/')).toBe(true);
    }
  });

  it('builds the app link from the hash, and refuses a bad one', () => {
    const token = 'abcdefghijklmnopqrstuv';
    const url = appUrlFromHash(`#inksplat=${token}&tr=wss%3A%2F%2Ft.example`);
    expect(url?.startsWith(`${SUPPORT_SCHEME}://join#`)).toBe(true);
    expect(parseSupportUrl(url)).toEqual({ token, trackers: ['wss://t.example'] });
    expect(appUrlFromHash('')).toBeNull();
    expect(appUrlFromHash('#inksplat=bad')).toBeNull();
  });
});

describe("the helper's texts", () => {
  const person = { name: 'Bob' };

  it('says what the session is waiting for', () => {
    expect(supportStatusText({ status: 'waiting', person: null, code: null, left: null })).toMatch(
      /open the link/,
    );
    expect(supportStatusText({ status: 'waiting', person: null, code: null, left: 'Bob' })).toMatch(
      /Bob stopped sharing/,
    );
    expect(supportStatusText({ status: 'deciding', person, code: null, left: null })).toMatch(
      /Bob is connected and deciding/,
    );
    expect(supportStatusText({ status: 'sharing', person, code: null, left: null })).toMatch(
      /see Bob's screen/,
    );
    expect(supportNotice({ status: 'sharing', person, code: null, left: null })).toBeNull();
    expect(supportNotice({ status: 'deciding', person, code: null, left: null })).toMatch(/Bob/);
    expect(supportCodeHint({ status: 'deciding', person, code: '123 456', left: null })).toMatch(
      /Read this code to Bob/,
    );
  });

  it('puts the link in the text to send, and says the helper cannot click or type', () => {
    const text = supportInvitation('https://example.org/support.html#inksplat=x');
    expect(text).toContain('https://example.org/support.html#inksplat=x');
    expect(text).toMatch(/cannot click or type/);
  });
});
