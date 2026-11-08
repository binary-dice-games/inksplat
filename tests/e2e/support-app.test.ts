// MIT License © 2026 Binary Dice Games
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { parseInvite, supportAppUrl } from '@inksplat/defaults';
import { PresenterSite, configure } from '../support/presenter-site';
import { SupportApp, buildApp, display } from '../support/support-app';

// inksplat Support (spec/08_remote_support, plan steps 4 and 5): the helper starts a support
// session on the built presenter page (Chrome), the app opens the link (Electron, on a display of
// its own), asks with the system's dialog (answered by the test), shares the display, and draws
// the helper's marks on its overlay.

let site: PresenterSite;
let built: { dir: string; remove: () => void };
let screen: { name: string | undefined; stop: () => void };
const apps: SupportApp[] = [];

beforeAll(async () => {
  [site, built, screen] = await Promise.all([PresenterSite.start(), buildApp(), display()]);
}, 180000);
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});
afterAll(async () => {
  await site?.close();
  built?.remove();
  screen?.stop();
});

/** The helper's page with a support session started; returns it and the app link. */
async function helper(): Promise<{ page: Page; appUrl: string }> {
  const page = await site.presenterPage();
  await configure(page);
  await page.locator('#startSupport').click();
  await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
  await expect.poll(() => page.locator('#link').inputValue()).toMatch(/support\.html#inksplat=/);
  const link = await page.locator('#link').inputValue();
  const invite = parseInvite(new URL(link).hash)!;
  return { page, appUrl: supportAppUrl(invite) };
}

async function launch(appUrl: string, answers: number[] = []): Promise<SupportApp> {
  const app = await SupportApp.launch(built.dir, appUrl, screen.name);
  apps.push(app);
  await app.answerDialogs(answers);
  return app;
}

const status = (page: Page) => page.locator('#supportStatus').textContent();
const videoWidth = (page: Page) =>
  page.evaluate(() => (document.getElementById('video') as HTMLVideoElement).videoWidth);

describe('inksplat Support', () => {
  it('connects, shows the same safety code at both ends, and shares only after Allow', async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [1]);
    await expect.poll(() => status(page), { timeout: 30000 }).toMatch(/deciding/);
    await expect.poll(() => page.locator('#supportCode').textContent()).toMatch(/^\d{3} \d{3}$/);
    const code = await page.locator('#supportCode').textContent();
    const control = await app.control();
    await expect.poll(() => control.locator('.code').textContent(), { timeout: 10000 }).toBe(code);
    // Nothing is shared while the person reads and decides.
    expect(await videoWidth(page)).toBe(0);
    await expect
      .poll(
        () =>
          app.app.evaluate(() => {
            const s = (
              globalThis as unknown as {
                __support: { state(): { screen: string; reason: string } };
              }
            ).__support.state();
            return `${s.screen}:${s.reason}`;
          }),
        { timeout: 15000 },
      )
      .toBe('sharing:null');
    const dialogs = await app.dialogs();
    expect(dialogs[0]).toContain('Pat');
    expect(dialogs[0]).toContain(code!);
    await expect.poll(() => status(page), { timeout: 30000 }).toMatch(/see .*screen/);
    await expect.poll(() => videoWidth(page), { timeout: 30000 }).toBe(1280);
    // The frame is the person's display.
    expect(await page.evaluate(() => document.querySelector('#link') !== null)).toBe(true);
    expect(await app.windows()).toEqual({ session: true, overlay: true });
  });

  it("draws the helper's cursor, pings and laser on the person's screen, where the helper put them", async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [1]);
    await expect.poll(() => videoWidth(page), { timeout: 40000 }).toBe(1280);
    const overlay = await app.page('overlay.html');
    const windows = await app.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().endsWith('/overlay.html'))
        .map((w) => ({ focusable: w.isFocusable(), top: w.isAlwaysOnTop(), ...w.getBounds() })),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ focusable: false, top: true, x: 0, y: 0 });
    // The whole display (X11 without a window manager may leave a pixel off).
    expect(Math.abs(windows[0]!.width - 1280)).toBeLessThanOrEqual(2);
    expect(Math.abs(windows[0]!.height - 800)).toBeLessThanOrEqual(2);

    // The helper takes the laser (the pointer's key twice) and clicks the middle of the frame.
    const stage = (await page.locator('#stage').boundingBox())!;
    const mid = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    await page.mouse.move(mid.x - 50, mid.y - 50);
    await page.keyboard.press('1');
    await page.keyboard.press('1');
    await page.mouse.move(mid.x, mid.y);
    await expect
      .poll(() => overlay.locator('.cursor').count(), { timeout: 10000 })
      .toBeGreaterThan(0);
    expect(await overlay.locator('.cursor').first().textContent()).toContain('Pat');
    await page.mouse.down();
    await page.mouse.up();
    // A ping, at the middle of the person's display (1280x800).
    const centre = await overlay.waitForFunction(
      () => {
        const wb = document.querySelector('collab-whiteboard');
        const c = wb?.shadowRoot?.querySelector('.ping circle');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      undefined,
      { timeout: 10000, polling: 20 },
    );
    const at = (await centre.jsonValue())!;
    expect(Math.abs(at.x - 640)).toBeLessThan(3);
    expect(Math.abs(at.y - 400)).toBeLessThan(3);
    // The helper's own board does not draw it: it comes back in the video.
    expect(await page.locator('.ping').count()).toBe(0);

    // A laser trail.
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(mid.x + i * 12, mid.y + i * 6);
    }
    await page.mouse.up();
    await expect
      .poll(() => overlay.locator('.laser-trail path').count(), { timeout: 10000 })
      .toBeGreaterThan(0);
    expect(await page.locator('.laser-trail').count()).toBe(0);
  });

  it('stops on Stop (the connection too), and asks again before sharing again', async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [1, 1]);
    await expect.poll(() => videoWidth(page), { timeout: 40000 }).toBe(1280);
    const control = await app.control();
    await control.locator('button[data-action=stop]').click();
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('stopped');
    expect(await app.windows()).toEqual({ session: false, overlay: false });
    await expect.poll(() => status(page), { timeout: 15000 }).toMatch(/stopped sharing/);

    await control.locator('button[data-action=shareAgain]').click();
    await expect.poll(() => app.screen(), { timeout: 30000 }).toBe('sharing');
    expect(await app.dialogs()).toHaveLength(2);
    await expect.poll(() => status(page), { timeout: 30000 }).toMatch(/see .*screen/);
  });

  it('shares nothing when the person says no, and pauses links after three refusals', async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [0, 0, 0]);
    await expect.poll(() => app.screen(), { timeout: 30000 }).toBe('denied');
    expect(await app.windows()).toEqual({ session: false, overlay: false });
    await expect.poll(() => status(page), { timeout: 15000 }).toMatch(/Waiting for the person/);
    expect(await videoWidth(page)).toBe(0);
    const openLink = () =>
      app.app.evaluate(
        (_e, url) =>
          (
            globalThis as unknown as { __support: { openLink(u: string): Promise<void> } }
          ).__support.openLink(url),
        appUrl,
      );
    await openLink();
    await expect.poll(() => app.screen(), { timeout: 30000 }).toBe('denied');
    await openLink();
    await expect.poll(() => app.screen(), { timeout: 30000 }).toBe('blocked');
    await openLink(); // ignored: no connection, no question
    expect(await app.screen()).toBe('blocked');
    expect(await app.dialogs()).toHaveLength(3);
    expect(await app.windows()).toEqual({ session: false, overlay: false });
  });

  it('asks again when Allow comes too quick to have been read', async () => {
    const { appUrl } = await helper();
    const app = await SupportApp.launch(built.dir, appUrl, screen.name);
    apps.push(app);
    await app.answerDialogs([1, 1], 100);
    await expect.poll(() => app.dialogs(), { timeout: 30000 }).toHaveLength(3);
    expect(await app.screen()).toBe('asking');
    expect(await app.windows()).toEqual({ session: true, overlay: false });
  });

  it('stops when a window of the app goes, the screen locks, or the link comes back from someone else', async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [1, 1, 1, 1]);
    const control = await app.control();
    const sharing = async () => {
      await expect.poll(() => app.screen(), { timeout: 40000 }).toBe('sharing');
      await expect
        .poll(() => app.windows(), { timeout: 10000 })
        .toEqual({ session: true, overlay: true });
      // The overlay's page has loaded (a window closed while it loads ignores the close).
      const overlay = await app.page('overlay.html');
      await overlay.waitForFunction(() => document.querySelector('collab-whiteboard') !== null);
    };
    const reason = () =>
      app.app.evaluate(
        () =>
          (
            globalThis as unknown as { __support: { state(): { reason: string } } }
          ).__support.state().reason,
      );
    await sharing();
    // The overlay closes: the capture stops with it.
    // Closed after the call returns: Playwright's call can hang on a window closing under it.
    await app.app.evaluate(({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/overlay.html'),
      );
      setTimeout(() => overlay?.close(), 100);
    });
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('stopped');
    expect(await reason()).toBe('window');
    expect(await app.windows()).toEqual({ session: false, overlay: false });

    // The screen locks.
    await control.locator('button[data-action=shareAgain]').click();
    await sharing();
    await app.app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('stopped');
    expect(await reason()).toBe('locked');

    // A lost link comes back from the same host: sharing goes on without asking.
    await control.locator('button[data-action=shareAgain]').click();
    await sharing();
    const session = await app.page('session.html');
    const pinned = await app.app.evaluate(
      () => (globalThis as unknown as { __support: { pinned: string } }).__support.pinned,
    );
    const report = (r: unknown) =>
      session.evaluate(
        (m) => (window as unknown as { support: { report(x: unknown): void } }).support.report(m),
        r,
      );
    const local = Array.from({ length: 32 }, () => '0A').join(':');
    await report({ t: 'state', state: 'reconnecting', reason: 'lost' });
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('reconnecting');
    await report({
      t: 'host',
      id: 'host-0001',
      name: 'Pat',
      color: '#000000',
      local,
      remote: pinned,
    });
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('sharing');
    // ...and from another host: it stops.
    await report({ t: 'state', state: 'reconnecting', reason: 'lost' });
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('reconnecting');
    const other = Array.from({ length: 32 }, () => 'FF').join(':');
    await report({
      t: 'host',
      id: 'host-0001',
      name: 'Pat',
      color: '#000000',
      local,
      remote: other,
    });
    await expect.poll(() => app.screen(), { timeout: 10000 }).toBe('stopped');
    expect(await reason()).toBe('other-host');
    expect(await app.dialogs()).toHaveLength(3);
    await expect.poll(() => status(page), { timeout: 15000 }).toMatch(/stopped sharing/);
  });

  it('refuses any other capture or device, and keeps its pages away from Node and the web', async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [1]);
    await expect.poll(() => videoWidth(page), { timeout: 40000 }).toBe(1280);
    const session = await app.page('session.html');
    const control = await app.control();
    const tryMedia = (p: Page) =>
      p.evaluate(async () => {
        const out: string[] = [];
        const attempt = async (name: string, f: () => Promise<MediaStream>) => {
          try {
            const s = await f();
            s.getTracks().forEach((t) => t.stop());
            out.push(`${name}:granted`);
          } catch {
            out.push(`${name}:refused`);
          }
        };
        await attempt('display', () => navigator.mediaDevices.getDisplayMedia({ video: true }));
        await attempt('camera', () => navigator.mediaDevices.getUserMedia({ video: true }));
        await attempt('microphone', () => navigator.mediaDevices.getUserMedia({ audio: true }));
        return out;
      });
    // The capture was granted once: a second one is refused, and no camera or microphone ever.
    expect(await tryMedia(session)).toEqual([
      'display:refused',
      'camera:refused',
      'microphone:refused',
    ]);
    expect(await tryMedia(control)).toEqual([
      'display:refused',
      'camera:refused',
      'microphone:refused',
    ]);
    expect(await app.screen()).toBe('sharing');
    for (const p of [session, control, await app.page('overlay.html')]) {
      // Playwright's own code may eval; what the page runs later may not (CSP: no unsafe-eval,
      // no inline script), and it has no Node and opens no window.
      expect(
        await p.evaluate(async () => {
          const w = window as unknown as Record<string, unknown>;
          window.setTimeout('window.__evaled = 1' as unknown as () => void, 0);
          const s = document.createElement('script');
          s.textContent = 'window.__inline = 1';
          document.body.append(s);
          await new Promise((r) => setTimeout(r, 100));
          return {
            node: typeof w.require !== 'undefined' || typeof w.process !== 'undefined',
            opened: window.open('https://example.com') !== null,
            evaled: w.__evaled === 1,
            inline: w.__inline === 1,
          };
        }),
      ).toEqual({ node: false, opened: false, evaled: false, inline: false });
    }
    // Only the session page connects, and only to trackers.
    expect(
      await control.evaluate(() =>
        fetch('https://example.com').then(
          () => 'fetched',
          () => 'refused',
        ),
      ),
    ).toBe('refused');
    // The control window can only show and act; it cannot report for the session.
    expect(
      await control.evaluate(() =>
        Object.keys((window as unknown as { support: object }).support).sort(),
      ),
    ).toEqual(['act', 'onState']);
  });

  it('ends when the helper ends the session', async () => {
    const { page, appUrl } = await helper();
    const app = await launch(appUrl, [1]);
    await expect.poll(() => videoWidth(page), { timeout: 40000 }).toBe(1280);
    page.once('dialog', (d) => void d.accept());
    await page.locator('#end').click();
    await expect.poll(() => app.screen(), { timeout: 30000 }).toBe('ended');
    expect(await app.windows()).toEqual({ session: false, overlay: false });
    const control = await app.control();
    await expect.poll(() => control.locator('h1').textContent()).toMatch(/ended/);
  });

  it('refuses a bad link without connecting', async () => {
    const app = await launch('inksplat-support://join#inksplat=not-a-token');
    await expect.poll(() => app.screen(), { timeout: 30000 }).toBe('bad-link');
    expect(await app.windows()).toEqual({ session: false, overlay: false });
    const control = await app.control();
    await expect.poll(() => control.locator('h1').textContent()).toMatch(/does not work/);
  });
});
