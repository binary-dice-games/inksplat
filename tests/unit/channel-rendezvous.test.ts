// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, newToken } from '@inksplat/collab-session';
import type { SignalTransport } from '@inksplat/collab-session';
import { settle } from '../support/wait';

// The linking itself needs WebRTC and is tested in Chrome (tests/e2e/meet-addon.test.ts); here
// only what the rendezvous does around it.
describe('the channel rendezvous', () => {
  const global = globalThis as { RTCPeerConnection?: unknown };
  const had = global.RTCPeerConnection;
  beforeAll(() => {
    global.RTCPeerConnection ??= class {};
  });
  afterAll(() => {
    global.RTCPeerConnection = had;
  });

  function transport(): SignalTransport & { sent: string[]; listeners: Set<unknown> } {
    const sent: string[] = [];
    const listeners = new Set<unknown>();
    return {
      sent,
      listeners,
      send: async (text) => void sent.push(text),
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
  }

  it('needs a transport that can send and subscribe', async () => {
    await expect(
      createSession({
        role: 'host',
        rendezvous: [{ kind: 'channel', transport: {} as SignalTransport }],
      }),
    ).rejects.toMatchObject({ reason: 'config' });
  });

  it('listens while the session lives and stops with it', async () => {
    const t = transport();
    const host = await createSession({
      role: 'host',
      rendezvous: [{ kind: 'channel', transport: t }],
    });
    expect(t.listeners.size).toBe(1);
    host.close();
    await settle(150);
    expect(t.listeners.size).toBe(0);
  });

  it('ignores messages that are not its own or not sealed for the room', async () => {
    const t = transport();
    const host = await createSession({
      role: 'host',
      rendezvous: [{ kind: 'channel', transport: t }],
    });
    const statuses: string[] = [];
    host.on('status', (e) => statuses.push(e.stage));
    const listener = [...t.listeners][0] as (text: string) => void;
    listener('not json');
    listener(JSON.stringify({ k: 'offer', id: 'x', s: 'garbage' }));
    listener(JSON.stringify({ k: 'offer', id: 5, s: 'garbage' }));
    listener(JSON.stringify(null));
    await settle(50);
    expect(statuses).not.toContain('offer');
    expect(t.sent).toEqual([]);
    host.close();
  });

  it('keeps a guest quiet when it cannot make offers', async () => {
    const t = transport();
    const guest = await createSession({
      role: 'guest',
      token: newToken(),
      rendezvous: [{ kind: 'channel', transport: t }],
    });
    await settle(50);
    expect(t.sent).toEqual([]);
    guest.close();
  });
});
