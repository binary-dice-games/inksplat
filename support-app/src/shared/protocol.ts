// MIT License © 2026 Binary Dice Games
/**
 * @file The messages between the app's processes (spec/08_remote_support/DESIGN.md sections 4
 * and 6.2): IPC channel names, what each window may send, and the cleaners the main process
 * runs on everything a renderer sends. A renderer is never trusted: a message that does not
 * clean is dropped.
 */

/** IPC channel names. */
export const IPC = {
  /** main -> control window: the state to show ({@link ControlState}). */
  state: 'support:state',
  /** control window -> main: what the person pressed ({@link ControlAction}). */
  action: 'support:action',
  /** main -> session window: what to do ({@link SessionCommand}). */
  command: 'support:command',
  /** session window -> main: what happened ({@link SessionReport}). */
  report: 'support:report',
  /** main -> session and overlay windows: the two ends of their message port. */
  port: 'support:port',
} as const;

/** The screens of the control window. */
export type Screen =
  | 'idle'
  | 'connecting'
  | 'explain'
  | 'asking'
  | 'sharing'
  | 'reconnecting'
  | 'stopped'
  | 'ended'
  | 'denied'
  | 'bad-link'
  | 'blocked'
  | 'update'
  | 'mac-permission';

/** What the control window shows. */
export interface ControlState {
  screen: Screen;
  lang: 'en' | 'es';
  /** The person's own name, as the helper sees it. */
  name: string;
  /** The helper, once connected (name cut to 24 characters). */
  helper: { name: string; color: string } | null;
  /** The safety code of the link, once known. */
  code: string | null;
  /** Why the session stopped or ended (a key of the strings), if it did. */
  reason: string | null;
  /** Whether there is another display to share. */
  otherDisplay: boolean;
  /** A short notice (a key of the strings), such as `busy`, or null. */
  notice: string | null;
  /** The app's version. */
  version: string;
}

/** What the person can press in the control window. */
export type ControlAction =
  | { t: 'stop' }
  | { t: 'shareAgain' }
  | { t: 'close' }
  | { t: 'nextDisplay' }
  | { t: 'openScreenSettings' }
  | { t: 'relaunch' }
  | { t: 'download' }
  | { t: 'setName'; name: string };

const ACTIONS = new Set([
  'stop',
  'shareAgain',
  'close',
  'nextDisplay',
  'openScreenSettings',
  'relaunch',
  'download',
]);

/** The longest name the person can give. */
export const NAME_MAX = 24;

/** `text` without control characters, trimmed, at most `max` long; '' for anything else. */
export function cleanText(text: unknown, max: number): string {
  return typeof text === 'string'
    ? text
        .replace(/\p{Cc}|\p{Cf}/gu, '')
        .trim()
        .slice(0, max)
    : '';
}

/** The action if well formed, else null. */
export function cleanControlAction(input: unknown): ControlAction | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const m = input as Record<string, unknown>;
  if (m.t === 'setName') {
    const name = cleanText(m.name, NAME_MAX);
    return name ? { t: 'setName', name } : null;
  }
  return typeof m.t === 'string' && ACTIONS.has(m.t) ? ({ t: m.t } as ControlAction) : null;
}

/** What the main process tells the session window. */
export type SessionCommand =
  | {
      t: 'join';
      token: string;
      trackers: string[];
      peerId: string;
      name: string;
      version: string;
    }
  /** Capture the display now: the main process answers the request once. */
  | { t: 'capture' }
  /** The display changed: capture again (answered once more). */
  | { t: 'recapture' }
  /** The host is the one consented to again (a reconnect): send the stream again. */
  | { t: 'resume' }
  | { t: 'name'; name: string }
  /** Stop capturing and leave the session now: the window is destroyed right after. */
  | { t: 'leave' };

/** What the session window tells the main process. */
export type SessionReport =
  | { t: 'ready' }
  /** Connected (or connected again) to the host, with the link's fingerprints. */
  | { t: 'host'; id: string; name: string; color: string; local: string; remote: string }
  | { t: 'state'; state: 'reconnecting' | 'ended'; reason: string }
  | { t: 'captured'; w: number; h: number }
  | { t: 'capture-failed'; reason: string };

const PEER = /^[A-Za-z0-9_-]{4,40}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
const REASON = /^[a-z-]{1,32}$/;

/** The report if well formed, else null. */
export function cleanSessionReport(input: unknown): SessionReport | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const m = input as Record<string, unknown>;
  switch (m.t) {
    case 'ready':
      return { t: 'ready' };
    case 'host':
      if (
        typeof m.id !== 'string' ||
        !PEER.test(m.id) ||
        typeof m.local !== 'string' ||
        !FINGERPRINT.test(m.local) ||
        typeof m.remote !== 'string' ||
        !FINGERPRINT.test(m.remote)
      ) {
        return null;
      }
      return {
        t: 'host',
        id: m.id,
        name: cleanText(m.name, NAME_MAX),
        color: typeof m.color === 'string' && COLOR.test(m.color) ? m.color : '#8b8d98',
        local: m.local,
        remote: m.remote,
      };
    case 'state':
      if ((m.state !== 'reconnecting' && m.state !== 'ended') || typeof m.reason !== 'string') {
        return null;
      }
      return { t: 'state', state: m.state, reason: REASON.test(m.reason) ? m.reason : 'unknown' };
    case 'captured': {
      const size = (n: unknown): n is number =>
        typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 16384;
      return size(m.w) && size(m.h) ? { t: 'captured', w: m.w, h: m.h } : null;
    }
    case 'capture-failed':
      return {
        t: 'capture-failed',
        reason: typeof m.reason === 'string' && REASON.test(m.reason) ? m.reason : 'unknown',
      };
    default:
      return null;
  }
}

/** What the session window sends the overlay through their port. */
export type OverlayMessage =
  | { t: 'peers'; peers: { id: string; name: string; color: string; role: 'host' | 'guest' }[] }
  | { t: 'wb'; from: string; m: Record<string, unknown> };
