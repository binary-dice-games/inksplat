// MIT License © 2026 Binary Dice Games
/**
 * @file The viewer app: joins a session from an invite link, shows the
 * screen the presenter picked with the shared whiteboard over it, and lets the
 * person draw and share a screen of their own
 * (spec/07_participant_streaming). Served from GitHub Pages next to the
 * presenter page.
 */
import { createSession, SessionError } from '@inksplat/collab-session';
import type { Session } from '@inksplat/collab-session';
import {
  LIMITS,
  cleanImageData,
  createWhiteboard,
  fileToImageData,
  frameAdapter,
} from '@inksplat/collab-whiteboard';
import type { FrameAdapter, Whiteboard } from '@inksplat/collab-whiteboard';
import {
  CODEC_PREFERENCE,
  DEFAULT_ICE_SERVERS,
  DEFAULT_TRACKERS,
  PROTOCOL,
  SCREEN_CHANNEL,
  STAGE_CHANNEL,
  cleanStage,
  parseInvite,
} from '@inksplat/defaults';
import type { Stage } from '@inksplat/defaults';
import { setToolbarFolded } from './fold';
import { filePreview } from './previews';
import { showSheet } from './sheet';
import { wireSave } from './save';
import { ownerStatus, playIn, statusText, wireShareButton } from './share-button';
import type { ShareButton } from './share-button';
import type { DisplayCapture } from './display-capture';
import {
  boardAspect,
  endMessage,
  errorMessage,
  mayDraw,
  placeholder,
  progressMessage,
} from './model';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Screen = 'landing' | 'join' | 'wait' | 'app';

function show(screen: Screen): void {
  for (const id of ['landing', 'join', 'wait', 'app']) {
    $(id).hidden = id !== screen;
  }
}

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) {
      localStorage.setItem(key, value);
    }
    return localStorage.getItem(key);
  } catch {
    return null; // private window or blocked storage: the page works without it
  }
}

const invite = parseInvite(location.hash);

/** Connection diagnostics in the browser console (F12), one line per step. */
const logger = (...args: unknown[]): void => console.log('[inksplat]', ...args);

// ── State of the running session ─────────────────────────────────────────────

let session: Session | null = null;
let board: Whiteboard | null = null;
let adapter: FrameAdapter | null = null;
let stage: Stage | null = null;
let hasVideo = false;
/** The host's video (the active stream of somebody else). */
let downlink: MediaStream | null = null;
let share: ShareButton | null = null;
/** The whiteboard toolbar is folded away (remembered). */
let folded = store('inksplat.toolsFolded') === '1';
/** A hint on how to use each tool shows for a moment when it is picked (remembered). */
let toolHints = store('inksplat.toolHints') !== '0';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** The picture chosen on the join form (an image data URL), or ''. */
let avatar = cleanImageData(store('inksplat.avatar'), LIMITS.avatarChars) ?? '';

function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

function hostId(): string | null {
  return session?.host()?.id ?? null;
}

// ── The page ─────────────────────────────────────────────────────────────────

function video(): HTMLVideoElement {
  return $<HTMLVideoElement>('video');
}

/** The canvas shown here (0 for the first). */
function canvas(): number {
  return board?.currentPage() ?? 0;
}

/** Shows the screen or, on a canvas with another background, the sheet with that background. */
function layoutSheet(): void {
  showSheet(
    { video: video(), page: $('page'), box: $('stage') },
    stage,
    boardAspect(stage),
    canvas(),
  );
}

/** The active stream: one's own capture when it is one's own (no round trip), else the host's video. */
function showScreen(): void {
  const me = session?.me.id;
  const own = share?.capture()?.stream ?? null;
  const owner = stage?.screen?.owner;
  playIn(video(), !owner ? null : owner === me ? own : downlink);
}

function refreshStage(): void {
  showScreen();
  hasVideo = video().videoWidth > 0;
  layoutSheet();
  adapter?.update();
  const me = session?.me.id ?? null;
  $('notice').textContent = placeholder(stage, hasVideo, canvas(), me ?? undefined) ?? '';
  $('shareStatus').textContent = statusText(
    ownerStatus(stage, me, share?.capture() != null),
    false,
  );
  if (board) {
    const allowed = mayDraw(stage);
    if (board.readOnly === allowed) {
      board.readOnly = !allowed;
      toast(allowed ? 'You can draw now.' : 'Drawing is disabled by the presenter.');
    }
  }
}

function renderPeople(): void {
  const peers = session ? session.peers() : [];
  const n = peers.length;
  $('people').textContent = `${n} ${n === 1 ? 'person' : 'people'}`;
  $('peopleList').replaceChildren(
    ...peers.map((p) => {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#8b8d98';
      const name = document.createElement('span');
      name.textContent =
        (p.name || (p.role === 'host' ? 'Presenter' : 'Guest')) +
        (p.id === session?.me.id ? ' (you)' : '');
      li.append(swatch, name);
      return li;
    }),
  );
  // How this person reaches the presenter, as the host measured it.
  const mine = peers.find((p) => p.id === session?.me.id)?.path;
  $('quality').textContent =
    mine === 'direct' ? 'Direct connection' : mine === 'relay' ? 'Relayed connection' : '';
}

function enterApp(): void {
  if (board || !session) {
    return;
  }
  show('app');
  const stageEl = $('stage');
  const v = video();
  adapter = frameAdapter(stageEl, () => boardAspect(stage), $('zoom'));
  board = createWhiteboard(stageEl, {
    session,
    adapter,
    readOnly: !mayDraw(stage),
    avatar,
    filePreview,
    toolHints,
  });
  board.on('error', (e) => toast(e.message));
  board.on('page', refreshStage);
  for (const event of ['loadedmetadata', 'resize', 'playing']) {
    v.addEventListener(event, refreshStage);
  }
  new ResizeObserver(layoutSheet).observe(stageEl);
  setToolbarFolded(board, folded);
  refreshStage();
  renderPeople();
}

function endSession(message: string): void {
  share?.stop();
  board?.destroy();
  board = null;
  adapter = null;
  $('waitTitle').textContent = 'Session over';
  $('waitText').textContent = message;
  show('wait');
}

// ── Joining ──────────────────────────────────────────────────────────────────

async function join(name: string, color: string): Promise<void> {
  if (!invite) {
    return;
  }
  show('wait');
  $('waitTitle').textContent = 'Connecting…';
  $('waitText').textContent = progressMessage(undefined);
  try {
    session = await createSession({
      role: 'guest',
      token: invite.token,
      protocol: PROTOCOL,
      videoCodecs: [...CODEC_PREFERENCE],
      log: logger,
      me: { name, color },
      iceServers: [...DEFAULT_ICE_SERVERS],
      rendezvous: [
        { kind: 'torrent', urls: invite.trackers ?? [...DEFAULT_TRACKERS] },
        { kind: 'manual' },
      ],
    });
  } catch (e) {
    const reason = e instanceof SessionError ? e.reason : undefined;
    $('waitTitle').textContent = 'Cannot join';
    $('waitText').textContent = errorMessage(reason);
    return;
  }
  const s = session;
  wireCodes(s);
  s.on('status', (e) => {
    if (!board) {
      $('waitText').textContent = progressMessage(e.stage);
    }
  });
  s.on('error', (e) => {
    if (!board) {
      $('waitText').textContent = errorMessage('reason' in e ? (e.reason as string) : undefined);
    }
  });
  s.on('state', (e) => {
    if (e.state === 'open') {
      enterApp();
    } else if (e.state === 'ended') {
      endSession(endMessage(e.reason));
    }
  });
  s.on('track', (stream) => {
    downlink = stream;
    refreshStage();
  });
  // A new link to the host (a reconnect): offer the running capture again.
  s.channel(SCREEN_CHANNEL).on('join', (peer) => {
    const c = share?.capture();
    if (c && peer.role === 'host') {
      offer(c);
    }
  });
  s.on('peers', renderPeople);
  s.channel(STAGE_CHANNEL).on('message', (m, from) => {
    const next = cleanStage(m);
    if (next && from === hostId()) {
      stage = next;
      if (next.state === 'ended') {
        $('notice').textContent = placeholder(next, hasVideo, canvas()) ?? '';
      }
      refreshStage();
    }
  });
}

/** Tells the host this person captures `c` (the uplink sends only once the host asks). */
function offer(c: DisplayCapture, size = c.size()): void {
  const to = hostId();
  if (session && to) {
    session
      .channel(SCREEN_CHANNEL)
      .send({ cmd: 'offer', surface: c.surface, w: size.width, h: size.height }, { to });
  }
}

/** The share button: a capture goes on the uplink, offered to the host. */
function wireShare(): void {
  share = wireShareButton({
    button: $<HTMLButtonElement>('share'),
    notice: $<HTMLDialogElement>('shareNotice'),
    toast,
    onStart: (c) => {
      session?.setUplink(c.stream);
      offer(c);
      refreshStage();
    },
    onResize: (width, height) => {
      const c = share?.capture();
      if (c) {
        offer(c, { width, height });
      }
    },
    onStop: () => {
      session?.setUplink(null);
      const to = hostId();
      if (session && to && session.state !== 'ended') {
        session.channel(SCREEN_CHANNEL).send({ cmd: 'withdraw' }, { to });
      }
      refreshStage();
    },
  });
}

/** The "join with a code" fallback for networks that block the trackers. */
function wireCodes(s: Session): void {
  const say = (text: string): void => {
    $('codeStatus').textContent = text;
  };
  $('makeCode').addEventListener('click', async () => {
    try {
      const code = await s.manual?.offerCode();
      const box = $<HTMLTextAreaElement>('myCode');
      box.value = code ?? '';
      box.hidden = false;
      box.select();
      say('Send this code to the presenter, then paste their answer below.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not make a code.');
    }
  });
  $('useAnswer').addEventListener('click', async () => {
    try {
      await s.manual?.acceptAnswer($<HTMLTextAreaElement>('answerCode').value);
      say('Connecting\u2026');
    } catch (e) {
      say(e instanceof Error ? e.message : 'That answer did not work.');
    }
  });
}

/** Opens the About dialog from the home page's buttons. */
function wireAbout(): void {
  const about = $<HTMLDialogElement>('about');
  for (const id of ['aboutOpen', 'aboutFoot']) {
    $(id).addEventListener('click', () => about.showModal());
  }
  $('aboutClose').addEventListener('click', () => about.close());
}

// ── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const nameInput = $<HTMLInputElement>('name');
  const colorInput = $<HTMLInputElement>('color');
  const palette = ['#e5484d', '#f5a524', '#30a46c', '#0f9f86', '#3e63dd', '#8e4ec6'];
  colorInput.value =
    store('inksplat.color') ?? palette[Math.floor(Math.random() * palette.length)] ?? '#3e63dd';
  nameInput.value = store('inksplat.name') ?? '';

  wireSave({ board: () => board, stage: () => stage, video: () => video(), toast });
  wireShare();
  // Leaving tells the presenter at once (their list of streams, the screen), not after a timeout.
  window.addEventListener('pagehide', () => session?.close());
  $('toolsToggle').setAttribute('aria-pressed', String(!folded));
  $('toolsToggle').addEventListener('click', () => {
    folded = !folded;
    store('inksplat.toolsFolded', folded ? '1' : '0');
    $('toolsToggle').setAttribute('aria-pressed', String(!folded));
    setToolbarFolded(board, folded);
  });

  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void $('app')
        .requestFullscreen()
        .catch(() => {});
    }
  });
  $('people').addEventListener('click', () => {
    const list = $('peopleList');
    list.hidden = !list.hidden;
    $('people').setAttribute('aria-expanded', String(!list.hidden));
  });
  if (!invite) {
    wireAbout();
    show('landing');
    if (location.hash.includes('inksplat=')) {
      $('landingProblem').textContent = 'That link is not valid. Ask the presenter for a new one.';
      $('landingProblem').hidden = false;
    }
    return;
  }

  show('join');
  const showAvatar = (data: string): void => {
    avatar = data;
    store('inksplat.avatar', data);
    const img = $<HTMLImageElement>('avatarPreview');
    img.hidden = data === '';
    if (data) {
      img.src = data;
    } else {
      img.removeAttribute('src');
    }
  };
  showAvatar(avatar);
  const hintsInput = $<HTMLInputElement>('toolHints');
  hintsInput.checked = toolHints;
  hintsInput.addEventListener('change', () => {
    toolHints = hintsInput.checked;
    store('inksplat.toolHints', toolHints ? '1' : '0');
  });
  $<HTMLInputElement>('avatar').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      fileToImageData(file, { maxSide: 96, square: true, maxChars: LIMITS.avatarChars }).then(
        (picture) => showAvatar(picture.data),
        (err: unknown) => {
          $('avatarHint').textContent =
            err instanceof Error ? err.message : 'That picture cannot be used.';
        },
      );
    }
  });
  $('avatarClear').addEventListener('click', () => showAvatar(''));
  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim() || 'Guest';
    store('inksplat.name', name);
    store('inksplat.color', colorInput.value);
    void join(name, colorInput.value);
  });
  nameInput.focus();
}

void main();
