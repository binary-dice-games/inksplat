// MIT License © 2026 Binary Dice Games
/**
 * @file inksplat Support, the main process (spec/08_remote_support/DESIGN.md sections 4 and 4.1):
 * refuses debugging switches in a packaged build, keeps one instance, serves its own pages,
 * hardens every web contents and the session, registers the link scheme, and hands links to the
 * {@link Controller}.
 */
import { app, session as sessions } from 'electron';
import { userInfo } from 'node:os';
import { SUPPORT_SCHEME } from '@inksplat/defaults';
import { language } from '../shared/strings';
import { Controller } from './controller';
import { linkFromArgv } from './link';
import { registerScheme, serveApp } from './scheme';
import { loadStored } from './store';
import { forbiddenSwitches } from './switches';
import { checkForUpdates } from './updates';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: number;

const dev = !app.isPackaged;

// Another program must not drive a packaged app through debugging switches (DESIGN 7.3 R14).
if (!dev && forbiddenSwitches(process.argv).length > 0) {
  app.exit(1);
}

// A development run (the tests) keeps its data apart.
if (dev && process.env.INKSPLAT_SUPPORT_DATA) {
  app.setPath('userData', process.env.INKSPLAT_SUPPORT_DATA);
}

registerScheme();

let controller: Controller | null = null;
let pending: string | null = linkFromArgv(process.argv);

const open = (link: string | null): void => {
  if (!link) {
    return;
  }
  if (controller) {
    void controller.openLink(link);
  } else {
    pending = link;
  }
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // macOS hands links over this way, possibly before the app is ready.
  app.on('open-url', (e, url) => {
    e.preventDefault();
    open(url);
  });
  app.on('second-instance', (_e, argv) => {
    controller?.focus();
    open(linkFromArgv(argv));
  });

  // No window may open another, navigate away, or embed a web view (DESIGN 4.1).
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.on('will-redirect', (e) => e.preventDefault());
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    const dir = __dirname;
    serveApp(dir, dev);
    const ses = sessions.defaultSession;
    // Nothing is granted but the display capture, which the controller answers itself.
    ses.setPermissionRequestHandler((wc, permission, callback, details) =>
      callback(controller?.allowsPermission(wc, permission, details) ?? false),
    );
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    if (!dev) {
      // Windows reads the link after `--`, so it is never taken for a switch (DESIGN 7.3 R10).
      // macOS and Linux register the scheme from the installer.
      if (process.platform === 'win32') {
        app.setAsDefaultProtocolClient(SUPPORT_SCHEME, process.execPath, ['--']);
      }
      checkForUpdates();
    }
    const dataDir = app.getPath('userData');
    controller = new Controller({
      dir,
      dev,
      version: __APP_VERSION__,
      builtAt: __BUILD_DATE__,
      lang: language(app.getLocale()),
      dataDir,
      stored: loadStored(dataDir, safeUserName()),
    });
    if (dev) {
      // The tests reach the controller through Playwright's access to the main process.
      (globalThis as { __support?: Controller }).__support = controller;
    }
    const link = pending;
    pending = null;
    open(link);
  });
}

/** The person's login name, as the default name the helper sees. */
function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}
