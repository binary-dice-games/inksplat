// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../scripts/build-site.mjs';
import { launchChrome } from '../support/browser';

// The Pages site in a browser, served like GitHub Pages serves a project site: under
// /inksplat/, with unknown paths answered by 404.html and status 404.

let browser: Browser;
let server: Server;
let work: string;
let origin: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'inksplat-site-'));
  const out = join(work, 'site');
  await buildSite(out, { base: '/inksplat/', archive: join(work, 'none') });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/inksplat/')) {
      res.writeHead(404).end('not the site');
      return;
    }
    const path = url.pathname.slice('/inksplat/'.length);
    const types: Record<string, string> = {
      html: 'text/html',
      js: 'text/javascript',
      png: 'image/png',
      gif: 'image/gif',
    };
    try {
      const file = path === '' || path.endsWith('/') ? `${path}index.html` : path;
      const body = readFileSync(join(out, file));
      res.writeHead(200, { 'content-type': types[file.split('.').pop() ?? ''] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(readFileSync(join(out, '404.html')));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchChrome();
}, 60000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

const token = 'abcdefghijklmnopqrstuv';

describe('the Pages site in a browser', () => {
  it('shows the join form at the root and under /v2/', async () => {
    for (const path of ['/inksplat/', '/inksplat/v2/']) {
      const page = await browser.newPage();
      await page.goto(`${origin}${path}#inksplat=${token}`);
      await expect.poll(() => page.locator('#join').isVisible()).toBe(true);
      await page.close();
    }
  });

  it('sends a lost invite to the site root, keeping it', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${origin}/inksplat/old/folder/page#inksplat=${token}&tr=ws%3A%2F%2Fx.example`);
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toBe(`${origin}/inksplat/#inksplat=${token}&tr=ws%3A%2F%2Fx.example`);
    await expect.poll(() => page.locator('#join').isVisible()).toBe(true);
    // No content security policy violation on the 404 page or the viewer.
    expect(errors.filter((e) => /content security policy/i.test(e))).toEqual([]);
    await page.close();
  });

  it('shows the 404 page, with a way home, when there is no invite', async () => {
    const page = await browser.newPage();
    const res = await page.goto(`${origin}/inksplat/nothing-here`);
    expect(res?.status()).toBe(404);
    await expect.poll(() => page.locator('#home').getAttribute('href')).toBe('/inksplat/');
    expect(page.url()).toBe(`${origin}/inksplat/nothing-here`);
    await page.close();
  });

  it('serves the privacy policy', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/inksplat/privacy.html`);
    expect(await page.title()).toBe('inksplat privacy policy');
    expect(await page.locator('main h2').count()).toBeGreaterThan(3);
    await page.close();
  });

  it('links the tutorial from the home page, and shows all its pictures', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/inksplat/`);
    await page.locator('.home-nav a[href="tutorial.html"]').click();
    await page.waitForURL(`${origin}/inksplat/tutorial.html`);
    expect(await page.title()).toBe('How to use inksplat');
    const images = page.locator('main img');
    expect(await images.count()).toBeGreaterThan(10);
    // Lazy pictures load when scrolled to: load them all, then check none is broken.
    await images.evaluateAll((all) =>
      all.forEach((img) => ((img as HTMLImageElement).loading = 'eager')),
    );
    await expect
      .poll(() =>
        images.evaluateAll(
          (all) => all.filter((img) => !(img as HTMLImageElement).complete).length,
        ),
      )
      .toBe(0);
    const broken = await images.evaluateAll((all) =>
      all
        .filter((img) => (img as HTMLImageElement).naturalWidth === 0)
        .map((img) => img.getAttribute('src')),
    );
    expect(broken).toEqual([]);
    await page.close();
  });
});
