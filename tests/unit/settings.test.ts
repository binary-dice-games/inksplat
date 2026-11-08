// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  cleanIceServers,
  cleanSettings,
  cleanTrackers,
  cleanViewerBase,
  formatIceLines,
  parseIceLines,
} from '../../viewer/src/settings';

describe('settings', () => {
  it('gives the defaults for nothing or garbage', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    const s = cleanSettings({
      name: '  Ana \u0007 ',
      color: 'red',
      viewersMayDraw: false,
      viewerBase: 'ftp://nope',
      video: { fps: 99 },
    });
    expect(s.name).toBe('Ana');
    expect(s.color).toBe(DEFAULT_SETTINGS.color);
    expect(s.viewersMayDraw).toBe(false);
    expect(s.viewerBase).toBe(DEFAULT_SETTINGS.viewerBase);
    expect(s.video.fps).toBe(15);
  });

  it('keeps the support video apart from the ordinary video (spec/08 section 4.3)', () => {
    const s = cleanSettings({ video: { fps: 2 }, supportVideo: { fps: 20 } });
    expect(s.video.fps).toBe(2);
    expect(s.supportVideo.fps).toBe(20);
    expect(cleanSettings({ supportVideo: { fps: 2 } }).supportVideo.fps).toBe(15);
    expect(cleanSettings(undefined).supportVideo).toEqual(DEFAULT_SETTINGS.supportVideo);
  });

  it('truncates long names and defaults empty ones', () => {
    expect(cleanSettings({ name: 'x'.repeat(100) }).name).toHaveLength(40);
    expect(cleanSettings({ name: '   ' }).name).toBe(DEFAULT_SETTINGS.name);
  });

  it('accepts https viewer pages and localhost http, and drops the hash and query', () => {
    expect(cleanViewerBase('https://example.github.io/inksplat/?a=1#x')).toBe(
      'https://example.github.io/inksplat/',
    );
    expect(cleanViewerBase('http://localhost:8080/')).toBe('http://localhost:8080/');
    expect(cleanViewerBase('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
    expect(cleanViewerBase('http://example.com/')).toBeNull();
    expect(cleanViewerBase('javascript:alert(1)')).toBeNull();
    expect(cleanViewerBase(42)).toBeNull();
  });

  it('keeps only ws(s) trackers, once each, and allows an empty list', () => {
    expect(
      cleanTrackers(
        'wss://a.example\nhttps://b.example\n\nwss://a.example\nnot a url\nws://c.example',
      ),
    ).toEqual(['wss://a.example', 'ws://c.example']);
    expect(cleanSettings({ trackers: [] }).trackers).toEqual([]);
    expect(cleanSettings({ trackers: 5 }).trackers).toEqual(DEFAULT_SETTINGS.trackers);
    expect(cleanTrackers(Array.from({ length: 30 }, (_, i) => `wss://t${i}.example`))).toHaveLength(
      10,
    );
  });

  it('validates ICE servers', () => {
    expect(
      cleanIceServers([
        { urls: 'stun:stun.example:3478' },
        { urls: ['turn:t.example', 'http://bad'], username: 'u', credential: 'c' },
        { urls: 'http://bad' },
        'junk',
      ]),
    ).toEqual([
      { urls: 'stun:stun.example:3478' },
      { urls: 'turn:t.example', username: 'u', credential: 'c' },
    ]);
  });

  it('defaults the tracker lifetime to an hour and keeps it within bounds', () => {
    expect(DEFAULT_SETTINGS.trackerTtlMinutes).toBe(60);
    expect(cleanSettings({ trackerTtlMinutes: 15.4 }).trackerTtlMinutes).toBe(15);
    expect(cleanSettings({ trackerTtlMinutes: 0 }).trackerTtlMinutes).toBe(0);
    expect(cleanSettings({ trackerTtlMinutes: -5 }).trackerTtlMinutes).toBe(0);
    expect(cleanSettings({ trackerTtlMinutes: 1e9 }).trackerTtlMinutes).toBe(7 * 24 * 60);
    expect(cleanSettings({ trackerTtlMinutes: 'soon' }).trackerTtlMinutes).toBe(60);
    expect(cleanSettings({ trackerTtlMinutes: NaN }).trackerTtlMinutes).toBe(60);
  });

  it('keeps a small image as the avatar and drops anything else', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(cleanSettings({ avatar: png }).avatar).toBe(png);
    expect(cleanSettings({}).avatar).toBe('');
    expect(cleanSettings({ avatar: 'https://example.com/me.png' }).avatar).toBe('');
    expect(cleanSettings({ avatar: 'data:text/html;base64,PHNjcmlwdD4=' }).avatar).toBe('');
    expect(cleanSettings({ avatar: png + 'A'.repeat(20000) }).avatar).toBe('');
  });

  it('round-trips the text form of ICE servers', () => {
    const text = 'stun:stun.example:3478\nturn:t.example:3478 user secret';
    const servers = parseIceLines(text);
    expect(servers).toHaveLength(2);
    expect(formatIceLines(servers)).toBe(text);
    expect(parseIceLines('\n  \nnonsense')).toEqual([]);
  });
});
