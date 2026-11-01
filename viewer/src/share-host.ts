// MIT License © 2026 Binary Dice Games
/**
 * @file The presenter's side of a share, free of DOM code so it is unit
 * tested: the host session, the lock on viewers' drawing, removal, the streams
 * on offer and the one on the screen (spec/07_participant_streaming), and the
 * `stage` messages. The presenter page mounts its own whiteboard on the host
 * session, so there is no separate console and no presenter key.
 */
import { createSession } from '@inksplat/collab-session';
import type { Peer, RendezvousSpec, Session } from '@inksplat/collab-session';
import { drawingGate } from '@inksplat/collab-whiteboard';
import {
  CANVASES,
  FORWARD_CODECS,
  PROTOCOL,
  SCREEN_CHANNEL,
  STAGE_ASPECT,
  STAGE_CHANNEL,
  STAGE_H,
  STAGE_W,
  cleanCanvasBackground,
  cleanScreenMessage,
  defaultBackgrounds,
  inviteLink,
  toMediaParams,
} from '@inksplat/defaults';
import type {
  CanvasBackground,
  ScreenMessage,
  ScreenSurface,
  Stage,
  VideoSettings,
} from '@inksplat/defaults';
import { fitScale } from './display-capture';
import type { Settings } from './settings';

/** A stream on offer: a participant's capture (spec/07_participant_streaming section 2). */
export interface StreamInfo {
  /** Its owner's peer id (the host's own id for the host's stream). */
  id: string;
  name: string;
  color: string;
  surface: ScreenSurface;
  w: number;
  h: number;
  /** Whether it is the host's own. */
  own: boolean;
}

/** What the presenter page shows about the share. */
export interface UiState {
  phase: 'idle' | 'live';
  /** The link to give viewers, or null while idle. */
  link: string | null;
  viewers: { id: string; name: string; color: string; path: string | null }[];
  /** Whether new viewers are refused. */
  locked: boolean;
  /** Whether viewers may draw. */
  drawing: boolean;
  /** The streams on offer, in the order they came. */
  streams: StreamInfo[];
  /** The id of the stream on the screen, or null. */
  active: string | null;
  /** The id of the stream the host previews, or null. */
  preview: string | null;
  /** What each canvas shows behind the board (index 0 is canvas 1). */
  backgrounds: CanvasBackground[];
  /** A problem to show (for example `no-tracker`), or null. */
  problem: string | null;
}

export const IDLE_UI: Readonly<UiState> = {
  phase: 'idle',
  link: null,
  viewers: [],
  locked: false,
  drawing: true,
  streams: [],
  active: null,
  preview: null,
  backgrounds: defaultBackgrounds(),
  problem: null,
};

/** Commands the presenter page gives. */
export type Command =
  | { cmd: 'lock'; on: boolean }
  | { cmd: 'drawing'; on: boolean }
  /** Puts stream `id` on the screen for everybody (ending its preview); null shows nothing. */
  | { cmd: 'show'; id: string | null }
  /** Has stream `id` sent to the host only, to look at it first; null ends the preview. */
  | { cmd: 'preview'; id: string | null }
  | { cmd: 'newLink' }
  | { cmd: 'remove'; id: string }
  | { cmd: 'clear' }
  | { cmd: 'clearDrawings' }
  /** Sets what canvas `page` (0 for the first) shows: `screen` or a background. */
  | { cmd: 'background'; page: number; name: string };

export interface ShareHostOptions {
  settings: Settings;
  /** Replaces the trackers in `settings` (tests use the memory network). */
  rendezvous?: RendezvousSpec[];
  /** Clears the whiteboard for everyone; the owner's whiteboard does it. */
  clearBoard?: () => void;
  clearDrawings?: () => void;
  /** Host: forward guests' encoded frames where the browser can (default true; tests). */
  forwardFrames?: boolean;
}

/**
 * One share: created by `ShareHost.start`, ended by `stop`. Listeners of
 * `onChange` get a fresh `UiState` after every change.
 */
export class ShareHost {
  readonly session: Session;
  private readonly settings: Settings;
  private readonly clearBoard: () => void;
  private readonly clearDrawings: () => void;
  private drawing: boolean;
  private video: VideoSettings;
  private readonly backgrounds: CanvasBackground[];
  private problem: string | null = null;
  /** The streams on offer, by owner id. */
  private readonly streams = new Map<string, StreamInfo>();
  private own: MediaStream | null = null;
  private active: string | null = null;
  private preview: string | null = null;
  /** What each guest was last asked to send, so nothing is sent twice. */
  private readonly asked = new Map<string, string>();
  private readonly listeners = new Set<(ui: UiState) => void>();
  private readonly gate = drawingGate(() => this.drawing);
  private stopped = false;

  private constructor(session: Session, options: ShareHostOptions) {
    this.session = session;
    this.settings = options.settings;
    this.clearBoard = options.clearBoard ?? (() => {});
    this.clearDrawings = options.clearDrawings ?? (() => {});
    this.drawing = options.settings.viewersMayDraw;
    this.video = options.settings.video;
    this.backgrounds = defaultBackgrounds();
    session.mediaParams(toMediaParams(this.video));
    session.setRelay(null);
    session.channel(STAGE_CHANNEL).on('join', (peer) => this.sendStage(peer.id));
    session.on('peers', () => this.peersChanged());
    session.on('state', () => this.changed());
    session.on('status', (e) => {
      if (e.stage === 'expired') {
        this.problem = 'tracker-expired';
        this.changed();
      } else if (e.stage === 'no-tracker') {
        this.problem = 'no-tracker';
        this.changed();
      } else if (e.stage === 'tracker' && this.problem === 'no-tracker') {
        this.problem = null;
        this.changed();
      }
    });
  }

  /**
   * Starts the host session.
   * @throws {SessionError} when WebRTC is missing
   */
  static async start(options: ShareHostOptions): Promise<ShareHost> {
    const { settings } = options;
    let host: ShareHost | null = null;
    const session = await createSession({
      role: 'host',
      protocol: PROTOCOL,
      log: (...args: unknown[]) => console.log('[inksplat]', ...args),
      me: { name: settings.name, color: settings.color },
      iceServers: settings.iceServers,
      rendezvous: options.rendezvous ?? [
        { kind: 'torrent', urls: settings.trackers, ttlMs: settings.trackerTtlMinutes * 60_000 },
        { kind: 'manual' },
      ],
      accept: (channel, message, from) => host?.accept(channel, message, from) ?? false,
      forwardCodecs: [...FORWARD_CODECS],
      ...(options.forwardFrames === false ? { forwardFrames: false } : {}),
    });
    host = new ShareHost(session, options);
    return host;
  }

  /**
   * Which of a guest's messages are delivered or relayed: only the whiteboard
   * channel, and only while viewers may draw (the gate). `stage` and everything
   * else is the host's alone, so nobody can speak for the presenter. A `screen`
   * message is taken here and never relayed: it is between its sender and the host.
   */
  private accept(channel: string, message: unknown, from: string): boolean {
    if (channel === SCREEN_CHANNEL) {
      const m = cleanScreenMessage(message);
      if (m) {
        this.screenMessage(m, from);
      }
      return false;
    }
    return channel === 'wb' && this.gate(channel, message, from);
  }

  /** A guest offers its stream or withdraws it. */
  private screenMessage(m: ScreenMessage, from: string): void {
    const peer = this.session.peers().find((p) => p.id === from && p.role === 'guest');
    if (!peer || this.stopped) {
      return;
    }
    if (m.cmd === 'withdraw') {
      this.dropStream(from);
    } else {
      this.streams.set(from, {
        id: from,
        name: peer.name,
        color: peer.color,
        surface: m.surface,
        w: m.w,
        h: m.h,
        own: false,
      });
      this.asked.delete(from); // a new capture (or a new link): tell it again
    }
    this.streamsChanged();
  }

  /** Forgets the stream of `id`; it leaves the screen and the preview. */
  private dropStream(id: string): void {
    this.streams.delete(id);
    this.asked.delete(id);
    if (this.active === id) {
      this.active = null;
    }
    if (this.preview === id) {
      this.preview = null;
    }
  }

  /** Someone came or went: the streams of those who left go. */
  private peersChanged(): void {
    const here = new Set(this.session.peers().map((p) => p.id));
    let gone = false;
    for (const id of [...this.streams.keys()]) {
      if (!here.has(id)) {
        this.dropStream(id);
        gone = true;
      }
    }
    for (const id of [...this.asked.keys()]) {
      if (!here.has(id)) {
        this.asked.delete(id);
      }
    }
    if (gone) {
      this.streamsChanged();
    } else {
      this.changed();
    }
  }

  /** Tells the session and the guests what to send, and everybody what is on the screen. */
  private streamsChanged(): void {
    this.applyStreams();
    this.sendStage();
    this.changed();
  }

  private applyStreams(): void {
    if (this.stopped) {
      return;
    }
    this.session.setRelay(this.active);
    const params = toMediaParams(this.video);
    for (const s of this.streams.values()) {
      if (s.own) {
        continue;
      }
      const active = s.id === this.active || s.id === this.preview;
      const ask = {
        active,
        fps: params.fps,
        maxBitrate: params.maxBitrate,
        contentHint: params.contentHint,
        scale: fitScale(s.w, s.h, this.video.maxWidth, this.video.maxHeight),
      };
      const key = JSON.stringify(ask);
      if (this.asked.get(s.id) !== key) {
        this.asked.set(s.id, key);
        this.session.uplinkParams(s.id, ask);
      }
    }
  }

  /** Runs a command; `from` is the viewer a removal must not hit (none here). */
  private run(command: Command): void {
    switch (command.cmd) {
      case 'lock':
        this.session.lock(command.on);
        break;
      case 'drawing':
        this.drawing = command.on;
        this.sendStage();
        break;
      case 'show':
      case 'preview': {
        const id = command.id;
        if (id !== null && !this.streams.has(id)) {
          throw new Error('unknown stream');
        }
        if (command.cmd === 'show') {
          this.active = id;
          if (id !== null && this.preview === id) {
            this.preview = null; // on the screen now: no longer only a preview
          }
        } else {
          this.preview = id;
        }
        this.streamsChanged();
        return;
      }
      case 'remove':
        this.session.remove(command.id);
        break;
      case 'background': {
        const name = cleanCanvasBackground(command.name);
        if (!name) {
          throw new Error('unknown background');
        }
        if (!Number.isInteger(command.page) || command.page < 0 || command.page >= CANVASES) {
          throw new Error('unknown canvas');
        }
        this.backgrounds[command.page] = name;
        this.sendStage();
        break;
      }
      case 'clear':
        this.clearBoard();
        break;
      case 'clearDrawings':
        this.clearDrawings();
        break;
    }
    this.changed();
  }

  /** The stage as viewers see it. */
  stage(): Stage {
    const active = this.active ? this.streams.get(this.active) : undefined;
    return {
      aspect: STAGE_ASPECT,
      w: STAGE_W,
      h: STAGE_H,
      fps: this.video.fps,
      state: this.stopped ? 'ended' : 'live',
      drawing: this.drawing,
      backgrounds: [...this.backgrounds],
      ...(active
        ? {
            screen: {
              owner: active.id,
              name: active.name,
              w: Math.max(1, active.w),
              h: Math.max(1, active.h),
            },
          }
        : {}),
      ...(this.preview ? { preview: this.preview } : {}),
    };
  }

  private sendStage(to?: string): void {
    try {
      this.session.channel(STAGE_CHANNEL).send(this.stage(), to ? { to } : {});
    } catch {
      // an ended session
    }
  }

  private trackerList(): { trackers: readonly string[] } {
    return { trackers: this.settings.trackers };
  }

  /** The link to give viewers. */
  link(): string {
    return inviteLink(this.settings.viewerBase, this.session.inviteFragment(), this.trackerList());
  }

  /** The state the page shows. */
  ui(): UiState {
    if (this.stopped) {
      return { ...IDLE_UI };
    }
    return {
      phase: 'live',
      link: this.link(),
      viewers: this.session
        .peers()
        .filter((p: Peer) => p.role === 'guest')
        .map((p) => ({ id: p.id, name: p.name, color: p.color, path: p.path })),
      locked: this.session.locked,
      drawing: this.drawing,
      streams: [...this.streams.values()].map((st) => ({ ...st })),
      active: this.active,
      preview: this.preview,
      backgrounds: [...this.backgrounds],
      problem: this.problem,
    };
  }

  /** Listens to changes; returns the function that stops listening. */
  onChange(cb: (ui: UiState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(): void {
    const ui = this.ui();
    for (const cb of [...this.listeners]) {
      cb(ui);
    }
  }

  /** Shows (or clears, with null) a problem, such as a lost capture. */
  setProblem(problem: string | null): void {
    this.problem = problem;
    this.changed();
  }

  /**
   * The host's own capture (null: it stopped), with what it shows; called again with the same
   * stream when its size changes. A new one goes on the screen when nothing else is there.
   */
  setOwnStream(
    stream: MediaStream | null,
    info: { surface: ScreenSurface; w: number; h: number } = { surface: 'unknown', w: 0, h: 0 },
  ): void {
    const id = this.session.me.id;
    const fresh = stream !== null && stream !== this.own;
    this.own = stream;
    this.session.setMedia(stream);
    if (!stream) {
      this.dropStream(id);
    } else {
      const me = this.session.peers().find((p) => p.id === id);
      this.streams.set(id, {
        id,
        name: me?.name ?? this.settings.name,
        color: me?.color ?? this.settings.color,
        ...info,
        own: true,
      });
      if (fresh && this.active === null) {
        this.active = id;
      }
    }
    this.streamsChanged();
  }

  /**
   * The video of stream `id` to show on this page: the host's own capture, or what a guest
   * sends (frames only while it is shown or previewed); null for no such stream.
   */
  streamOf(id: string | null): MediaStream | null {
    const s = id ? this.streams.get(id) : undefined;
    if (!s) {
      return null;
    }
    return s.own ? this.own : this.session.uplink(s.id);
  }

  /** New video limits: the host's own encoders and the guests sending now follow at once. */
  setVideo(video: VideoSettings): void {
    this.video = video;
    this.session.mediaParams(toMediaParams(video));
    this.applyStreams();
    this.sendStage();
  }

  /**
   * Runs a command.
   * @throws {Error} on a malformed command
   */
  async command(command: Command): Promise<void> {
    if (this.stopped) {
      return;
    }
    switch (command.cmd) {
      case 'newLink':
        await this.session.newInvite();
        if (this.problem === 'tracker-expired') {
          this.problem = null;
        }
        break;
      case 'lock':
      case 'drawing':
      case 'show':
      case 'preview':
      case 'remove':
      case 'clear':
      case 'clearDrawings':
      case 'background':
        this.run(command);
        return;
      default:
        throw new Error('unknown command');
    }
    this.changed();
  }

  /**
   * Joins a viewer who cannot reach a tracker: takes the code the viewer made
   * and returns the answer code to send back.
   * @throws {SessionError} for a damaged code or one of another session
   */
  async acceptCode(code: string): Promise<string> {
    if (this.stopped || !this.session.manual) {
      throw new Error('this session cannot take codes');
    }
    return this.session.manual.acceptOffer(code.trim());
  }

  /** Ends the share: viewers are told, links close. Idempotent. */
  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.sendStage(); // state `ended`, ahead of the session's own `end`
    this.changed();
    this.session.close();
    this.listeners.clear();
  }
}
