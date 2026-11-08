// MIT License © 2026 Binary Dice Games
/**
 * @file The overlay (spec/08_remote_support/DESIGN.md sections 4 and 4.2): a transparent,
 * click-through page over the shared display that draws the helper's cursor, laser, pings and
 * emotes with the whiteboard, read only. Its frame is the whole display, so a mark lands where the
 * helper put it on the video. It gets the marks from the session window through a port and cleans
 * them again; it sends nothing.
 */
import { createWhiteboard, frameAdapter } from '@inksplat/collab-whiteboard';
import type { WhiteboardSession } from '@inksplat/collab-whiteboard';
import { PORT_MESSAGE } from '../shared/bridge';
import { NAME_MAX, cleanText } from '../shared/protocol';
import { cleanMark } from '../session/allowlist';

type Peer = { id: string; name: string; color: string; role: 'host' | 'guest' };

const ME: Peer = { id: 'support-overlay', name: '', color: '#30a46c', role: 'guest' };
const COLOR = /^#[0-9a-fA-F]{6}$/;
const PEER = /^[A-Za-z0-9_-]{4,40}$/;

let peers: Peer[] = [];
const onMessage = new Set<(m: unknown, from: string) => void>();
const onPeers = new Set<(peers: unknown[]) => void>();

/** The session the whiteboard sees: the helper's marks in, nothing out. */
const proxy: WhiteboardSession = {
  role: 'guest',
  me: { id: ME.id, color: ME.color },
  peers: () => [ME, ...peers],
  host: () => peers.find((p) => p.role === 'host') ?? null,
  channel: () =>
    ({
      send: () => {},
      on: (event: string, cb: (...args: never[]) => void) => {
        if (event === 'message') {
          onMessage.add(cb as (m: unknown, from: string) => void);
        }
        return () => onMessage.delete(cb as (m: unknown, from: string) => void);
      },
    }) as ReturnType<WhiteboardSession['channel']>,
  on: (_event: 'peers', cb: (peers: unknown[]) => void) => {
    onPeers.add(cb);
    return () => onPeers.delete(cb);
  },
};

const box = document.getElementById('board')!;
const aspect = (): number =>
  window.innerWidth > 0 ? window.innerWidth / window.innerHeight : 16 / 9;
const adapter = frameAdapter(box, aspect);
createWhiteboard(box, {
  session: proxy,
  adapter,
  readOnly: true,
  toolbar: false,
  pages: false,
  toolHints: false,
  turns: false,
});
window.addEventListener('resize', () => adapter.update());

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data !== PORT_MESSAGE || !e.ports[0]) {
    return;
  }
  const port = e.ports[0];
  port.onmessage = (ev) => received(ev.data);
  port.start();
});

function received(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    return;
  }
  const m = data as Record<string, unknown>;
  if (m.t === 'peers' && Array.isArray(m.peers)) {
    peers = m.peers
      .slice(0, 1)
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .filter((p) => typeof p.id === 'string' && PEER.test(p.id))
      .map((p) => ({
        id: p.id as string,
        name: cleanText(p.name, NAME_MAX),
        color: typeof p.color === 'string' && COLOR.test(p.color) ? p.color : '#e5484d',
        role: 'host' as const,
      }));
    const border = document.getElementById('border');
    if (border && peers[0]) {
      border.style.borderColor = peers[0].color;
    }
    for (const cb of onPeers) {
      cb(proxy.peers());
    }
  } else if (m.t === 'wb' && typeof m.from === 'string' && peers.some((p) => p.id === m.from)) {
    const mark = cleanMark(m.m);
    if (mark) {
      for (const cb of onMessage) {
        cb(mark, m.from);
      }
    }
  }
}
