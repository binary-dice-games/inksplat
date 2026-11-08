// MIT License © 2026 Binary Dice Games
/**
 * @file The presenter's side of a share, free of DOM code so it is unit
 * tested: the host session, the lock on viewers' drawing, removal, the streams
 * on offer and the one on the screen (spec/07_participant_streaming), and the
 * `stage` messages. The presenter page mounts its own whiteboard on the host
 * session, so there is no separate console and no presenter key. A support session
 * (spec/08_remote_support) admits one person, whose screen is shown at once and sets the frame's
 * aspect, with the safety code of the link.
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
  safetyCode,
  supportLink,
  toMediaParams,
} from '@inksplat/defaults';
import type {
  CanvasBackground,
  ScreenMessage,
  ScreenSurface,
  Stage,
  VideoSettings,
} from '@inksplat/defaults';
import { hardwareFirst } from './codec-choice';
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

/** The kind of session: an ordinary board, or a support session (spec/08_remote_support). */
export type SessionMode = 'board' | 'support';

/** What the helper's page shows of a support session (spec/08_remote_support section 3.1). */
export interface SupportState {
  /**
   * `waiting`: nobody is connected; `deciding`: the person is connected and has not shared yet;
   * `sharing`: their screen is on the screen background.
   */
  status: 'waiting' | 'deciding' | 'sharing';
  /** The person connected, or null. */
  person: { id: string; name: string; color: string } | null;
  /** The safety code of the link to the person (`"482 913"`), or null until it is known. */
  code: string | null;
  /** The version of the person's support app, when it said. */
  version: string | null;
  /** The name of the person who left last, while nobody is connected. */
  left: string | null;
}

/** What the presenter page shows about the share. */
export interface UiState {
  phase: 'idle' | 'live';
  mode: SessionMode;
  /** The state of a support session; null in an ordinary one. */
  support: SupportState | null;
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
  mode: 'board',
  support: null,
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
  /** `support` starts a support session (spec/08_remote_support); default `board`. */
  mode?: SessionMode;
}

/** Commands an ordinary session has and a support session refuses. */
const BOARD_ONLY = new Set<Command['cmd']>([
  'lock',
  'drawing',
  'show',
  'preview',
  'newLink',
  'clear',
  'clearDrawings',
  'background',
]);

/** A DTLS certificate for every link of a support session, so its safety code holds on a reconnect. */
async function sessionCertificate(): Promise<RTCCertificate[] | undefined> {
  if (typeof RTCPeerConnection !== 'function') {
    return undefined; // the memory network of the tests
  }
  const ecdsa: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
  return [await RTCPeerConnection.generateCertificate(ecdsa)];
}

/**
 * One share: created by `ShareHost.start`, ended by `stop`. Listeners of
 * `onChange` get a fresh `UiState` after every change.
 */
export class ShareHost {
  readonly session: Session;
  readonly mode: SessionMode;
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
  /** Support: the safety code of each guest's link. */
  private readonly codes = new Map<string, string>();
  /** Support: the app version each guest said. */
  private readonly versions = new Map<string, string>();
  /** Support: the name of the person who left last (cleared when somebody connects). */
  private left: string | null = null;

  private constructor(session: Session, options: ShareHostOptions) {
    this.session = session;
    this.mode = options.mode ?? 'board';
    this.settings = options.settings;
    this.clearBoard = options.clearBoard ?? (() => {});
    this.clearDrawings = options.clearDrawings ?? (() => {});
    const support = this.mode === 'support';
    this.drawing = support ? false : options.settings.viewersMayDraw;
    this.video = support ? options.settings.supportVideo : options.settings.video;
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
    // Codecs this machine encodes in hardware first: the host's own stream is encoded once in
    // the first of them that every viewer can take.
    const forwardCodecs = await hardwareFirst(FORWARD_CODECS);
    const support = options.mode === 'support';
    // A support session sends nothing on: the person's own codec order (hardware first on their
    // machine) decides, and one certificate keeps the safety code across reconnects.
    const certificates = support ? await sessionCertificate() : undefined;
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
      forwardCodecs,
      ...(options.forwardFrames === false || support ? { forwardFrames: false } : {}),
      ...(certificates ? { certificates } : {}),
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
      if (m.v) {
        this.versions.set(from, m.v);
      }
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
      if (this.mode === 'support' && this.active === null) {
        this.active = from; // the person's screen is what a support session is for
      }
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
    if (this.mode === 'support') {
      this.supportPeers();
    }
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

  /**
   * Support: one person at most. The room is locked while somebody is connected (a forwarded link
   * lets nobody else in) and open again when they leave, so the app can reconnect; a second guest
   * who got in at the same moment is removed.
   */
  private supportPeers(): void {
    if (this.stopped) {
      return;
    }
    const guests = this.session.peers().filter((p) => p.role === 'guest');
    for (const extra of guests.slice(1)) {
      this.session.remove(extra.id);
    }
    const person = guests[0];
    if (person) {
      this.left = null;
      if (!this.codes.has(person.id)) {
        void this.findCode(person.id);
      }
    } else {
      const gone = [...this.streams.values()].find((s) => !s.own) ?? null;
      if (gone) {
        this.left = gone.name;
      }
    }
    for (const id of [...this.codes.keys()]) {
      if (id !== person?.id) {
        this.codes.delete(id);
        this.versions.delete(id);
      }
    }
    if (this.session.locked !== !!person) {
      this.session.lock(!!person);
    }
  }

  /** Support: works out the safety code of the link to `id` (DESIGN 7.3 R5). */
  private async findCode(id: string): Promise<void> {
    const fp = this.session.fingerprints(id);
    if (!fp) {
      return;
    }
    const code = await safetyCode(fp.local, fp.remote);
    if (!this.stopped && this.session.peers().some((p) => p.id === id)) {
      this.codes.set(id, code);
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
        // One viewer and a fluid video: a slow link lowers rate and size a little, not one alone.
        ...(this.mode === 'support' ? { degradationPreference: 'balanced' as const } : {}),
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
    // A support session's frame is the person's display, so a mark lands where it is drawn.
    const display = this.mode === 'support' && active && active.w > 0 && active.h > 0;
    return {
      aspect: display ? active.w / active.h : STAGE_ASPECT,
      w: display ? active.w : STAGE_W,
      h: display ? active.h : STAGE_H,
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
      ...(this.mode === 'support' ? { mode: 'support' as const } : {}),
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

  /** The link to give viewers; in a support session, the support link that opens the app. */
  link(): string {
    const make = this.mode === 'support' ? supportLink : inviteLink;
    return make(this.settings.viewerBase, this.session.inviteFragment(), this.trackerList());
  }

  /** What a support session's page shows; null in an ordinary session. */
  private supportState(): SupportState | null {
    if (this.mode !== 'support') {
      return null;
    }
    const p = this.session.peers().find((q) => q.role === 'guest') ?? null;
    return {
      status: !p ? 'waiting' : this.active === p.id ? 'sharing' : 'deciding',
      person: p ? { id: p.id, name: p.name, color: p.color } : null,
      code: p ? (this.codes.get(p.id) ?? null) : null,
      version: p ? (this.versions.get(p.id) ?? null) : null,
      left: p ? null : this.left,
    };
  }

  /** The state the page shows. */
  ui(): UiState {
    if (this.stopped) {
      return { ...IDLE_UI };
    }
    return {
      phase: 'live',
      mode: this.mode,
      support: this.supportState(),
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
    if (this.mode === 'support' && stream) {
      throw new Error('the helper does not share a screen in a support session');
    }
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
    if (this.mode === 'support' && BOARD_ONLY.has(command.cmd)) {
      throw new Error('not in a support session');
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
