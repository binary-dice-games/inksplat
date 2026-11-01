// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchChrome } from '../support/browser';

// The still refresh (viewer/src/still-refresh.ts) in Chrome, with its real worker: a canvas
// track that sends one frame and then nothing (as screen capture does once the screen is still)
// comes out repeated for a while, and the output ends with the source.

const ROOT = resolve(__dirname, '..', '..');

let browser: Browser;
let server: Server;
let origin: string;
let work: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'inksplat-still-'));
  const src = join(ROOT, 'viewer', 'src');
  writeFileSync(
    join(work, 'entry.ts'),
    `import { refreshStill } from ${JSON.stringify(join(src, 'still-refresh.ts'))};\n` +
      '(window as unknown as { refreshStill: typeof refreshStill }).refreshStill = refreshStill;\n',
  );
  await build({
    entryPoints: [
      { in: join(work, 'entry.ts'), out: 'entry' },
      { in: join(src, 'still-refresh-worker.ts'), out: 'still-refresh-worker' },
    ],
    outdir: work,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    logLevel: 'warning',
  });
  writeFileSync(
    join(work, 'index.html'),
    '<!doctype html><meta charset="utf-8"><script src="entry.js"></script>',
  );
  server = createServer((req, res) => {
    const name = new URL(req.url ?? '/', 'http://x').pathname.slice(1) || 'index.html';
    try {
      const body = readFileSync(join(work, name.replace(/[^\w.-]/g, '')));
      res.writeHead(200, {
        'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchChrome();
}, 60000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function open(): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(origin);
  await page.waitForFunction(() => 'refreshStill' in window);
  return page;
}

describe('refreshStill', () => {
  it('repeats a still frame for forMs, then stops, and ends with the source', async () => {
    const page = await open();
    const result = await page.evaluate(async () => {
      type Refresh = (
        t: MediaStreamTrack,
        o: { everyMs: number; forMs: number },
      ) => { track: MediaStreamTrack; stop(): void } | null;
      const refreshStill = (window as unknown as { refreshStill: Refresh }).refreshStill;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const g = canvas.getContext('2d')!;
      const source = canvas.captureStream(0).getVideoTracks()[0] as MediaStreamTrack & {
        requestFrame(): void;
      };
      const out = refreshStill(source, { everyMs: 100, forMs: 600 });
      if (!out) return null;
      const Processor = (
        window as unknown as {
          MediaStreamTrackProcessor: new (i: { track: MediaStreamTrack }) => {
            readable: ReadableStream<VideoFrame>;
          };
        }
      ).MediaStreamTrackProcessor;
      const reader = new Processor({ track: out.track }).readable.getReader();
      let frames = 0;
      let ended = false;
      void (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          frames += 1;
          value.close();
        }
        ended = true;
      })();
      g.fillStyle = '#3e63dd';
      g.fillRect(0, 0, 320, 180);
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // A frame, as a capture sends when it starts: asked for until one is through (the worker
      // starts meanwhile, and a frame asked for before it runs may not reach it).
      const deadline = performance.now() + 5000;
      while (frames === 0 && performance.now() < deadline) {
        source.requestFrame();
        await wait(100);
      }
      // Then still: the output repeats it for forMs, then stops.
      const first = frames;
      await wait(1500); // well past forMs
      const count = frames - first;
      await wait(500);
      const later = frames - first;
      source.stop();
      const end = performance.now() + 5000;
      while (out.track.readyState !== 'ended' && !ended && performance.now() < end) await wait(20);
      return { count, later, ended: ended || out.track.readyState === 'ended' };
    });
    expect(result, 'MediaStreamTrackProcessor/Generator in Chrome').not.toBeNull();
    const r = result!;
    // After the last frame: repeats every everyMs for forMs (6 at most; slow timers make fewer)
    expect(r.count).toBeGreaterThanOrEqual(2);
    expect(r.count).toBeLessThanOrEqual(7);
    expect(r.later).toBe(r.count);
    expect(r.ended).toBe(true);
  }, 30000);
});
