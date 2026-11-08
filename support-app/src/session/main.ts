// MIT License © 2026 Binary Dice Games
/**
 * @file The session window (hidden): the app's guest session with the helper
 * (spec/08_remote_support/DESIGN.md sections 4, 5.2 and 5.4). It reports the host and the
 * link's fingerprints, captures the display when the main process says (the main process answers
 * the request once), offers it on the uplink, and passes the helper's marks, cleaned, to the
 * overlay. On a lost link it takes the stream off the uplink until the main process confirms the
 * host is the one allowed.
 */
import { createSession } from '@inksplat/collab-session';
import type { Session } from '@inksplat/collab-session';
import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_TRACKERS,
  FORWARD_CODECS,
  PROTOCOL,
  SCREEN_CHANNEL,
} from '@inksplat/defaults';
import { hardwareFirst } from '../../../viewer/src/codec-choice';
import { PORT_MESSAGE } from '../shared/bridge';
import type { SessionBridge } from '../shared/bridge';
import { NAME_MAX, cleanText } from '../shared/protocol';
import type { OverlayMessage, SessionCommand } from '../shared/protocol';
import { cleanMark } from './allowlist';

const support = (window as unknown as { support: SessionBridge }).support;

let session: Session | null = null;
let stream: MediaStream | null = null;
let port: MessagePort | null = null;
let version = '';
/** The stream is on the uplink (false while a reconnect waits for the main process). */
let sending = false;

window.addEventListener('message', (e) => {
  if (e.source === window && e.data === PORT_MESSAGE && e.ports[0]) {
    port = e.ports[0];
    sendPeers();
  }
});

support.onCommand((c) => void run(c));
support.report({ t: 'ready' });

async function run(c: SessionCommand): Promise<void> {
  switch (c.t) {
    case 'join':
      if (!session) {
        version = c.version;
        await join(c);
      }
      return;
    case 'capture':
    case 'recapture':
      await capture();
      return;
    case 'resume':
      sending = true;
      session?.setUplink(stream);
      offer();
      return;
    case 'name':
      session?.setMe({ name: cleanText(c.name, NAME_MAX) });
      return;
    case 'leave':
      sending = false;
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      stream = null;
      session?.setUplink(null);
      session?.close();
      session = null;
      return;
  }
}

async function join(c: Extract<SessionCommand, { t: 'join' }>): Promise<void> {
  // The person's machine encodes in hardware first; with one viewer the host takes this order.
  const videoCodecs = await hardwareFirst(FORWARD_CODECS);
  try {
    session = await createSession({
      role: 'guest',
      token: c.token,
      peerId: c.peerId,
      protocol: PROTOCOL,
      me: { name: cleanText(c.name, NAME_MAX), color: '#30a46c' },
      rendezvous: [
        { kind: 'torrent', urls: c.trackers.length > 0 ? c.trackers : [...DEFAULT_TRACKERS] },
      ],
      iceServers: DEFAULT_ICE_SERVERS.map((s) => ({ ...s })),
      videoCodecs,
      reconnectMs: 120_000,
    });
  } catch (e) {
    support.report({ t: 'state', state: 'ended', reason: reasonOf(e) });
    return;
  }
  const s = session;
  s.on('state', (e) => {
    if (e.state === 'open') {
      reportHost();
    } else if (e.state === 'reconnecting') {
      // Nothing goes up until the main process knows the host is the same (DESIGN 5.4).
      sending = false;
      s.setUplink(null);
      support.report({ t: 'state', state: 'reconnecting', reason: 'lost' });
    } else if (e.state === 'ended') {
      support.report({ t: 'state', state: 'ended', reason: reasonOf(e.reason) });
    }
  });
  s.on('peers', () => sendPeers());
  s.channel('wb').on('message', (m, from) => {
    const host = s.host();
    if (!port || !host || from !== host.id) {
      return; // only the helper's marks
    }
    const mark = cleanMark(m);
    if (mark) {
      port.postMessage({ t: 'wb', from, m: mark } satisfies OverlayMessage);
    }
  });
  if (s.state === 'open') {
    reportHost();
  }
}

/** Tells the main process who the host is, with the fingerprints of the link. */
function reportHost(): void {
  const host = session?.host();
  const fp = host ? session!.fingerprints(host.id) : null;
  if (!host || !fp) {
    support.report({ t: 'state', state: 'ended', reason: 'no-answer' });
    return;
  }
  support.report({
    t: 'host',
    id: host.id,
    name: host.name,
    color: host.color,
    local: fp.local,
    remote: fp.remote,
  });
  sendPeers();
}

/** The helper, for the overlay's cursor (name and colour). */
function sendPeers(): void {
  const host = session?.host();
  if (port && host) {
    port.postMessage({
      t: 'peers',
      peers: [
        { id: host.id, name: cleanText(host.name, NAME_MAX), color: host.color, role: 'host' },
      ],
    } satisfies OverlayMessage);
  }
}

/** Captures the display (the main process answers once) and offers it to the host. */
async function capture(): Promise<void> {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
  stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
  } catch {
    support.report({ t: 'capture-failed', reason: 'refused' });
    return;
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    support.report({ t: 'capture-failed', reason: 'no-track' });
    return;
  }
  track.addEventListener('ended', () => support.report({ t: 'capture-failed', reason: 'ended' }));
  sending = true;
  session?.setUplink(stream);
  offer();
  const { width = 0, height = 0 } = track.getSettings();
  if (width > 0 && height > 0) {
    support.report({ t: 'captured', w: width, h: height });
  }
}

/** Offers the stream to the host (again after a reconnect or a new display). */
function offer(): void {
  const host = session?.host();
  const track = stream?.getVideoTracks()[0];
  if (!session || !host || !track || !sending) {
    return;
  }
  const { width = 0, height = 0 } = track.getSettings();
  session
    .channel(SCREEN_CHANNEL)
    .send(
      { cmd: 'offer', surface: 'monitor', w: width, h: height, client: 'support', v: version },
      { to: host.id },
    );
}

/** A reason the strings know, from a session error or end. */
function reasonOf(e: unknown): string {
  const reason = typeof e === 'string' ? e : (e as { reason?: unknown } | null)?.reason;
  // `locked` from the session is the room being locked, not the person's screen.
  if (reason === 'locked') {
    return 'locked-room';
  }
  return typeof reason === 'string' && /^[a-z-]{1,32}$/.test(reason) ? reason : 'unknown';
}
