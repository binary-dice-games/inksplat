// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  CODEC_PREFERENCE,
  DEFAULT_TRACKERS,
  DEFAULT_VIDEO,
  DEFAULT_VIEWER_BASE,
  UPLINK_WARNING_KBPS,
  VIDEO_LIMITS,
  BACKGROUNDS,
  CANVASES,
  STAGE_ASPECT,
  cleanCanvasBackground,
  cleanScreenMessage,
  canvasBackground,
  cleanStage,
  defaultBackgrounds,
  cleanVideoSettings,
  inviteLink,
  parseInvite,
  parseInviteHash,
  toMediaParams,
  uplinkKbps,
  SUPPORT_SCHEME,
  SUPPORT_VIDEO,
  SUPPORT_VIDEO_LIMITS,
  cleanSupportVideo,
  parseSupportUrl,
  safetyCode,
  supportAppUrl,
  supportLink,
} from '@inksplat/defaults';

describe('video settings', () => {
  it('defaults to a few frames per second', () => {
    expect(cleanVideoSettings(undefined)).toEqual(DEFAULT_VIDEO);
    expect(DEFAULT_VIDEO.fps).toBe(3);
  });

  it('clamps every field into its range', () => {
    const s = cleanVideoSettings({ fps: 99, maxWidth: 10, maxHeight: 5000, bitrateKbps: -4 });
    expect(s.fps).toBe(VIDEO_LIMITS.fps.max);
    expect(s.maxWidth).toBe(VIDEO_LIMITS.width.min);
    expect(s.maxHeight).toBe(VIDEO_LIMITS.height.max);
    expect(s.bitrateKbps).toBe(VIDEO_LIMITS.bitrateKbps.min);
  });

  it('ignores values of the wrong type', () => {
    expect(cleanVideoSettings({ fps: '5', contentHint: 'blur' })).toEqual(DEFAULT_VIDEO);
  });

  it('turns settings into session media parameters', () => {
    const p = toMediaParams({ ...DEFAULT_VIDEO, bitrateKbps: 500 });
    expect(p.maxBitrate).toBe(500_000);
    expect(p.fps).toBe(3);
    expect(p.codecs).toEqual(['video/AV1', 'video/H264', 'video/VP9', 'video/VP8']);
  });

  it('estimates the uplink of a star', () => {
    expect(uplinkKbps(10, DEFAULT_VIDEO)).toBe(15000);
    expect(uplinkKbps(10, DEFAULT_VIDEO)).toBeGreaterThan(UPLINK_WARNING_KBPS);
    expect(uplinkKbps(-3, DEFAULT_VIDEO)).toBe(0);
  });
});

describe('video quality defaults', () => {
  it('send a screen at its own size, never shrinking one up to 4K', () => {
    // A 1440p screen sent at 1280x720 scored 70 (blur) against 1.6 at its own size.
    expect(DEFAULT_VIDEO.maxWidth).toBe(3840);
    expect(DEFAULT_VIDEO.maxHeight).toBe(2160);
    expect(VIDEO_LIMITS.width.max).toBe(3840);
    expect(VIDEO_LIMITS.height.max).toBe(2160);
  });

  it('prefer the codecs that are sharp on a still page', () => {
    expect(CODEC_PREFERENCE[0]).toBe('video/AV1');
    expect(CODEC_PREFERENCE.indexOf('video/H264')).toBeLessThan(
      CODEC_PREFERENCE.indexOf('video/VP9'),
    );
    expect(CODEC_PREFERENCE.indexOf('video/VP9')).toBeLessThan(
      CODEC_PREFERENCE.indexOf('video/VP8'),
    );
  });
});

describe('stage message', () => {
  const good = { aspect: 16 / 9, w: 1280, h: 720, fps: 3, state: 'live', drawing: true };

  it('accepts a well formed stage and drops unknown fields', () => {
    expect(cleanStage({ ...good, evil: 1 })).toEqual(good);
  });

  it('keeps only known backgrounds per canvas, and reads the old video as the screen', () => {
    expect(cleanStage({ ...good, backgrounds: ['cork', 'lava', 'video', 'wall'] })).toEqual({
      ...good,
      // Unknown entries and missing canvases take the defaults.
      backgrounds: ['cork', 'whiteboard', 'screen', 'wall', 'cork'],
    });
    expect(cleanStage({ ...good, video: false })).toEqual(good); // no longer a field
    expect(cleanStage({ ...good, backgrounds: 'cork' })).toEqual(good);
    expect(cleanCanvasBackground('screen')).toBe('screen');
    expect(cleanCanvasBackground('video')).toBe('screen');
    expect(cleanCanvasBackground('lava')).toBeUndefined();
    expect(BACKGROUNDS).toEqual(['whiteboard', 'blackboard', 'wall', 'cork']);
  });

  it('gives canvas 1 the screen and the backgrounds to the others', () => {
    expect(defaultBackgrounds()).toEqual(['screen', 'whiteboard', 'blackboard', 'wall', 'cork']);
    expect(defaultBackgrounds()).toHaveLength(CANVASES);
    const stage = cleanStage(good)!;
    expect(canvasBackground(stage, 0)).toBe('screen');
    expect(canvasBackground(stage, 4)).toBe('cork');
    expect(canvasBackground(null, 0)).toBe('screen');
    expect(canvasBackground({ ...stage, backgrounds: ['wall'] }, 0)).toBe('wall');
    expect(STAGE_ASPECT).toBe(16 / 9);
  });

  it('carries the active stream and the preview, cleaned', () => {
    const screen = { owner: 'ana-1234', name: 'Ana\u0001', w: 640, h: 360 };
    expect(cleanStage({ ...good, screen, preview: 'bob-1234' })).toEqual({
      ...good,
      screen: { owner: 'ana-1234', name: 'Ana', w: 640, h: 360 },
      preview: 'bob-1234',
    });
    expect(cleanStage({ ...good, screen: { ...screen, owner: 'a b' } })).toEqual(good);
    expect(cleanStage({ ...good, screen: { ...screen, w: -1 } })).toEqual(good);
    expect(cleanStage({ ...good, preview: 7 })).toEqual(good);
  });

  it('cleans the optional title', () => {
    expect(cleanStage({ ...good, title: 'Plan\u0000 A' })?.title).toBe('Plan A');
    expect(cleanStage({ ...good, title: '' })).toEqual(good);
  });

  it('rejects malformed stages', () => {
    expect(cleanStage(null)).toBeNull();
    expect(cleanStage({ ...good, aspect: 0 })).toBeNull();
    expect(cleanStage({ ...good, state: 'gone' })).toBeNull();
    expect(cleanStage({ ...good, state: 'paused' })).toBeNull(); // None replaces the pause
    expect(cleanStage({ ...good, drawing: 'yes' })).toBeNull();
    expect(cleanStage({ ...good, w: Number.NaN })).toBeNull();
  });
});

describe('screen messages', () => {
  it('accepts an offer and a withdrawal, and drops unknown fields', () => {
    expect(cleanScreenMessage({ cmd: 'offer', surface: 'window', w: 640, h: 360, x: 1 })).toEqual({
      cmd: 'offer',
      surface: 'window',
      w: 640,
      h: 360,
    });
    expect(cleanScreenMessage({ cmd: 'offer', surface: 'evil', w: 0, h: 0 })).toMatchObject({
      surface: 'unknown',
    });
    expect(cleanScreenMessage({ cmd: 'withdraw', w: 1 })).toEqual({ cmd: 'withdraw' });
  });

  it('rejects anything else', () => {
    expect(cleanScreenMessage(null)).toBeNull();
    expect(cleanScreenMessage({ cmd: 'show' })).toBeNull();
    expect(cleanScreenMessage({ cmd: 'offer', w: 1.5, h: 2 })).toBeNull();
    expect(cleanScreenMessage({ cmd: 'offer', w: 1, h: 99999 })).toBeNull();
    expect(cleanScreenMessage({ cmd: 'offer' })).toBeNull();
  });
});

describe('invite links', () => {
  const token = 'abcdefghijklmnopqrstuv';

  it('puts the token in the fragment only', () => {
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`);
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#inksplat=${token}`);
    expect(parseInviteHash(url.hash)).toBe(token);
  });

  it('rejects a missing or malformed token', () => {
    expect(parseInviteHash('')).toBeNull();
    expect(parseInviteHash('#inksplat=short')).toBeNull();
    expect(parseInviteHash('#collab=abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('invite links with trackers', () => {
  const token = 'abcdefghijklmnopqrstuv';

  it('has only the room token when the trackers are the defaults', () => {
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`, {
      trackers: DEFAULT_TRACKERS,
    });
    expect(parseInvite(new URL(link).hash)).toEqual({ token });
  });

  it('carries only non-default trackers', () => {
    const custom = ['wss://tracker.example/announce', 'ws://127.0.0.1:9999'];
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`, { trackers: custom });
    expect(parseInvite(new URL(link).hash)?.trackers).toEqual(custom);
    const plain = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`, {
      trackers: DEFAULT_TRACKERS,
    });
    expect(parseInvite(new URL(plain).hash)?.trackers).toBeUndefined();
  });

  it('ignores a leftover presenter key and non-websocket trackers in a link', () => {
    const hash = `#inksplat=${token}&presenter=bad&tr=https%3A%2F%2Fx.example&tr=wss%3A%2F%2Fok.example`;
    expect(parseInvite(hash)).toEqual({ token, trackers: ['wss://ok.example'] });
    expect(parseInvite('#presenter=abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('default trackers', () => {
  it('are the three that nymph uses, all secure websockets', () => {
    expect(DEFAULT_TRACKERS).toEqual([
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.webtorrent.dev',
      'wss://tracker.btorrent.xyz',
    ]);
  });
});

describe('support sessions (spec/08_remote_support)', () => {
  const token = 'abcdefghijklmnopqrstuv';

  it('marks a support stage, and drops any other mode', () => {
    const base = { aspect: 1.6, w: 1280, h: 800, fps: 30, state: 'live', drawing: false };
    expect(cleanStage({ ...base, mode: 'support' })?.mode).toBe('support');
    expect(cleanStage({ ...base, mode: 'evil' })?.mode).toBeUndefined();
    expect(cleanStage(base)?.mode).toBeUndefined();
  });

  it("keeps the support app's client and version in an offer, and only well formed", () => {
    const offer = { cmd: 'offer', surface: 'monitor', w: 1280, h: 800 };
    expect(cleanScreenMessage({ ...offer, client: 'support', v: '1.2.0' })).toEqual({
      ...offer,
      client: 'support',
      v: '1.2.0',
    });
    expect(cleanScreenMessage({ ...offer, client: 'support', v: '<b>'.repeat(9) })).toEqual({
      ...offer,
      client: 'support',
    });
    expect(cleanScreenMessage({ ...offer, client: 'other', v: '1.0' })).toEqual(offer);
  });

  it('makes the support link next to the viewer, with the token in the fragment', () => {
    const link = supportLink('https://example.github.io/inksplat/', `inksplat=${token}`, {
      trackers: ['wss://t.example'],
    });
    const url = new URL(link);
    expect(url.pathname).toBe('/inksplat/support.html');
    expect(url.search).toBe('');
    expect(parseInvite(url.hash)).toEqual({ token, trackers: ['wss://t.example'] });
  });

  it('turns an invite into an app link and back', () => {
    const invite = { token, trackers: ['wss://t.example/announce', 'ws://127.0.0.1:9'] };
    const url = supportAppUrl(invite);
    expect(url.startsWith(`${SUPPORT_SCHEME}://join#inksplat=${token}`)).toBe(true);
    expect(parseSupportUrl(url)).toEqual(invite);
    expect(parseSupportUrl(supportAppUrl({ token }))).toEqual({ token });
    expect(parseSupportUrl(`${SUPPORT_SCHEME}://join/#inksplat=${token}`)).toEqual({ token });
  });

  it('refuses every other app link', () => {
    const ok = `#inksplat=${token}`;
    for (const bad of [
      undefined,
      42,
      '',
      `https://join${ok}`,
      `${SUPPORT_SCHEME}://other${ok}`,
      `${SUPPORT_SCHEME}://join/x${ok}`,
      `${SUPPORT_SCHEME}://join?a=1${ok}`,
      `${SUPPORT_SCHEME}://user@join${ok}`,
      `${SUPPORT_SCHEME}://join:99${ok}`,
      `${SUPPORT_SCHEME}://join#inksplat=short`,
      `${SUPPORT_SCHEME}://join${ok}&tr=${'x'.repeat(2100)}`,
      `${SUPPORT_SCHEME}://join --gpu-launcher=calc${ok}`,
      `"${SUPPORT_SCHEME}://join${ok}" --inspect`,
    ]) {
      expect(parseSupportUrl(bad), String(bad)).toBeNull();
    }
  });

  it('clamps the support video into its own ranges: 15 to 30 frames a second', () => {
    expect(cleanSupportVideo(undefined)).toEqual(SUPPORT_VIDEO);
    expect(SUPPORT_VIDEO).toMatchObject({ fps: 30, bitrateKbps: 4000, contentHint: 'text' });
    const c = cleanSupportVideo({ fps: 3, maxWidth: 99999, bitrateKbps: 1, contentHint: 'x' });
    expect(c.fps).toBe(SUPPORT_VIDEO_LIMITS.fps.min);
    expect(c.maxWidth).toBe(SUPPORT_VIDEO_LIMITS.width.max);
    expect(c.bitrateKbps).toBe(SUPPORT_VIDEO_LIMITS.bitrateKbps.min);
    expect(c.contentHint).toBe('text');
    expect(cleanSupportVideo({ fps: 60 }).fps).toBe(30);
  });

  it('gives the same six-digit safety code at both ends, and another for another link', async () => {
    const a = 'AB:CD:EF';
    const b = '01:23:45';
    const code = await safetyCode(a, b);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await safetyCode(b, a)).toBe(code);
    expect(await safetyCode(b.toLowerCase(), a.toLowerCase())).toBe(code);
    expect(await safetyCode(a, '01:23:46')).not.toBe(code);
    await expect(safetyCode('', b)).rejects.toThrow();
  });
});
