// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { isToken } from '@inksplat/collab-session';
import { PROTOCOL } from '@inksplat/defaults';
import {
  STARTER_KEY,
  activityRunning,
  newStart,
  parseStart,
  planMainStage,
  roleFor,
  startActivity,
} from '../../viewer/src/meet/meet-boot';
import type { KeyStore } from '../../viewer/src/meet/meet-boot';
import { MeetError } from '../../viewer/src/meet/meet-sdk';
import type { MeetSidePanelClient } from '../../viewer/src/meet/meet-sdk';
import { fakeSession } from '../support/fake-meet';

let n = 0;
const hub = (): string => `boot-${process.pid}-${n++}`;

function memory(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('the starting state', () => {
  it('makes a token and a starter id', () => {
    const a = newStart();
    expect(isToken(a.token)).toBe(true);
    expect(a.p).toBe(PROTOCOL);
    expect(a.starter).toMatch(/^[0-9a-f]{18}$/);
    expect(newStart().token).not.toBe(a.token);
  });

  it('parses what the starter wrote', () => {
    const a = newStart();
    expect(parseStart(JSON.stringify(a))).toEqual(a);
  });

  it('refuses missing, malformed and foreign data', () => {
    const reason = (raw: string | undefined): string | undefined => {
      try {
        parseStart(raw);
      } catch (e) {
        return e instanceof MeetError ? e.reason : 'other';
      }
      return undefined;
    };
    expect(reason(undefined)).toBe('bad-state');
    expect(reason('not json')).toBe('bad-state');
    expect(reason(JSON.stringify({ ...newStart(), token: 'short' }))).toBe('bad-state');
    expect(reason(JSON.stringify({ ...newStart(), starter: 5 }))).toBe('bad-state');
    expect(reason(JSON.stringify({ ...newStart(), p: 'inksplat/0' }))).toBe('protocol');
  });

  it('makes the starter the host and everybody else a guest', () => {
    const s = newStart();
    expect(roleFor(s, s.starter)).toBe('host');
    expect(roleFor(s, 'someone-else')).toBe('guest');
    expect(roleFor(s, null)).toBe('guest');
  });
});

describe('starting and joining an activity', () => {
  it('lets the side panel start it and the main stages read it', async () => {
    const h = hub();
    const starterStore = memory();
    const panel = await (await fakeSession(h)).createSidePanelClient();
    expect(await activityRunning(panel)).toBe(false);
    await startActivity(panel, 'https://example.test/meet-stage.html', starterStore);
    expect(await activityRunning(panel)).toBe(true);

    const host = await planMainStage(await fakeSession(h), starterStore);
    const guest = await planMainStage(await fakeSession(h), memory());
    expect(host.role).toBe('host');
    expect(guest.role).toBe('guest');
    expect(guest.token).toBe(host.token);
    expect(isToken(host.token)).toBe(true);
    expect(host.rendezvous).toHaveLength(1);
    expect(host.rendezvous[0]).toMatchObject({ kind: 'channel' });
    expect(starterStore.map.has(STARTER_KEY)).toBe(true);
  });

  it('says so when nobody started it', async () => {
    const session = await fakeSession(hub());
    await expect(planMainStage(session, memory())).rejects.toMatchObject({ reason: 'bad-state' });
  });

  it('passes the main stage address and the data to Meet', async () => {
    let seen: unknown;
    const client = {
      getActivityStartingState: () => ({}),
      startActivity: async (s: unknown) => void (seen = s),
      notifyMainStage: async () => {},
    } as MeetSidePanelClient;
    await startActivity(client, 'https://example.test/meet-stage.html', memory());
    expect(seen).toMatchObject({ mainStageUrl: 'https://example.test/meet-stage.html' });
    expect(JSON.parse((seen as { additionalData: string }).additionalData).p).toBe(PROTOCOL);
  });
});
