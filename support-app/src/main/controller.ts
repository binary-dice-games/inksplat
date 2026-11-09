// MIT License © 2026 Binary Dice Games
/**
 * @file The app's main process state machine (spec/08_remote_support/DESIGN.md sections 3.2, 4,
 * 5.4 and 7): it alone decides whether the screen may be captured. It opens a link, connects the
 * session window, explains, asks with the system's own dialog (which no window of the app can
 * click), lets the session window capture the chosen display once, shows the overlay and the
 * bar, and stops on Stop, a closed or hidden window, a screen lock, sleep, an hour without
 * confirmation, a lost link that does not come back, or a reconnect to another host. Stopping
 * destroys the session window, so the capture ends whatever its page does.
 */
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  desktopCapturer,
  dialog,
  ipcMain,
  powerMonitor,
  screen as screens,
  session as sessions,
  shell,
  systemPreferences,
} from 'electron';
import type {
  Display,
  DisplayMediaRequestHandlerHandlerRequest,
  IpcMainEvent,
  MediaAccessPermissionRequest,
  MessageBoxOptions,
  PermissionRequest,
  Streams,
  WebContents,
  WebFrameMain,
} from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { parseSupportUrl, safetyCode, supportAppUrl } from '@inksplat/defaults';
import type { Invite } from '@inksplat/defaults';
import { IPC, cleanControlAction, cleanSessionReport } from '../shared/protocol';
import type {
  ControlAction,
  ControlState,
  Screen,
  SessionCommand,
  SessionReport,
} from '../shared/protocol';
import { fill, t } from '../shared/strings';
import type { StringKey } from '../shared/strings';
import { RefusalLimiter, TIMING, isReflex, isSameHost, isTooOld } from './consent';
import { barBounds, clampInto, inside, nextDisplay, sourceFor } from './displays';
import { ORIGIN, servedName } from './pages';
import { saveStored } from './store';
import type { Stored } from './store';

/** Where the person downloads a new version. */
const DOWNLOAD_URL = 'https://github.com/binary-dice-games/inksplat/releases/latest';
/** The macOS settings page of screen recording. */
const MAC_SCREEN_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * How long the session window has to leave the session cleanly (so the helper sees it go at
 * once) before it is destroyed whatever its page does. Its capture stops at the leave command.
 */
const LEAVE_MS = 250;

/** How long the overlay may take to load before sharing stops. */
const OVERLAY_MS = 5000;

/** The screens while a session is running (something is connected or shared). */
const ACTIVE: ReadonlySet<Screen> = new Set([
  'connecting',
  'explain',
  'asking',
  'sharing',
  'reconnecting',
]);

const CONTROL_SIZE = { width: 520, height: 600 };
/** The bar's content area (the window's frame and title bar come on top of it). */
const BAR_SIZE = { width: 460, height: 104 };

export interface ControllerOptions {
  /** The folder of the built pages and preloads. */
  dir: string;
  /** A development run (not packaged): DevTools, and the tests' loopback tracker. */
  dev: boolean;
  version: string;
  /** When this build was made (ms since 1970), for the age check. */
  builtAt: number;
  lang: 'en' | 'es';
  /** Where settings are kept. */
  dataDir: string;
  stored: Stored;
  now?: () => number;
}

export class Controller {
  private screen: Screen = 'idle';
  private invite: Invite | null = null;
  /** One peer id per link, so a reconnect or Share again is the same person to the host. */
  private peerId = '';
  private helper: { id: string; name: string; color: string } | null = null;
  private code: string | null = null;
  /** The host's fingerprint of the last `host` report, and the one consented to. */
  private hostPrint: string | null = null;
  private pinned: string | null = null;
  private reason: string | null = null;
  private notice: string | null = null;
  private readonly control: BrowserWindow;
  private session: BrowserWindow | null = null;
  private overlay: BrowserWindow | null = null;
  private display: Display | null = null;
  /** The session window may capture once: set on Allow and on a display switch. */
  private captureGrant = false;
  private explainTimer: ReturnType<typeof setTimeout> | undefined;
  private checkTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Closes an open consent or confirmation dialog when the session goes. */
  private dialogAbort: AbortController | null = null;
  private readonly limiter: RefusalLimiter;
  private readonly now: () => number;
  /** Windows being destroyed on purpose: their `closed` events are not a watchdog stop. */
  private tearingDown = false;
  private quitting = false;

  constructor(private readonly options: ControllerOptions) {
    this.now = options.now ?? Date.now;
    this.limiter = new RefusalLimiter(this.now);
    this.control = this.createControl();
    ipcMain.on(IPC.report, (e, m) => this.fromSession(e, m));
    ipcMain.on(IPC.action, (e, m) => this.fromControl(e, m));
    sessions.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => void this.answerCapture(request, callback),
      { useSystemPicker: false },
    );
    powerMonitor.on('lock-screen', () => this.stop('locked'));
    powerMonitor.on('suspend', () => this.stop('locked'));
    screens.on('display-removed', (_e, d) => {
      if (this.display && d.id === this.display.id) {
        this.stop('window');
      }
    });
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }

  // ── Links ────────────────────────────────────────────────────────────────

  /** A link was opened (start, second instance, macOS `open-url`). */
  async openLink(url: string): Promise<void> {
    const invite = parseSupportUrl(url);
    const active = ACTIVE.has(this.screen);
    if (!invite) {
      if (!active) {
        this.show('bad-link');
      }
      return;
    }
    if (this.limiter.blocked()) {
      if (!active) {
        this.show('blocked');
      }
      return;
    }
    if (this.screen === 'explain' || this.screen === 'asking') {
      this.flash('busy'); // a link while a question is open is ignored
      return;
    }
    if (active) {
      const yes = await this.confirm('newLinkMessage', 'endAndConnect');
      if (!yes) {
        return;
      }
      this.teardown();
    }
    if (isTooOld(this.options.builtAt, this.now())) {
      this.show('update');
      return;
    }
    if (invite.token !== this.invite?.token) {
      this.peerId = randomBytes(9).toString('base64url');
    }
    this.invite = invite;
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status === 'denied' || status === 'restricted') {
        this.show('mac-permission');
        return;
      }
    }
    this.connect();
  }

  /** Brings the control window to the front (a second instance was started). */
  focus(): void {
    if (this.control.isMinimized()) {
      this.control.restore();
    }
    this.control.show();
    this.control.focus();
  }

  // ── The session ──────────────────────────────────────────────────────────

  private connect(): void {
    this.helper = null;
    this.code = null;
    this.hostPrint = null;
    this.pinned = null;
    this.reason = null;
    this.show('connecting');
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(this.options.dir, 'preload-session.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: this.options.dev,
      },
    });
    this.session = win;
    win.webContents.on('render-process-gone', () => this.stop('window'));
    win.on('closed', () => {
      if (this.session === win) {
        this.session = null;
        if (!this.tearingDown) {
          this.stop('window');
        }
      }
    });
    void win.loadURL(`${ORIGIN}/session.html`);
  }

  private send(command: SessionCommand): void {
    this.session?.webContents.send(IPC.command, command);
  }

  /** A report of the session window (only from it, only well formed). */
  private fromSession(e: IpcMainEvent, message: unknown): void {
    if (
      !this.session ||
      e.sender !== this.session.webContents ||
      !isPage(e.senderFrame, 'session.html')
    ) {
      return;
    }
    const report = cleanSessionReport(message);
    if (report) {
      void this.onReport(report);
    }
  }

  private async onReport(r: SessionReport): Promise<void> {
    switch (r.t) {
      case 'ready':
        if (this.invite && this.screen === 'connecting') {
          this.send({
            t: 'join',
            token: this.invite.token,
            trackers: this.invite.trackers ?? [],
            peerId: this.peerId,
            name: this.options.stored.name,
            version: this.options.version,
          });
        }
        return;
      case 'host':
        if (this.screen === 'connecting') {
          this.helper = { id: r.id, name: r.name, color: r.color };
          this.hostPrint = r.remote;
          const code = await safetyCode(r.local, r.remote);
          if (this.screen !== 'connecting') {
            return;
          }
          this.code = code;
          this.show('explain');
          this.explainTimer = setTimeout(() => void this.ask(), TIMING.explainMs);
        } else if (this.screen === 'reconnecting') {
          if (isSameHost(this.pinned, r.remote)) {
            clearTimeout(this.reconnectTimer);
            this.show('sharing');
            this.send({ t: 'resume' });
          } else {
            this.stop('other-host');
          }
        }
        return;
      case 'state':
        if (r.state === 'reconnecting') {
          if (this.screen === 'sharing') {
            this.show('reconnecting');
            this.reconnectTimer = setTimeout(() => this.stop('lost'), TIMING.reconnectMs);
          } else if (ACTIVE.has(this.screen) && this.screen !== 'reconnecting') {
            this.end('lost');
          }
        } else if (ACTIVE.has(this.screen)) {
          this.end(r.reason);
        }
        return;
      case 'captured':
        return;
      case 'capture-failed':
        if (
          process.platform === 'darwin' &&
          systemPreferences.getMediaAccessStatus('screen') !== 'granted'
        ) {
          this.teardown();
          this.show('mac-permission');
          return;
        }
        this.stop('capture-failed');
        return;
    }
  }

  // ── Consent ──────────────────────────────────────────────────────────────

  /** Asks with the system's dialog; an Allow too quick to be read is asked again. */
  private async ask(): Promise<void> {
    if (this.screen !== 'explain' || !this.helper || !this.code) {
      return;
    }
    this.show('asking');
    const lang = this.options.lang;
    const values = { name: this.helper.name || '?', code: this.code };
    for (;;) {
      const abort = new AbortController();
      this.dialogAbort = abort;
      const shownAt = this.now();
      const options: MessageBoxOptions = {
        type: 'question',
        title: t(lang, 'dialogTitle'),
        message: fill(t(lang, 'dialogMessage'), values),
        detail: fill(t(lang, 'dialogDetail'), values),
        buttons: [t(lang, 'dontAllow'), t(lang, 'allow')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: abort.signal,
      };
      const { response } = await dialog.showMessageBox(this.control, options);
      this.dialogAbort = null;
      if (this.current() !== 'asking' || abort.signal.aborted) {
        return; // the session went meanwhile
      }
      if (response === 1 && isReflex(shownAt, this.now())) {
        continue;
      }
      if (response === 1) {
        this.allow();
      } else {
        this.deny();
      }
      return;
    }
  }

  private allow(): void {
    this.pinned = this.hostPrint;
    this.display = screens.getDisplayMatching(this.control.getBounds());
    this.captureGrant = true;
    this.screen = 'sharing';
    this.createOverlay(this.display);
    this.barMode(this.display);
    this.send({ t: 'capture' });
    this.checkTimer = setTimeout(() => void this.check(), TIMING.checkMs);
    this.push();
  }

  private deny(): void {
    const blocked = this.limiter.refused();
    this.teardown();
    this.show(blocked ? 'blocked' : 'denied');
  }

  /** After an hour: "Keep sharing?", which stops by itself after a minute. */
  private async check(): Promise<void> {
    if (this.screen !== 'sharing' && this.screen !== 'reconnecting') {
      return;
    }
    const lang = this.options.lang;
    const abort = new AbortController();
    this.dialogAbort = abort;
    const timer = setTimeout(() => abort.abort(), TIMING.answerMs);
    const { response } = await dialog.showMessageBox(this.control, {
      type: 'question',
      title: t(lang, 'keepTitle'),
      message: fill(t(lang, 'keepMessage'), { name: this.helper?.name }),
      detail: t(lang, 'keepDetail'),
      buttons: [t(lang, 'stop'), t(lang, 'keep')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal: abort.signal,
    });
    clearTimeout(timer);
    this.dialogAbort = null;
    if (this.screen !== 'sharing' && this.screen !== 'reconnecting') {
      return;
    }
    if (response === 1 && !abort.signal.aborted) {
      this.checkTimer = setTimeout(() => void this.check(), TIMING.checkMs);
    } else {
      this.stop('timeout');
    }
  }

  /** A yes/no question with the system's dialog. */
  private async confirm(message: StringKey, yes: StringKey): Promise<boolean> {
    const lang = this.options.lang;
    const { response } = await dialog.showMessageBox(this.control, {
      type: 'question',
      message: fill(t(lang, message), { name: this.helper?.name }),
      buttons: [t(lang, 'cancel'), t(lang, yes)],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response === 1;
  }

  // ── Capture ──────────────────────────────────────────────────────────────

  /**
   * The display request handler: answered only for the session window's page, only while
   * sharing and once per grant, video only, with the chosen display. Anything else is refused.
   */
  private async answerCapture(
    request: DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Streams) => void,
  ): Promise<void> {
    const main = this.session?.webContents.mainFrame;
    const frame = request.frame;
    const ok =
      this.captureGrant &&
      this.screen === 'sharing' &&
      this.display !== null &&
      main !== undefined &&
      frame !== null &&
      frame.processId === main.processId &&
      frame.routingId === main.routingId &&
      isPage(frame, 'session.html');
    if (!ok) {
      callback({});
      return;
    }
    this.captureGrant = false;
    const display = this.display!;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    const source = sourceFor(display, screens.getAllDisplays(), sources);
    if (!source || this.screen !== 'sharing') {
      callback({});
      return;
    }
    callback({ video: source });
  }

  /**
   * The permission request handler: only the `media` permission that a display capture asks
   * for, only from the session window's page, only while a capture is granted, video only.
   * Camera, microphone and everything else are refused.
   */
  allowsPermission(
    wc: WebContents | null,
    permission: string,
    details: PermissionRequest | MediaAccessPermissionRequest,
  ): boolean {
    const media = details as MediaAccessPermissionRequest;
    return (
      permission === 'media' &&
      this.captureGrant &&
      this.screen === 'sharing' &&
      wc !== null &&
      wc === this.session?.webContents &&
      servedName(media.requestingUrl ?? '') === 'session.html' &&
      !(media.mediaTypes ?? []).includes('audio')
    );
  }

  // ── Windows ──────────────────────────────────────────────────────────────

  private createControl(): BrowserWindow {
    const win = new BrowserWindow({
      ...CONTROL_SIZE,
      show: false,
      title: t(this.options.lang, 'title'),
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(this.options.dir, 'preload-control.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        devTools: this.options.dev,
      },
    });
    win.removeMenu();
    win.once('ready-to-show', () => win.show());
    win.webContents.on('did-finish-load', () => this.push());
    // Closing the bar while sharing stops; closing the window otherwise quits.
    win.on('close', (e) => {
      if (ACTIVE.has(this.screen) && !this.quitting) {
        e.preventDefault();
        this.stop('stopped');
      }
    });
    // The bar must stay seen while sharing: hiding or minimizing it stops.
    for (const event of ['hide', 'minimize'] as const) {
      win.on(event as 'hide', () => {
        if (this.screen === 'sharing' || this.screen === 'reconnecting') {
          this.stop('window');
          win.restore();
          win.show();
        }
      });
    }
    win.on('moved', () => {
      if (this.display && (this.screen === 'sharing' || this.screen === 'reconnecting')) {
        const area = this.display.workArea;
        const b = win.getBounds();
        if (!inside(b, area)) {
          win.setBounds(clampInto(b, area));
        }
      }
    });
    win.webContents.on('render-process-gone', () => {
      this.stop('window');
      void win.loadURL(`${ORIGIN}/control.html`);
    });
    void win.loadURL(`${ORIGIN}/control.html`);
    return win;
  }

  /** The transparent, click-through overlay over `display`, and its port to the session window. */
  private createOverlay(display: Display): void {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(this.options.dir, 'preload-overlay.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: this.options.dev,
      },
    });
    this.overlay = win;
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const gone = (): void => {
      if (this.overlay === win && !this.tearingDown) {
        this.stop('window');
      }
    };
    win.on('closed', () => {
      gone();
      if (this.overlay === win) {
        this.overlay = null;
      }
    });
    win.on('hide', gone);
    win.webContents.on('render-process-gone', gone);
    // The border must be seen while sharing (I2): an overlay that is not up in time stops it.
    const late = setTimeout(gone, OVERLAY_MS);
    win.on('closed', () => clearTimeout(late));
    win.webContents.once('did-finish-load', () => {
      clearTimeout(late);
      if (this.overlay !== win || !this.session) {
        return;
      }
      const { port1, port2 } = new MessageChannelMain();
      this.session.webContents.postMessage(IPC.port, null, [port1]);
      win.webContents.postMessage(IPC.port, null, [port2]);
      win.showInactive();
      // Windows fits a new window into the work area, leaving the taskbar uncovered: the whole
      // display once more, now that the window is up.
      win.setBounds((this.display ?? display).bounds);
    });
    void win.loadURL(`${ORIGIN}/overlay.html`);
  }

  /** The control window as the small bar over the overlay, in a corner of `display`. */
  private barMode(display: Display): void {
    const w = this.control;
    if (w.isFullScreen()) {
      w.setFullScreen(false);
    }
    w.setMinimizable(false);
    w.setMaximizable(false);
    w.setResizable(false);
    w.setFullScreenable(false);
    // Sized by its content, so a title bar (Windows, macOS) does not eat into the buttons, then
    // put in the corner with its frame.
    w.setContentSize(BAR_SIZE.width, BAR_SIZE.height);
    const outer = w.getBounds();
    w.setBounds(barBounds(display.workArea, { width: outer.width, height: outer.height }));
    w.setAlwaysOnTop(true, 'screen-saver', 1); // above the overlay
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.show();
  }

  private normalMode(): void {
    const w = this.control;
    if (w.isDestroyed()) {
      return;
    }
    w.setAlwaysOnTop(false);
    w.setVisibleOnAllWorkspaces(false);
    w.setResizable(true);
    w.setMinimizable(true);
    w.setMaximizable(true);
    const area = screens.getDisplayMatching(w.getBounds()).workArea;
    w.setBounds(
      clampInto(
        {
          x: area.x + Math.round((area.width - CONTROL_SIZE.width) / 2),
          y: area.y + Math.round((area.height - CONTROL_SIZE.height) / 2),
          ...CONTROL_SIZE,
        },
        area,
      ),
    );
  }

  // ── Stopping ─────────────────────────────────────────────────────────────

  /** Stops sharing (and the connection) for `reason`; nothing happens when nothing runs. */
  stop(reason: string): void {
    if (!ACTIVE.has(this.screen)) {
      return;
    }
    this.teardown();
    this.reason = reason;
    this.show('stopped');
  }

  /** The session ended from the other side, or never got going. */
  private end(reason: string): void {
    this.teardown();
    this.reason = reason;
    this.show('ended');
  }

  /** Destroys the overlay and the session window (ending any capture), and every timer. */
  private teardown(): void {
    this.tearingDown = true;
    try {
      clearTimeout(this.explainTimer);
      clearTimeout(this.checkTimer);
      clearTimeout(this.reconnectTimer);
      this.dialogAbort?.abort();
      this.dialogAbort = null;
      this.captureGrant = false;
      this.display = null;
      const overlay = this.overlay;
      const session = this.session;
      this.overlay = null;
      this.session = null;
      overlay?.destroy();
      if (session && !session.isDestroyed()) {
        // The page stops its capture and says goodbye; the window goes a moment later anyway.
        session.webContents.send(IPC.command, { t: 'leave' } satisfies SessionCommand);
        setTimeout(() => {
          if (!session.isDestroyed()) {
            session.destroy();
          }
        }, LEAVE_MS);
      }
      this.normalMode();
    } finally {
      this.tearingDown = false;
    }
  }

  // ── The control window ───────────────────────────────────────────────────

  /** An action of the control window (only from it, only well formed). */
  private fromControl(e: IpcMainEvent, message: unknown): void {
    if (e.sender !== this.control.webContents || !isPage(e.senderFrame, 'control.html')) {
      return;
    }
    const action = cleanControlAction(message);
    if (action) {
      void this.onAction(action);
    }
  }

  private async onAction(a: ControlAction): Promise<void> {
    switch (a.t) {
      case 'stop':
        this.stop('stopped');
        return;
      case 'shareAgain':
        if ((this.screen === 'stopped' || this.screen === 'ended') && this.invite) {
          this.connect();
        }
        return;
      case 'close':
        this.quitting = true;
        this.teardown();
        app.quit();
        return;
      case 'nextDisplay':
        await this.switchDisplay();
        return;
      case 'openScreenSettings':
        if (process.platform === 'darwin') {
          void shell.openExternal(MAC_SCREEN_SETTINGS);
        }
        return;
      case 'relaunch':
        if (this.screen === 'mac-permission' && this.invite) {
          const head = this.options.dev ? process.argv.slice(1, 2) : [];
          app.relaunch({ args: [...head, '--', supportAppUrl(this.invite)] });
          app.exit(0);
        }
        return;
      case 'download':
        void shell.openExternal(DOWNLOAD_URL);
        return;
      case 'setName':
        this.options.stored.name = a.name;
        saveStored(this.options.dataDir, this.options.stored);
        this.send({ t: 'name', name: a.name });
        this.push();
        return;
    }
  }

  /** "Show my other screen": asked with the system's dialog, then captured once more. */
  private async switchDisplay(): Promise<void> {
    const all = screens.getAllDisplays();
    if (this.screen !== 'sharing' || !this.display || all.length < 2) {
      return;
    }
    if (!(await this.confirm('nextDisplayMessage', 'showIt')) || this.screen !== 'sharing') {
      return;
    }
    const next = nextDisplay(this.display, all);
    this.display = next as Display;
    this.overlay?.setBounds(next.bounds);
    this.barMode(this.display);
    this.captureGrant = true;
    this.send({ t: 'recapture' });
  }

  /** The screen now (read again after an await: it may have changed meanwhile). */
  private current(): Screen {
    return this.screen;
  }

  private show(screen: Screen): void {
    this.screen = screen;
    this.push();
  }

  /** A notice for a few seconds (a key of the strings). */
  private flash(notice: string): void {
    this.notice = notice;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.push();
    }, 5000);
    this.push();
  }

  /** What the control window shows. */
  state(): ControlState {
    return {
      screen: this.screen,
      lang: this.options.lang,
      name: this.options.stored.name,
      helper: this.helper ? { name: this.helper.name, color: this.helper.color } : null,
      code: this.code,
      reason: this.reason,
      otherDisplay: screens.getAllDisplays().length > 1,
      notice: this.notice,
      version: this.options.version,
    };
  }

  private push(): void {
    if (!this.control.isDestroyed()) {
      this.control.webContents.send(IPC.state, this.state());
    }
  }

  /** For the tests of a development build: the windows, by role. */
  windows(): {
    control: BrowserWindow;
    session: BrowserWindow | null;
    overlay: BrowserWindow | null;
  } {
    return { control: this.control, session: this.session, overlay: this.overlay };
  }
}

/** Whether `frame` is the top frame of the app's page `name`. */
function isPage(frame: WebFrameMain | null | undefined, name: string): boolean {
  return !!frame && frame.parent === null && servedName(frame.url) === name;
}
