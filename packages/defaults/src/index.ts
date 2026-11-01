// MIT License © 2026 Binary Dice Games
/**
 * @file Defaults and small pure helpers shared by the presenter page and the
 * viewer: trackers, ICE servers, video presets, the `stage` message and
 * invite links. See spec/01_core_features/DESIGN.md.
 */

/** Wire protocol id; changes only on incompatible changes. */
export const PROTOCOL = 'inksplat/2';

/** Where the viewer is served by default (GitHub Pages of this repository). */
export const DEFAULT_VIEWER_BASE = 'https://binary-dice-games.github.io/inksplat/';

/** Public WebTorrent trackers used to introduce peers (they see only sealed bytes). */
export const DEFAULT_TRACKERS: readonly string[] = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz',
];

/** STUN only: TURN needs credentials and is left to the user's settings. */
export const DEFAULT_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Bounds and defaults of the video settings (spec/03_tab_streaming/DESIGN.md section 4). */
export const VIDEO_LIMITS = {
  fps: { min: 0.5, max: 15, default: 3 },
  /**
   * The frame is never upscaled, and it is sent at the screen's own resolution up to these
   * limits: text is only sharp when it is not resized (spikes/video-quality). The defaults
   * are the largest, so only a screen bigger than 4K is reduced.
   */
  width: { min: 640, max: 3840, default: 3840 },
  height: { min: 360, max: 2160, default: 2160 },
  /** A still page needs far less than this; it is the cap for moving content. */
  bitrateKbps: { min: 100, max: 8000, default: 1500 },
} as const;

export type ContentHint = 'detail' | 'text' | 'motion';

export interface VideoSettings {
  fps: number;
  maxWidth: number;
  maxHeight: number;
  bitrateKbps: number;
  contentHint: ContentHint;
}

export const DEFAULT_VIDEO: Readonly<VideoSettings> = {
  fps: VIDEO_LIMITS.fps.default,
  maxWidth: VIDEO_LIMITS.width.default,
  maxHeight: VIDEO_LIMITS.height.default,
  bitrateKbps: VIDEO_LIMITS.bitrateKbps.default,
  contentHint: 'detail',
};

/** Frame-rate presets offered by the options page. */
export const FPS_PRESETS: readonly number[] = [1, 3, 5, 10];

/**
 * Codec preference, best first; the browser's own order follows. Measured on text
 * (spikes/video-quality, spec/03_tab_streaming/DESIGN.md section 4): once the page is still and
 * its frame repeated (`viewer/src/still-refresh.ts`) every codec shows the text legibly; AV1 sends
 * the fewest bytes and keeps the most detail while the page moves, H.264 is a little crisper
 * when still but its software encoder drops frames at 4K, VP9 and VP8 smear the most while
 * moving. The viewer lists these first in its offer, because the sender uses the first codec of
 * the offer that it supports.
 */
export const CODEC_PREFERENCE: readonly string[] = [
  'video/AV1',
  'video/H264',
  'video/VP9',
  'video/VP8',
];

/**
 * Codecs the presenter forwards guests' streams in, best first (`forwardCodecs` of the
 * session): each link uses the first its offer lists. A viewer whose codec differs from the
 * shown guest's gets that stream re-encoded by the presenter. H.264 and VP8 are in every
 * browser (RFC 7742); AV1 is not (Safari only with hardware support).
 */
export const FORWARD_CODECS: readonly string[] = ['video/AV1', 'video/H264', 'video/VP8'];

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Settings from any stored object: every field clamped into its range, missing ones defaulted. */
export function cleanVideoSettings(input: unknown): VideoSettings {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const hint = o.contentHint;
  return {
    fps: clamp(o.fps, VIDEO_LIMITS.fps.min, VIDEO_LIMITS.fps.max, DEFAULT_VIDEO.fps),
    maxWidth: Math.round(
      clamp(o.maxWidth, VIDEO_LIMITS.width.min, VIDEO_LIMITS.width.max, DEFAULT_VIDEO.maxWidth),
    ),
    maxHeight: Math.round(
      clamp(o.maxHeight, VIDEO_LIMITS.height.min, VIDEO_LIMITS.height.max, DEFAULT_VIDEO.maxHeight),
    ),
    bitrateKbps: Math.round(
      clamp(
        o.bitrateKbps,
        VIDEO_LIMITS.bitrateKbps.min,
        VIDEO_LIMITS.bitrateKbps.max,
        DEFAULT_VIDEO.bitrateKbps,
      ),
    ),
    contentHint:
      hint === 'text' || hint === 'motion' || hint === 'detail' ? hint : DEFAULT_VIDEO.contentHint,
  };
}

/** The `Session.mediaParams()` argument for these settings. */
export function toMediaParams(settings: VideoSettings): {
  fps: number;
  maxBitrate: number;
  contentHint: ContentHint;
  codecs: string[];
} {
  return {
    fps: settings.fps,
    maxBitrate: settings.bitrateKbps * 1000,
    contentHint: settings.contentHint,
    codecs: [...CODEC_PREFERENCE],
  };
}

/** Uplink the presenter needs for `viewers` viewers (a star: one stream each), in kbit/s. */
export function uplinkKbps(viewers: number, settings: Pick<VideoSettings, 'bitrateKbps'>): number {
  return Math.max(0, Math.floor(viewers)) * settings.bitrateKbps;
}

/** The uplink above which the options page warns, in kbit/s. */
export const UPLINK_WARNING_KBPS = 4000;

// ── Stage message ─────────────────────────────────────────────────────────────

export type StageState = 'live' | 'ended';

/** The board frame's fixed size and aspect: every stream is letterboxed into it. */
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STAGE_ASPECT = STAGE_W / STAGE_H;

/** The stream on the screen background (spec/07_participant_streaming/DESIGN.md section 5.2). */
export interface ScreenInfo {
  /** Peer id of the person who shares it (the host's own id for the host's stream). */
  owner: string;
  name: string;
  /** The captured size, for the letterbox before the first frame. */
  w: number;
  h: number;
}

/** What the host tells viewers about the shared frame (channel `stage`). */
export interface Stage {
  /** Frame width / height: fixed for the session ({@link STAGE_ASPECT}). */
  aspect: number;
  w: number;
  h: number;
  fps: number;
  state: StageState;
  /** Whether viewers may draw. */
  drawing: boolean;
  /**
   * What each canvas shows behind the board, one entry per canvas (index 0 is canvas 1); absent:
   * {@link defaultBackgrounds}.
   */
  backgrounds?: CanvasBackground[];
  /** The active stream, absent when none is (the screen background is black). */
  screen?: ScreenInfo;
  /** Peer id of the stream the host previews, absent when none (tells its owner). */
  preview?: string;
  title?: string;
}

/** The backgrounds drawn behind a canvas instead of the screen. */
export const BACKGROUNDS = ['whiteboard', 'blackboard', 'wall', 'cork'] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const DEFAULT_BACKGROUND: Background = 'whiteboard';

/** What a canvas shows behind the board: the active stream (`screen`), or one of {@link BACKGROUNDS}. */
export type CanvasBackground = Background | 'screen';

/** How many canvases a board has (the whiteboard's `PAGES`). */
export const CANVASES = 5;

/** The background if `value` is one of {@link BACKGROUNDS}, else undefined. */
export function cleanBackground(value: unknown): Background | undefined {
  return BACKGROUNDS.find((b) => b === value);
}

/**
 * The canvas background if `value` is `screen` or one of {@link BACKGROUNDS}, else undefined.
 * `video`, the name of earlier versions (stages, board files), is read as `screen`.
 */
export function cleanCanvasBackground(value: unknown): CanvasBackground | undefined {
  return value === 'screen' || value === 'video' ? 'screen' : cleanBackground(value);
}

/**
 * The backgrounds of the canvases when nobody has chosen: canvas 1 shows the screen and the
 * others the backgrounds in order.
 */
export function defaultBackgrounds(): CanvasBackground[] {
  const order: CanvasBackground[] = ['screen', ...BACKGROUNDS];
  return Array.from({ length: CANVASES }, (_, i) => order[i % order.length]!);
}

/** What canvas `page` (0 for the first) shows behind the board in `stage`. */
export function canvasBackground(stage: Stage | null, page: number): CanvasBackground {
  const chosen = cleanCanvasBackground(stage?.backgrounds?.[page]);
  return chosen ?? defaultBackgrounds()[page] ?? DEFAULT_BACKGROUND;
}

export const STAGE_CHANNEL = 'stage';

const MAX_TITLE = 120;
const MAX_NAME = 40;
const PEER_ID = /^[A-Za-z0-9_-]{4,40}$/;

/** `text` without control characters, at most `max` long. */
const printable = (text: string, max: number): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u001f]/g, '').slice(0, max);

/** The stage if the message is well formed, else null; unknown fields are dropped. */
export function cleanStage(message: unknown): Stage | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const m = message as Record<string, unknown>;
  const finite = (n: unknown, lo: number, hi: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (
    !finite(m.aspect, 0.1, 10) ||
    !finite(m.w, 1, 16384) ||
    !finite(m.h, 1, 16384) ||
    !finite(m.fps, 0, 120)
  ) {
    return null;
  }
  if (m.state !== 'live' && m.state !== 'ended') {
    return null;
  }
  if (typeof m.drawing !== 'boolean') {
    return null;
  }
  const stage: Stage = {
    aspect: m.aspect,
    w: m.w,
    h: m.h,
    fps: m.fps,
    state: m.state,
    drawing: m.drawing,
  };
  if (Array.isArray(m.backgrounds)) {
    stage.backgrounds = defaultBackgrounds().map(
      (d, i) => cleanCanvasBackground((m.backgrounds as unknown[])[i]) ?? d,
    );
  }
  const sc = m.screen as Record<string, unknown> | undefined;
  if (
    typeof sc === 'object' &&
    sc !== null &&
    typeof sc.owner === 'string' &&
    PEER_ID.test(sc.owner) &&
    finite(sc.w, 1, 16384) &&
    finite(sc.h, 1, 16384)
  ) {
    stage.screen = {
      owner: sc.owner,
      name: typeof sc.name === 'string' ? printable(sc.name, MAX_NAME) : '',
      w: sc.w,
      h: sc.h,
    };
  }
  if (typeof m.preview === 'string' && PEER_ID.test(m.preview)) {
    stage.preview = m.preview;
  }
  if (typeof m.title === 'string' && m.title.length > 0) {
    stage.title = printable(m.title, MAX_TITLE);
  }
  return stage;
}

// ── Screen channel (spec/07_participant_streaming/DESIGN.md section 5.1) ──────

/** Point-to-point messages about streams between a guest and the host. */
export const SCREEN_CHANNEL = 'screen';

/** The surface a stream shows (`displaySurface`). */
export type ScreenSurface = 'browser' | 'window' | 'monitor' | 'unknown';

/** A guest tells the host it captures (`offer`, again on a size change) or stopped (`withdraw`). */
export type ScreenMessage =
  { cmd: 'offer'; surface: ScreenSurface; w: number; h: number } | { cmd: 'withdraw' };

/** The screen message if well formed, else null; unknown fields are dropped. */
export function cleanScreenMessage(message: unknown): ScreenMessage | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const m = message as Record<string, unknown>;
  if (m.cmd === 'withdraw') {
    return { cmd: 'withdraw' };
  }
  if (m.cmd !== 'offer') {
    return null;
  }
  const size = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 16384;
  if (!size(m.w) || !size(m.h)) {
    return null;
  }
  const surface: ScreenSurface =
    m.surface === 'browser' || m.surface === 'window' || m.surface === 'monitor'
      ? m.surface
      : 'unknown';
  return { cmd: 'offer', surface, w: m.w, h: m.h };
}

// ── Invite links ──────────────────────────────────────────────────────────────

const FRAGMENT_KEY = 'inksplat';
const TRACKER_KEY = 'tr';
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const MAX_TRACKERS = 10;

/** What an invite link carries. */
export interface Invite {
  /** The room token. */
  token: string;
  /** Trackers to use when they differ from the defaults (a viewer cannot guess them). */
  trackers?: string[];
}

/**
 * `<base>#inksplat=<token>[&tr=<tracker>...]`; `fragment` is
 * `Session.inviteFragment()`. Trackers are added only when they are not the
 * defaults.
 */
export function inviteLink(
  base: string,
  fragment: string,
  extra: { trackers?: readonly string[] } = {},
): string {
  const url = new URL(base);
  const params = new URLSearchParams(fragment);
  const custom =
    extra.trackers &&
    extra.trackers.length > 0 &&
    extra.trackers.join(' ') !== DEFAULT_TRACKERS.join(' ');
  if (custom) {
    for (const tracker of extra.trackers!.slice(0, MAX_TRACKERS)) {
      params.append(TRACKER_KEY, tracker);
    }
  }
  url.hash = params.toString();
  return url.toString();
}

/** The invite in a URL hash, or null if the room token is absent or malformed. */
export function parseInvite(hash: string): Invite | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get(FRAGMENT_KEY);
  if (token === null || !TOKEN.test(token)) {
    return null;
  }
  const invite: Invite = { token };
  const trackers = params
    .getAll(TRACKER_KEY)
    .filter((t) => /^wss?:\/\/[^\s]+$/.test(t))
    .slice(0, MAX_TRACKERS);
  if (trackers.length > 0) {
    invite.trackers = trackers;
  }
  return invite;
}

/** The room token in a URL hash (`#inksplat=<token>`), or null if absent or malformed. */
export function parseInviteHash(hash: string): string | null {
  return parseInvite(hash)?.token ?? null;
}
