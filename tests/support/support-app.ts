// MIT License © 2026 Binary Dice Games
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright-core';
import type { ElectronApplication, Page } from 'playwright-core';
import { buildSupportApp } from '../../support-app/scripts/build.mjs';

/**
 * inksplat Support (spec/08_remote_support) for the browser tests: built into a temporary folder,
 * launched by Playwright with an app link, on a display of its own (a private Xvfb on Linux when
 * there is none). The system's consent dialog cannot be clicked by automation, so the tests
 * replace `dialog.showMessageBox` in the main process with answers they choose.
 */
export class SupportApp {
  private constructor(
    readonly app: ElectronApplication,
    private readonly data: string,
  ) {}

  /** Launches the built app in `dir` with `link` after `--`, as the protocol handler would. */
  static async launch(dir: string, link: string, display: string | undefined): Promise<SupportApp> {
    const data = mkdtempSync(join(tmpdir(), 'inksplat-support-data-'));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'NODE_OPTIONS') env[k] = v;
    }
    const app = await _electron.launch({
      executablePath: electronPath(),
      // Chromium's sandbox needs privileges a CI container lacks; the app's own sandboxing of its
      // pages (contextIsolation, sandboxed preloads) is unchanged.
      args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        join(dir, 'main.js'),
        '--',
        link,
      ],
      env: {
        ...env,
        ...(display ? { DISPLAY: display } : {}),
        INKSPLAT_SUPPORT_DATA: data,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: 60000,
    });
    return new SupportApp(app, data);
  }

  /**
   * Answers the system's dialogs from now on: `answer(message)` gives the button index (0 is
   * Don't allow / Cancel / Stop). Each answer comes `delayMs` after the dialog opened (an answer
   * sooner than a second is a reflex the app asks again). The messages are in `dialogs()`.
   */
  async answerDialogs(answers: number[], delayMs = 1200): Promise<void> {
    await this.app.evaluate(
      ({ dialog }, [list, delay]) => {
        const g = globalThis as unknown as { __dialogs: string[]; __answers: number[] };
        g.__dialogs = [];
        g.__answers = [...list];
        dialog.showMessageBox = (async (...args: unknown[]) => {
          const options = (args.length > 1 ? args[1] : args[0]) as {
            message: string;
            detail?: string;
            signal?: AbortSignal;
          };
          g.__dialogs.push(`${options.message}\n${options.detail ?? ''}`);
          const answer = g.__answers.length > 0 ? g.__answers.shift()! : -1;
          if (answer < 0) {
            // No answer given: stays open until the app closes it.
            await new Promise<void>((resolve) =>
              options.signal?.addEventListener('abort', () => resolve(), { once: true }),
            );
            return { response: 0, checkboxChecked: false };
          }
          await new Promise((r) => setTimeout(r, delay));
          return { response: answer, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      },
      [answers, delayMs] as [number[], number],
    );
  }

  /** The messages of the dialogs shown so far. */
  dialogs(): Promise<string[]> {
    return this.app.evaluate(
      () => (globalThis as unknown as { __dialogs?: string[] }).__dialogs ?? [],
    );
  }

  /** The control window's page. */
  async control(): Promise<Page> {
    for (;;) {
      const page = this.app.windows().find((w) => w.url().endsWith('/control.html'));
      if (page) return page;
      await this.app.waitForEvent('window');
    }
  }

  /** The page of `name` (session.html, overlay.html), waiting for it. */
  async page(name: string, timeout = 30000): Promise<Page> {
    const end = Date.now() + timeout;
    for (;;) {
      const page = this.app.windows().find((w) => w.url().endsWith(`/${name}`));
      if (page) return page;
      if (Date.now() > end) throw new Error(`no ${name} window`);
      await this.app.waitForEvent('window', { timeout: Math.max(1, end - Date.now()) });
    }
  }

  /** What the control window shows now (its screen). */
  screen(): Promise<string | null> {
    return this.app.evaluate(
      () =>
        (
          globalThis as unknown as { __support?: { state(): { screen: string } } }
        ).__support?.state().screen ?? null,
    );
  }

  /** The primary display the app shares: its bounds (CSS pixels) and scale factor. */
  display(): Promise<{ x: number; y: number; width: number; height: number; scale: number }> {
    return this.app.evaluate(({ screen }) => {
      const d = screen.getPrimaryDisplay();
      return { ...d.bounds, scale: d.scaleFactor };
    });
  }

  /**
   * The width of the video the helper should get: the display in device pixels, reduced to the
   * support video's size limit (1920 on the long side by default) as the host asks.
   */
  async videoWidth(limit = 1920): Promise<number> {
    const d = await this.display();
    const w = Math.round(d.width * d.scale);
    const h = Math.round(d.height * d.scale);
    const scale = Math.max(1, w / limit, h / limit);
    return Math.round(w / scale);
  }

  /** Whether the session window and the overlay exist. */
  windows(): Promise<{ session: boolean; overlay: boolean }> {
    return this.app.evaluate(() => {
      const w = (
        globalThis as unknown as {
          __support: { windows(): { session: unknown; overlay: unknown } };
        }
      ).__support.windows();
      return { session: w.session !== null, overlay: w.overlay !== null };
    });
  }

  async close(): Promise<void> {
    await this.app.close().catch(() => {});
    rmSync(this.data, { recursive: true, force: true });
  }
}

/** Electron's executable from the `electron` package. */
export function electronPath(): string {
  const require = createRequire(import.meta.url);
  return require('electron') as unknown as string;
}

/** Builds the app into a fresh temporary folder; returns it and a function that removes it. */
export async function buildApp(): Promise<{ dir: string; remove: () => void }> {
  const work = mkdtempSync(join(tmpdir(), 'inksplat-support-app-'));
  await buildSupportApp(work);
  return { dir: work, remove: () => rmSync(work, { recursive: true, force: true }) };
}

/**
 * A display for Electron: the current one, or on Linux without one a private Xvfb (1280x800)
 * whose number Xvfb picks itself, so tests in parallel never share one.
 */
export async function display(): Promise<{ name: string | undefined; stop: () => void }> {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return { name: process.env.DISPLAY, stop: () => {} };
  }
  if (!['/usr/bin/Xvfb', '/usr/local/bin/Xvfb'].some((p) => existsSync(p))) {
    throw new Error('the support app tests need a display: install Xvfb or set DISPLAY');
  }
  const xvfb: ChildProcess = spawn(
    'Xvfb',
    ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] },
  );
  const number = await new Promise<string>((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Xvfb did not start')), 20000);
    xvfb.stdio[3]!.on('data', (d: Buffer) => {
      text += d.toString();
      if (text.includes('\n')) {
        clearTimeout(timer);
        resolve(text.trim());
      }
    });
    xvfb.on('exit', () => reject(new Error('Xvfb exited')));
  });
  return { name: `:${number}`, stop: () => xvfb.kill() };
}
