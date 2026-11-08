// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { EMOTES } from '@inksplat/collab-whiteboard';
import { MAX_LASER_POINTS, cleanMark } from '../../support-app/src/session/allowlist';
import {
  NAME_MAX,
  cleanControlAction,
  cleanSessionReport,
} from '../../support-app/src/shared/protocol';
import { contentSecurityPolicy, servedName } from '../../support-app/src/main/pages';
import { fill, language, reasonKey, t } from '../../support-app/src/shared/strings';

// What may reach the overlay, what the main process takes from the windows, and the pages'
// policy (spec/08_remote_support/DESIGN.md sections 4.1 and 7.3 R2, R8, R9).

const FP = Array.from({ length: 32 }, () => 'AB').join(':');

describe('the marks that reach the overlay', () => {
  it('rebuilds cursors, laser points, pings and emotes from their checked fields', () => {
    expect(cleanMark({ t: 'cur', x: 1, y: 2, tool: 'laser', pg: 0, evil: '<img>' })).toEqual({
      t: 'cur',
      x: 1,
      y: 2,
      tool: 'laser',
      pg: 0,
    });
    expect(cleanMark({ t: 'cur', hide: true, x: 'no' })).toEqual({ t: 'cur', hide: true });
    expect(cleanMark({ t: 'laser', id: 'l1', seq: 0, pts: [1, 2, 3, 4] })).toEqual({
      t: 'laser',
      id: 'l1',
      seq: 0,
      pts: [1, 2, 3, 4],
      pg: 0,
    });
    expect(cleanMark({ t: 'ping', id: 'p1', x: 5, y: 6, pg: 0 })).toMatchObject({ t: 'ping' });
    expect(
      cleanMark({ t: 'emote', id: 'e1', name: EMOTES[0], x: 1, y: 1, level: 1, pg: 0 }),
    ).toMatchObject({ t: 'emote', name: EMOTES[0] });
  });

  it('lets nothing else of the whiteboard through: items, text, pictures, files, avatars', () => {
    for (const m of [
      { t: 'op', op: { t: 'put', item: { kind: 'text', text: 'Type your password here' } } },
      { t: 'sync', snapshot: { items: [] } },
      { t: 'avatar', data: 'data:image/png;base64,AAAA' },
      { t: 'file', id: 'x', data: 'AAAA' },
      { t: 'ink', id: 'i', pts: [1, 2] },
      { t: 'drag' },
      { t: 'queue' },
      { t: 'pg', n: 2 },
      null,
      'cur',
    ]) {
      expect(cleanMark(m), JSON.stringify(m)).toBeNull();
    }
  });

  it('refuses malformed marks', () => {
    expect(cleanMark({ t: 'cur', x: Infinity, y: 0 })).toBeNull();
    expect(cleanMark({ t: 'cur', x: 1e9, y: 0 })).toBeNull();
    expect(cleanMark({ t: 'laser', id: 'l', seq: 0, pts: [1] })).toBeNull();
    expect(
      cleanMark({ t: 'laser', id: 'l', seq: 0, pts: Array(MAX_LASER_POINTS + 2).fill(1) }),
    ).toBeNull();
    expect(cleanMark({ t: 'laser', id: '<b>', seq: 0, pts: [1, 2] })).toBeNull();
    expect(cleanMark({ t: 'emote', id: 'e', name: 'skull', x: 1, y: 1, level: 1 })).toBeNull();
    expect(cleanMark({ t: 'emote', id: 'e', name: EMOTES[0], x: 1, y: 1, level: 99 })).toBeNull();
    expect(cleanMark({ t: 'cur', x: 1, y: 2, tool: 'pen' })).toEqual({
      t: 'cur',
      x: 1,
      y: 2,
      pg: 0,
    });
  });
});

describe('what the main process takes from the windows', () => {
  it("cleans the session window's reports", () => {
    expect(cleanSessionReport({ t: 'ready', x: 1 })).toEqual({ t: 'ready' });
    expect(
      cleanSessionReport({
        t: 'host',
        id: 'host-1234',
        name: '  Ana‮ with a very long name indeed  ',
        color: 'red',
        local: FP,
        remote: FP,
      }),
    ).toEqual({
      t: 'host',
      id: 'host-1234',
      name: 'Ana with a very long nam',
      color: '#8b8d98',
      local: FP,
      remote: FP,
    });
    expect(cleanSessionReport({ t: 'host', id: 'host-1234', local: 'AB', remote: FP })).toBeNull();
    expect(cleanSessionReport({ t: 'state', state: 'ended', reason: 'host-ended' })).toEqual({
      t: 'state',
      state: 'ended',
      reason: 'host-ended',
    });
    expect(cleanSessionReport({ t: 'state', state: 'sharing', reason: 'x' })).toBeNull();
    expect(cleanSessionReport({ t: 'state', state: 'ended', reason: '<script>' })).toMatchObject({
      reason: 'unknown',
    });
    expect(cleanSessionReport({ t: 'captured', w: 1280, h: 0 })).toBeNull();
    expect(cleanSessionReport({ t: 'allow' })).toBeNull();
    expect(cleanSessionReport({ t: 'capture' })).toBeNull();
  });

  it("cleans the control window's actions: it can stop, never start", () => {
    expect(cleanControlAction({ t: 'stop' })).toEqual({ t: 'stop' });
    expect(cleanControlAction({ t: 'setName', name: ` ${'x'.repeat(40)}` })?.t).toBe('setName');
    expect(
      (cleanControlAction({ t: 'setName', name: 'x'.repeat(40) }) as { name: string }).name,
    ).toHaveLength(NAME_MAX);
    expect(cleanControlAction({ t: 'setName', name: '\u0000' })).toBeNull();
    for (const bad of [{ t: 'allow' }, { t: 'capture' }, { t: 'consent' }, {}, null, 'stop']) {
      expect(cleanControlAction(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("the app's pages", () => {
  it('serves only its own files on app://support/', () => {
    expect(servedName('app://support/control.html')).toBe('control.html');
    expect(servedName('app://support/session.js')).toBe('session.js');
    for (const bad of [
      'app://support/../main.js',
      'app://support/main.js',
      'app://support/preload-session.js',
      'app://other/control.html',
      'file:///etc/passwd',
      'app://support/%2e%2e/main.js',
      'not a url',
    ]) {
      expect(servedName(bad), bad).toBeNull();
    }
  });

  it('allows no inline script, and connections only from the session page', () => {
    const control = contentSecurityPolicy('control.html', false);
    expect(control).toContain("script-src 'self'");
    expect(control).not.toMatch(/script-src[^;]*unsafe/);
    expect(control).toContain("connect-src 'none'");
    expect(contentSecurityPolicy('session.html', false)).toContain('connect-src wss:;');
    expect(contentSecurityPolicy('session.html', true)).toContain('ws://127.0.0.1:*');
    expect(contentSecurityPolicy('overlay.html', true)).toContain("connect-src 'none'");
  });
});

describe("the app's texts", () => {
  it('speaks Spanish to a Spanish system and English to the rest', () => {
    expect(language('es-ES')).toBe('es');
    expect(language('es')).toBe('es');
    expect(language('en-GB')).toBe('en');
    expect(language('pt-BR')).toBe('en');
    expect(t('es', 'allow')).toBe('Permitir');
  });

  it('names the helper and the code in the consent text, with the warning', () => {
    const text = fill(t('en', 'dialogDetail'), { name: 'Ana', code: '123 456' });
    expect(text).toContain('Ana should read you this code: 123 456');
    expect(text).toMatch(/Banks, Microsoft, Apple and the police never ask/);
    expect(reasonKey('host-ended')).toBe('reason-host-ended');
    expect(reasonKey('nonsense')).toBe('reason-unknown');
    expect(reasonKey(null)).toBe('reason-unknown');
  });
});
