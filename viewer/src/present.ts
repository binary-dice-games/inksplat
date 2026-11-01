// MIT License © 2026 Binary Dice Games
/**
 * @file The presenter page (spec/06_static_presenter, spec/07_participant_streaming): it starts
 * the session and is host and console at once. Anybody, the presenter too, can share a tab, a
 * window or a screen at any time; the presenter picks the stream on the screen background from
 * the streams on offer. The whiteboard is mounted on the host session.
 */
import { SessionError } from '@inksplat/collab-session';
import {
  LIMITS,
  createWhiteboard,
  fileToImageData,
  frameAdapter,
} from '@inksplat/collab-whiteboard';
import type { FrameAdapter, Whiteboard } from '@inksplat/collab-whiteboard';
import {
  DEFAULT_SETTINGS,
  cleanSettings,
  cleanTrackers,
  formatIceLines,
  parseIceLines,
} from './settings';
import type { Settings } from './settings';
import { ShareHost } from './share-host';
import type { StreamInfo, UiState } from './share-host';
import { UPLINK_WARNING_KBPS, canvasBackground, uplinkKbps } from '@inksplat/defaults';
import { fitScale, surfaceWarning } from './display-capture';
import { boardAspect, errorMessage } from './model';
import { ownerStatus, playIn as play, statusText, wireShareButton } from './share-button';
import type { ShareButton } from './share-button';
import { setToolbarFolded } from './fold';
import { filePreview } from './previews';
import { qrModules, qrPng, qrSvg } from './qr';
import { showSheet } from './sheet';
import { boardArchive, download, fileStamp, openBoardFile, wireSave } from './save';
import type { SaveHost } from './save';
import { BackupWriter, backupInfo, openBackupStore } from './backup';
import type { BackupInfo, BackupStore } from './backup';
import { cleanPrefs, loadPrefs, savePrefs } from './present-settings';
import type { PresenterPrefs } from './present-settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Screen = 'start' | 'app' | 'over';

function show(screen: Screen): void {
  for (const id of ['start', 'app', 'over']) {
    $(id).hidden = id !== screen;
  }
}

// ── State of the running share ───────────────────────────────────────────────

let host: ShareHost | null = null;
let share: ShareButton | null = null;
let board: Whiteboard | null = null;
let adapter: FrameAdapter | null = null;
let settings: Settings | null = null;
let prefs: PresenterPrefs = loadPrefs();
/** The avatar in the settings dialog, until it is saved. */
let avatarDraft = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** The streams on offer at the last render, to say when a new one comes. */
let offered = new Set<string>();
/** Where the board's backup is kept (null: this browser has no storage for it). */
let backupStore: Promise<BackupStore | null> | null = null;
/** Writes the running session's board to its backup; null before the resume question is answered. */
let backup: BackupWriter | null = null;

function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

function problemText(problem: string | null): string {
  return problem === null ? '' : errorMessage(problem);
}

/** The address viewers open: this page's own folder (the site root), not `present.html`. */
function siteBase(): string {
  return new URL('./', location.href).toString();
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
  if (!host) {
    return;
  }
  showSheet(
    { video: video(), page: $('page'), box: $('stage') },
    host.stage(),
    boardAspect(host.stage()),
    canvas(),
  );
}

/** The host's own encoders reduce its capture to the size limit. */
function ownScale(width: number, height: number): void {
  if (host && settings) {
    host.session.mediaParams({
      scale: fitScale(width, height, settings.video.maxWidth, settings.video.maxHeight),
    });
  }
}

const SURFACES: Record<string, string> = {
  browser: 'tab',
  window: 'window',
  monitor: 'screen',
  unknown: 'screen',
};

function button(text: string, label: string, onClick: () => void, pressed?: boolean): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  if (pressed !== undefined) {
    b.setAttribute('aria-pressed', String(pressed));
  }
  b.addEventListener('click', onClick);
  return b;
}

/** A list row's text: a name and, under it, an optional detail; both cut with an ellipsis. */
function rowText(name: string, meta?: string): HTMLElement {
  const text = document.createElement('span');
  text.className = 'text';
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  text.append(n);
  if (meta) {
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = meta;
    text.append(m);
  }
  text.title = meta ? `${name}: ${meta}` : name;
  return text;
}

/** The Screen section: a row per stream on offer, and None. */
function renderStreams(ui: UiState): void {
  const row = (s: StreamInfo | null): HTMLElement => {
    const li = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    const id = s?.id ?? null;
    let text: HTMLElement;
    if (s) {
      swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#8b8d98';
      const size = s.w > 0 ? ` ${s.w}\u00d7${s.h}` : '';
      text = rowText(
        `${s.name || 'Viewer'}${s.own ? ' (you)' : ''}`,
        `${SURFACES[s.surface]}${size}`,
      );
    } else {
      swatch.style.background = '#000';
      text = rowText('None', 'black screen');
    }
    li.classList.toggle('active', ui.active === id);
    li.append(swatch, text);
    const who = s ? (s.own ? 'your screen' : `the screen of ${s.name || 'a viewer'}`) : 'nothing';
    if (s && !s.own) {
      const on = ui.preview === id;
      li.append(
        button(
          'Preview',
          `Preview ${who}`,
          () => void host?.command({ cmd: 'preview', id: on ? null : id }),
          on,
        ),
      );
    }
    li.append(
      button(
        'Show',
        `Show ${who} to everybody`,
        () => void host?.command({ cmd: 'show', id }),
        ui.active === id,
      ),
    );
    return li;
  };
  $('streams').replaceChildren(...ui.streams.map(row), row(null));
  // A new offer from a guest: say so.
  for (const s of ui.streams) {
    if (!s.own && !offered.has(s.id)) {
      toast(`${s.name || 'A viewer'} offers a screen: Preview or Show it under Screen.`);
    }
  }
  offered = new Set(ui.streams.map((s) => s.id));
  const pv = $<HTMLVideoElement>('previewVideo');
  const preview = ui.preview && ui.preview !== ui.active ? host!.streamOf(ui.preview) : null;
  play(pv, preview);
  pv.hidden = !preview;
  $('screenHere').hidden =
    ui.active === null || canvasBackground(host!.stage(), canvas()) === 'screen';
}

function render(): void {
  if (!host) {
    return;
  }
  const ui = host.ui();
  const n = ui.viewers.length;
  $('people').textContent = `${n} ${n === 1 ? 'viewer' : 'viewers'}`;
  const own = share?.capture();
  const warning = own ? surfaceWarning(own.surface) : null;
  $('warning').textContent = [problemText(ui.problem), warning].filter(Boolean).join(' ');
  $<HTMLInputElement>('link').value = ui.link ?? '';
  $<HTMLInputElement>('drawing').checked = ui.drawing;
  $<HTMLInputElement>('lock').checked = ui.locked;
  $('backgroundLabel').textContent = `Background of canvas ${canvas() + 1}`;
  $<HTMLSelectElement>('background').value = ui.backgrounds[canvas()] ?? 'whiteboard';
  play(video(), host.streamOf(ui.active));
  const onScreen = canvasBackground(host.stage(), canvas()) === 'screen';
  $('notice').textContent = onScreen && ui.active === null ? 'Nothing is being shared' : '';
  $('shareStatus').textContent = statusText(
    ownerStatus(host.stage(), host.session.me.id, share?.capture() != null),
    true,
  );
  renderStreams(ui);
  layoutSheet();
  adapter?.update();
  $('viewers').replaceChildren(
    ...ui.viewers.map((p) => {
      const li = document.createElement('li');
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.style.background = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#8b8d98';
      avatar.textContent = (p.name || 'Viewer').trim().charAt(0).toUpperCase() || '?';
      avatar.setAttribute('aria-hidden', 'true');
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.textContent = 'Remove';
      kick.setAttribute('aria-label', `Remove ${p.name || 'viewer'}`);
      kick.addEventListener('click', () => void host?.command({ cmd: 'remove', id: p.id }));
      li.append(avatar, rowText(p.name || 'Viewer'), kick);
      return li;
    }),
  );
}

function enterApp(): void {
  if (!host) {
    return;
  }
  show('app');
  const stageEl = $('stage');
  const h = host;
  offered = new Set();
  adapter = frameAdapter(stageEl, () => boardAspect(h.stage()), $('zoom'));
  board = createWhiteboard(stageEl, {
    session: h.session,
    adapter,
    readOnly: false,
    avatar: settings?.avatar,
    filePreview,
  });
  board.on('error', (e) => toast(e.message));
  board.on('page', render);
  host.onChange(render);
  new ResizeObserver(() => {
    layoutSheet();
    adapter?.update();
  }).observe(stageEl);
  setToolsCollapsed(prefs.toolsCollapsed);
  setPanelCollapsed(prefs.panelCollapsed);
  render();
}

function endSession(message: string): void {
  // The backup stays (written up to the end): the next session offers to resume it.
  const writer = backup;
  backup = null;
  void writer?.flush().then(() => writer.stop());
  host?.stop();
  host = null;
  share?.stop();
  board?.destroy();
  board = null;
  adapter = null;
  video().srcObject = null;
  $('overText').textContent = message;
  show('over');
}

// ── Starting ─────────────────────────────────────────────────────────────────

/** Starts the session: a board, on which anybody can share a screen at any time. */
async function startSession(): Promise<void> {
  if (host) {
    return;
  }
  const problem = $('startProblem');
  problem.hidden = true;
  // `?tr=wss://...` (repeatable) replaces the trackers; the viewer link then carries them.
  const trackers = cleanTrackers(new URLSearchParams(location.search).getAll('tr'));
  settings = cleanSettings({
    ...prefs.settings,
    viewerBase: siteBase(),
    ...(trackers && trackers.length > 0 ? { trackers } : {}),
  });
  try {
    host = await ShareHost.start({
      settings,
      clearBoard: () => board?.clear(),
      clearDrawings: () => board?.clearDrawings(),
    });
  } catch (e) {
    problem.textContent = errorMessage(e instanceof SessionError ? e.reason : undefined);
    problem.hidden = false;
    return;
  }
  enterApp();
  void startBackup();
}

// ── Backup ───────────────────────────────────────────────────────────────────

/** Asks whether to resume the board in `info` or start a new one. */
function askResume(info: BackupInfo): Promise<'resume' | 'new'> {
  const dialog = $<HTMLDialogElement>('resume');
  const when = info.saved ? ` from ${info.saved.toLocaleString()}` : '';
  $('resumeText').textContent =
    `This browser kept a backup of an earlier board${when}, with ${info.items} ` +
    `item${info.items === 1 ? '' : 's'}. Resume it in this session, or start with an empty ` +
    'board? Starting new replaces the backup.';
  $('resumeDownload').onclick = () =>
    download(info.file, `inksplat-backup-${fileStamp(info.saved ?? new Date())}.inksplat.zip`);
  return new Promise((resolve) => {
    $('resumeYes').onclick = () => dialog.close('resume');
    $('resumeNo').onclick = () => dialog.close('new');
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'new' ? 'new' : 'resume'),
      { once: true },
    );
    dialog.returnValue = '';
    dialog.showModal();
  });
}

/**
 * Offers to resume the backup of an earlier board, if there is one, then keeps this session's
 * board in the backup a moment after every change.
 */
async function startBackup(): Promise<void> {
  const store = await backupStore;
  const b = board;
  const h = host;
  if (!store || !b || !h) {
    return;
  }
  let info: BackupInfo | null = null;
  try {
    info = await backupInfo(await store.read());
  } catch {
    info = null; // unreadable: treated as none, and replaced
  }
  if (info && (await askResume(info)) === 'resume' && board === b) {
    await openBoardFile(info.file, saveHost);
  }
  if (board !== b) {
    return; // the session ended meanwhile
  }
  let warned = false;
  const writer = new BackupWriter({
    store,
    make: () => boardArchive(b, h.stage()),
    onError: () => {
      if (!warned) {
        warned = true;
        toast('The board could not be backed up in this browser. Save it as a file to keep it.');
      }
    },
  });
  backup = writer;
  b.on('change', () => writer.schedule());
  h.onChange(() => writer.schedule()); // the backgrounds
  writer.schedule(); // the resumed board, or no backup for a new one
}

/** What the Save… and Open… buttons work on. */
const saveHost: SaveHost = {
  board: () => board,
  stage: () => host?.stage() ?? null,
  video: () => video(),
  toast,
  backgrounds: (names) =>
    names.forEach((name, page) => {
      if (name) {
        void host?.command({ cmd: 'background', page, name });
      }
    }),
};

// ── Settings and collapsing ──────────────────────────────────────────────────

const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);

function fillSettings(p: PresenterPrefs): void {
  const s = p.settings;
  input('name').value = s.name;
  input('color').value = s.color;
  input('viewersMayDraw').checked = s.viewersMayDraw;
  $<HTMLSelectElement>('cursor').value = p.cursor;
  input('fps').value = String(s.video.fps);
  input('maxWidth').value = String(s.video.maxWidth);
  input('maxHeight').value = String(s.video.maxHeight);
  input('bitrateKbps').value = String(s.video.bitrateKbps);
  showAvatar(s.avatar);
  input('trackerTtl').value = String(s.trackerTtlMinutes);
  $<HTMLTextAreaElement>('trackers').value = s.trackers.join('\n');
  $<HTMLTextAreaElement>('iceServers').value = formatIceLines(s.iceServers);
  showUplink();
}

/** The prefs as typed in the dialog, validated. */
function readSettings(): PresenterPrefs {
  return cleanPrefs({
    ...prefs,
    cursor: $<HTMLSelectElement>('cursor').value,
    settings: {
      name: input('name').value,
      color: input('color').value,
      avatar: avatarDraft,
      trackerTtlMinutes: input('trackerTtl').valueAsNumber,
      viewersMayDraw: input('viewersMayDraw').checked,
      video: {
        fps: input('fps').valueAsNumber,
        maxWidth: input('maxWidth').valueAsNumber,
        maxHeight: input('maxHeight').valueAsNumber,
        bitrateKbps: input('bitrateKbps').valueAsNumber,
      },
      trackers: cleanTrackers($<HTMLTextAreaElement>('trackers').value) ?? [],
      iceServers: parseIceLines($<HTMLTextAreaElement>('iceServers').value),
    },
  });
}

/** Shows the avatar chosen in the dialog (`''`: none). */
function showAvatar(data: string): void {
  avatarDraft = data;
  const img = $<HTMLImageElement>('avatarPreview');
  img.hidden = data === '';
  if (data) {
    img.src = data;
  } else {
    img.removeAttribute('src');
  }
  input('avatar').value = '';
}

function showUplink(): void {
  const kbps = uplinkKbps(10, readSettings().settings.video);
  const el = $('uplink');
  el.textContent = `With 10 viewers you upload about ${(kbps / 1000).toFixed(1)} Mbit/s (one stream per viewer).`;
  el.style.color = kbps > UPLINK_WARNING_KBPS ? '#b45309' : '';
}

function summary(): void {
  const { settings: s, cursor } = prefs;
  const pointer = { always: 'shown', motion: 'shown while it moves', never: 'hidden' }[cursor];
  $('summary').textContent =
    `${s.name}, ${s.video.fps} frames per second, mouse pointer ${pointer}.`;
}

/** Stores the dialog's prefs; the video limits reach a running share at once. */
function saveSettings(): void {
  prefs = readSettings();
  savePrefs(prefs);
  summary();
  if (host && settings) {
    settings = { ...settings, video: prefs.settings.video, avatar: prefs.settings.avatar };
    board?.setAvatar(prefs.settings.avatar);
    host.setVideo(settings.video);
    const own = share?.capture()?.size();
    if (own) {
      ownScale(own.width, own.height);
    }
    toast('Saved. Video changes apply now; the rest from the next session or share.');
  }
}

/** Folds the whiteboard toolbar away, or brings it back. */
function setToolsCollapsed(collapsed: boolean): void {
  prefs = { ...prefs, toolsCollapsed: collapsed };
  savePrefs(prefs);
  $('toolsToggle').setAttribute('aria-pressed', String(!collapsed));
  setToolbarFolded(board, collapsed);
}

function setPanelCollapsed(collapsed: boolean): void {
  prefs = { ...prefs, panelCollapsed: collapsed };
  savePrefs(prefs);
  $('panel').hidden = collapsed;
  $('panelToggle').setAttribute('aria-expanded', String(!collapsed));
}

function main(): void {
  summary();
  for (const event of ['loadedmetadata', 'resize']) {
    video().addEventListener(event, () => {
      layoutSheet();
      adapter?.update();
    });
  }
  show('start');
  share = wireShareButton({
    button: $<HTMLButtonElement>('share'),
    notice: $<HTMLDialogElement>('shareNotice'),
    cursor: () => prefs.cursor,
    toast,
    onStart: (c) => {
      const { width, height } = c.size();
      ownScale(width, height);
      host?.setOwnStream(c.stream, { surface: c.surface, w: width, h: height });
    },
    onResize: (width, height) => {
      const c = share?.capture();
      if (c) {
        ownScale(width, height);
        host?.setOwnStream(c.stream, { surface: c.surface, w: width, h: height });
      }
    },
    onStop: () => host?.setOwnStream(null),
  });

  $('startForm').addEventListener('submit', (e) => {
    e.preventDefault();
    void startSession();
  });
  $('screenHere').addEventListener(
    'click',
    () => void host?.command({ cmd: 'background', page: canvas(), name: 'screen' }),
  );
  $<HTMLSelectElement>('background').addEventListener(
    'change',
    (e) =>
      void host?.command({
        cmd: 'background',
        page: canvas(),
        name: (e.target as HTMLSelectElement).value,
      }),
  );
  $('again').addEventListener('click', () => {
    show('start');
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
  $('panelToggle').addEventListener('click', () => setPanelCollapsed(!prefs.panelCollapsed));
  $('panelClose').addEventListener('click', () => setPanelCollapsed(true));
  $('toolsToggle').addEventListener('click', () => setToolsCollapsed(!prefs.toolsCollapsed));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('#settings [role=tab]')];
  const selectTab = (tab: HTMLButtonElement, focus = false): void => {
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute('aria-selected', String(on));
      other.tabIndex = on ? 0 : -1;
      $(other.getAttribute('aria-controls') ?? '').hidden = !on;
    }
    if (focus) {
      tab.focus();
    }
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step !== 0) {
        e.preventDefault();
        selectTab(tabs[(i + step + tabs.length) % tabs.length]!, true);
      }
    });
  });
  const dialog = $<HTMLDialogElement>('settings');
  const openSettings = (): void => {
    fillSettings(prefs);
    selectTab(tabs[0]!);
    dialog.showModal();
  };
  $('openSettings').addEventListener('click', openSettings);
  $('settingsLive').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', () => dialog.close());
  $('resetSettings').addEventListener('click', () =>
    fillSettings({ ...prefs, ...cleanPrefs({ settings: DEFAULT_SETTINGS }) }),
  );
  input('avatar').addEventListener('change', () => {
    const file = input('avatar').files?.[0];
    if (file) {
      fileToImageData(file, { maxSide: 96, square: true, maxChars: LIMITS.avatarChars }).then(
        (picture) => showAvatar(picture.data),
        (e: unknown) => toast(e instanceof Error ? e.message : 'That picture cannot be used.'),
      );
    }
  });
  $('avatarClear').addEventListener('click', () => showAvatar(''));
  $('settingsForm').addEventListener('input', showUplink);
  $('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
    dialog.close();
  });
  const qrDialog = $<HTMLDialogElement>('qr');
  let qrCode: boolean[][] = [];
  $('showQr').addEventListener('click', () => {
    const link = host?.ui().link;
    if (!link) {
      return;
    }
    try {
      qrCode = qrModules(link);
    } catch {
      toast('This link is too long for a QR code. Copy it instead.');
      return;
    }
    $('qrCode').replaceChildren(qrSvg(qrCode));
    $('qrLink').textContent = link;
    qrDialog.showModal();
  });
  $('closeQr').addEventListener('click', () => qrDialog.close());
  wireSave(saveHost);
  // The resume question must be answered: Escape does not close it.
  $('resume').addEventListener('cancel', (e) => e.preventDefault());
  $('copyQr').addEventListener('click', () => {
    qrPng(qrCode)
      .then((png) => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]))
      .then(
        () => toast('QR code copied.'),
        () => toast('Could not copy the image: scan it from the screen instead.'),
      );
  });
  $('newLink').addEventListener('click', () => void host?.command({ cmd: 'newLink' }));
  $('copyLink').addEventListener('click', () => {
    const link = $<HTMLInputElement>('link');
    link.select();
    navigator.clipboard.writeText(link.value).then(
      () => toast('Link copied.'),
      () => toast('Copy the link from the box.'),
    );
  });
  $<HTMLInputElement>('drawing').addEventListener(
    'change',
    (e) => void host?.command({ cmd: 'drawing', on: (e.target as HTMLInputElement).checked }),
  );
  $<HTMLInputElement>('lock').addEventListener(
    'change',
    (e) => void host?.command({ cmd: 'lock', on: (e.target as HTMLInputElement).checked }),
  );
  $('clearDrawings').addEventListener('click', () => {
    if (
      confirm(
        'Remove the lines, texts and stickers for everyone? Notes, pins, threads and files stay.',
      )
    ) {
      void host?.command({ cmd: 'clearDrawings' });
    }
  });
  $('clear').addEventListener('click', () => {
    if (confirm('Clear everything on the board for everyone, notes and files too?')) {
      void host?.command({ cmd: 'clear' });
    }
  });
  $('end').addEventListener('click', () => {
    if (confirm('End the session for everyone?')) {
      endSession('You ended the session.');
    }
  });
  $('useCode').addEventListener('click', async () => {
    const say = (text: string): void => {
      $('codeStatus').textContent = text;
    };
    try {
      const answer = await host?.acceptCode($<HTMLTextAreaElement>('viewerCode').value);
      const out = $<HTMLTextAreaElement>('answerCode');
      out.value = answer ?? '';
      out.hidden = false;
      out.select();
      say('Send this answer back to the viewer.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'That code did not work.');
    }
  });
  backupStore = openBackupStore();
  // Closing or reloading the page ends the session: the browser asks first.
  window.addEventListener('beforeunload', (e) => {
    if (host) {
      void backup?.flush();
      e.preventDefault();
      e.returnValue = ''; // older browsers need it set
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void backup?.flush();
    }
  });
  // Viewers are told the session ended when the page closes.
  window.addEventListener('pagehide', () => {
    void backup?.flush();
    host?.stop();
  });
}

main();
