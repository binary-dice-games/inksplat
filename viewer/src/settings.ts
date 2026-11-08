// MIT License © 2026 Binary Dice Games
/**
 * @file Presenter settings: the schema, its defaults and the validation applied
 * to anything read from storage or typed in the settings dialog.
 */
import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_TRACKERS,
  DEFAULT_VIDEO,
  DEFAULT_VIEWER_BASE,
  SUPPORT_VIDEO,
  cleanSupportVideo,
  cleanVideoSettings,
} from '@inksplat/defaults';
import type { VideoSettings } from '@inksplat/defaults';
import { LIMITS, cleanImageData } from '@inksplat/collab-whiteboard';

export interface Settings {
  viewerBase: string;
  trackers: string[];
  iceServers: RTCIceServer[];
  video: VideoSettings;
  /** The video of a support session: one viewer, so a higher frame rate (spec/08 section 4.3). */
  supportVideo: VideoSettings;
  /** Whether viewers may draw when a session starts. */
  viewersMayDraw: boolean;
  /** The presenter's name shown to viewers. */
  name: string;
  /** The presenter's colour (`#rrggbb`). */
  color: string;
  /** The presenter's picture (an image data URL), shown instead of the name on the cursor; `''`: none. */
  avatar: string;
  /**
   * How long the host stays announced to the trackers, in minutes; then the link admits no new
   * viewers until a new link is made. 0: no limit.
   */
  trackerTtlMinutes: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  viewerBase: DEFAULT_VIEWER_BASE,
  trackers: [...DEFAULT_TRACKERS],
  iceServers: DEFAULT_ICE_SERVERS.map((s) => ({ ...s })),
  video: { ...DEFAULT_VIDEO },
  supportVideo: { ...SUPPORT_VIDEO },
  viewersMayDraw: true,
  name: 'Presenter',
  color: '#3e63dd',
  avatar: '',
  trackerTtlMinutes: 60,
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const ICE_URL = /^(stun|stuns|turn|turns):[^\s]+$/;
const MAX_LIST = 10;
/** A week: more is the same as no limit for a presentation. */
const MAX_TTL_MINUTES = 7 * 24 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An https URL string (http only for a local address, for development), or null. */
export function cleanViewerBase(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const url = new URL(value.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return null;
    }
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The ws(s) tracker URLs of a list (one entry per line is accepted as text), deduplicated. */
export function cleanTrackers(value: unknown): string[] | null {
  const list = typeof value === 'string' ? value.split(/\s*\n\s*/) : value;
  if (!Array.isArray(list)) {
    return null;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string' || item.trim() === '') {
      continue;
    }
    try {
      const url = new URL(item.trim());
      if ((url.protocol === 'wss:' || url.protocol === 'ws:') && !seen.has(url.toString())) {
        seen.add(url.toString());
        out.push(item.trim());
      }
    } catch {
      // not a URL: dropped
    }
  }
  return out.slice(0, MAX_LIST);
}

/** The valid STUN/TURN servers of a list; entries need a `stun:`/`turn:` URL. */
export function cleanIceServers(value: unknown): RTCIceServer[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: RTCIceServer[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const urls = (Array.isArray(item.urls) ? item.urls : [item.urls]).filter(
      (u): u is string => typeof u === 'string' && ICE_URL.test(u.trim()),
    );
    if (urls.length === 0) {
      continue;
    }
    const server: RTCIceServer = { urls: urls.length === 1 ? urls[0]! : urls };
    if (typeof item.username === 'string' && item.username !== '') {
      server.username = item.username;
    }
    if (typeof item.credential === 'string' && item.credential !== '') {
      server.credential = item.credential;
    }
    out.push(server);
  }
  return out.slice(0, MAX_LIST);
}

/**
 * Settings from any stored value: every field validated, invalid or missing
 * ones replaced by their defaults. An empty tracker list is kept (the user
 * may rely on manual codes), an invalid one is not.
 */
export function cleanSettings(input: unknown): Settings {
  const o = isRecord(input) ? input : {};
  const name =
    typeof o.name === 'string'
      ? o.name
          .replace(/\p{Cc}/gu, '')
          .trim()
          .slice(0, 40)
      : '';
  return {
    viewerBase: cleanViewerBase(o.viewerBase) ?? DEFAULT_SETTINGS.viewerBase,
    trackers: cleanTrackers(o.trackers) ?? [...DEFAULT_SETTINGS.trackers],
    iceServers: cleanIceServers(o.iceServers) ?? DEFAULT_SETTINGS.iceServers.map((s) => ({ ...s })),
    video: cleanVideoSettings(o.video),
    supportVideo: cleanSupportVideo(o.supportVideo),
    viewersMayDraw:
      typeof o.viewersMayDraw === 'boolean' ? o.viewersMayDraw : DEFAULT_SETTINGS.viewersMayDraw,
    name: name || DEFAULT_SETTINGS.name,
    color: typeof o.color === 'string' && COLOR.test(o.color) ? o.color : DEFAULT_SETTINGS.color,
    avatar: cleanImageData(o.avatar, LIMITS.avatarChars) ?? '',
    trackerTtlMinutes:
      typeof o.trackerTtlMinutes === 'number' && Number.isFinite(o.trackerTtlMinutes)
        ? Math.min(MAX_TTL_MINUTES, Math.max(0, Math.round(o.trackerTtlMinutes)))
        : DEFAULT_SETTINGS.trackerTtlMinutes,
  };
}

// ── Text form of the lists (options page) ────────────────────────────────────

/** One server per line: `stun:host:port` or `turn:host:port username credential`. */
export function parseIceLines(text: string): RTCIceServer[] {
  const servers: unknown[] = [];
  for (const line of text.split('\n')) {
    const [url, username, credential] = line.trim().split(/\s+/);
    if (url) {
      servers.push({ urls: url, username, credential });
    }
  }
  return cleanIceServers(servers) ?? [];
}

/** The inverse of {@link parseIceLines}. */
export function formatIceLines(servers: readonly RTCIceServer[]): string {
  return servers
    .flatMap((s) =>
      (Array.isArray(s.urls) ? s.urls : [s.urls]).map((url) =>
        [url, s.username, s.credential]
          .filter((part) => part !== undefined && part !== '')
          .join(' '),
      ),
    )
    .join('\n');
}
