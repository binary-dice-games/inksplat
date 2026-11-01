// MIT License © 2026 Binary Dice Games
/**
 * @file Makes the screenshots and animations of the tutorial page (`viewer/src/site/tutorial.html`)
 * by driving the built site in Chrome over a local fake tracker, as the browser tests do.
 *
 *   npm run tutorial:media                     all of them
 *   npm run tutorial:media -- -t "pen"         only those whose name matches
 *
 * Needs Chrome (`INKSPLAT_CHROME`) and ffmpeg on the PATH. Not part of the test suite: run it by
 * hand after a change to the look of the board, and commit the files it writes to
 * `viewer/src/site/tutorial/`. A visible cursor, the keys held and a fake file being dragged are
 * drawn by the page itself (`OVERLAY`), since a headless browser shows none of them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CDPSession, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PresenterSite } from '../support/presenter-site';

const OUT = resolve(import.meta.dirname, '../../viewer/src/site/tutorial');
const VIEW = { width: 1280, height: 720 };

/** A part of the page, in CSS pixels. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `OVERLAY` adds to the page. */
interface Overlay {
  tutorialKeys(text: string, x: number, y: number): void;
  tutorialGhost(label: string): void;
}

/**
 * Drawn over the page: a mouse pointer that follows the mouse (with a ring while pressed), a badge
 * with the keys held, and the card of a file being dragged in from the desktop.
 */
const OVERLAY = `(() => {
  const css = \`
    #tutorial-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 0; height: 0; }
    #tutorial-cursor svg { position: absolute; left: -2px; top: -1px; width: 24px; height: 24px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
    #tutorial-cursor .ring { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; border-radius: 50%;
      background: rgba(255, 196, 0, .45); border: 2px solid rgba(232, 113, 43, .9); transform: scale(.3); opacity: 0; transition: transform 120ms, opacity 120ms; }
    #tutorial-cursor.down .ring { transform: scale(1); opacity: 1; }
    #tutorial-cursor .ghost { position: absolute; left: 14px; top: 14px; padding: 8px 12px 8px 10px; border-radius: 8px; background: #fff;
      color: #1c2024; font: 600 13px system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); white-space: nowrap; opacity: .92; display: flex; gap: 8px; align-items: center; }
    #tutorial-cursor .ghost::before { content: ''; width: 18px; height: 22px; border-radius: 3px; background: linear-gradient(135deg, #2f7fc1, #6aa84f); }
    #tutorial-keys { position: fixed; left: 70px; top: 440px; z-index: 2147483646; pointer-events: none;
      display: flex; gap: 6px; font: 700 18px system-ui, sans-serif; }
    #tutorial-keys kbd { min-width: 34px; padding: 6px 12px; border-radius: 8px; background: #1c2024; color: #fff; text-align: center;
      box-shadow: 0 3px 0 #000, 0 6px 16px rgba(0,0,0,.3); font: inherit; }
    #tutorial-keys span { align-self: center; color: #1c2024; text-shadow: 0 0 3px #fff, 0 0 6px #fff; }
  \`;
  const make = () => {
    if (document.getElementById('tutorial-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    const cursor = document.createElement('div');
    cursor.id = 'tutorial-cursor';
    cursor.innerHTML = '<div class="ring"></div><svg viewBox="0 0 24 24"><path d="M3 2l16 9-7 1.6L8.6 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const keys = document.createElement('div');
    keys.id = 'tutorial-keys';
    document.documentElement.append(style, cursor, keys);
    const at = (e) => (cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)');
    addEventListener('pointermove', at, true);
    addEventListener('dragover', at, true);
    addEventListener('pointerdown', (e) => { at(e); cursor.classList.add('down'); }, true);
    addEventListener('pointerup', () => cursor.classList.remove('down'), true);
    window.tutorialKeys = (text, x, y) => {
      keys.style.left = x + 'px';
      keys.style.top = y + 'px';
      keys.replaceChildren(...text.split(/(\\+| then )/).filter(Boolean).map((part) => {
        const el = document.createElement(/^(\\+| then )$/.test(part) ? 'span' : 'kbd');
        el.textContent = part.trim();
        return el;
      }));
    };
    window.tutorialGhost = (label) => {
      cursor.querySelector('.ghost')?.remove();
      if (label) {
        const ghost = document.createElement('div');
        ghost.className = 'ghost';
        ghost.textContent = label;
        cursor.append(ghost);
      }
    };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', make);
  else make();
})();`;

/**
 * Gives `page` a `getDisplayMedia` that returns a slide (a title, a bar chart and three points), as
 * a shared window of a presentation would look.
 */
async function slideDisplay(page: Page, title = 'Q4 roadmap'): Promise<void> {
  await page.addInitScript((heading: string) => {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const g = canvas.getContext('2d')!;
      const paint = (tick: number) => {
        g.fillStyle = '#f7f4ee';
        g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#1d2b3a';
        g.fillRect(0, 0, 1280, 8);
        g.font = 'bold 54px sans-serif';
        g.fillText(heading, 80, 120);
        g.font = '26px sans-serif';
        g.fillStyle = '#60646c';
        g.fillText('Sign-ups per month, in thousands', 80, 170);
        const bars = [3, 4.5, 4, 6, 7.5, 9];
        const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        bars.forEach((v, i) => {
          g.fillStyle = i < 4 ? '#2f7fc1' : '#e8712b';
          g.fillRect(100 + i * 95, 600 - v * 40, 64, v * 40);
          g.fillStyle = '#1d2b3a';
          g.font = '22px sans-serif';
          g.fillText(months[i]!, 106 + i * 95, 636);
        });
        g.fillStyle = '#1d2b3a';
        g.fillRect(90, 600, 580, 3);
        g.font = 'bold 30px sans-serif';
        g.fillText('Next steps', 760, 260);
        g.font = '26px sans-serif';
        ['Launch the mobile app', 'Two new regions', 'Self-service billing'].forEach((t, i) => {
          g.fillStyle = '#6aa84f';
          g.beginPath();
          g.arc(772, 312 + i * 60, 8, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#1d2b3a';
          g.fillText(t, 795, 321 + i * 60);
        });
        // A pixel that changes, so the stream keeps sending frames.
        g.fillStyle = tick % 2 ? '#f7f4ee' : '#f6f3ed';
        g.fillRect(1279, 719, 1, 1);
      };
      let tick = 0;
      paint(tick);
      setInterval(() => paint(++tick), 200);
      const stream = canvas.captureStream(5);
      const track = stream.getVideoTracks()[0]!;
      const real = track.getSettings.bind(track);
      track.getSettings = () => ({ ...real(), displaySurface: 'window' }) as MediaTrackSettings;
      return stream;
    };
  }, title);
}

/** Records what `page` shows (Chrome's screencast) and writes it as an animated GIF. */
class Recording {
  private readonly frames: { data: Buffer; t: number }[] = [];

  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async start(page: Page): Promise<Recording> {
    const cdp = await page.context().newCDPSession(page);
    const rec = new Recording(page, cdp);
    cdp.on('Page.screencastFrame', (f) => {
      rec.frames.push({ data: Buffer.from(f.data, 'base64'), t: f.metadata.timestamp ?? 0 });
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'png',
      maxWidth: VIEW.width,
      maxHeight: VIEW.height,
    });
    await page.waitForTimeout(300);
    return rec;
  }

  /**
   * Stops and writes `<name>.gif`: `crop` of the page, scaled by `scale`, at 10 frames a second,
   * holding the last frame for `hold` seconds before it loops.
   */
  async save(name: string, crop: Box, { scale = 1, hold = 1.5 } = {}): Promise<void> {
    await this.page.waitForTimeout(400);
    await this.cdp.send('Page.stopScreencast');
    await this.cdp.detach();
    const work = mkdtempSync(join(tmpdir(), 'inksplat-gif-'));
    try {
      const list: string[] = [];
      this.frames.forEach((f, i) => {
        const file = join(work, `${String(i).padStart(5, '0')}.png`);
        writeFileSync(file, f.data);
        const next = this.frames[i + 1];
        const duration = next ? Math.max(0.01, next.t - f.t) : hold;
        list.push(`file '${file}'`, `duration ${duration.toFixed(3)}`);
      });
      // The concat demuxer needs the last file again for its duration to count.
      list.push(list[list.length - 2]!);
      writeFileSync(join(work, 'list.txt'), list.join('\n'));
      const w = Math.round(crop.width * scale);
      const h = Math.round(crop.height * scale);
      const filter =
        `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},fps=10,` +
        `scale=${w}:${h}:flags=lanczos,split[a][b];` +
        '[a]palettegen=max_colors=64:stats_mode=diff[p];' +
        '[b][p]paletteuse=dither=none:diff_mode=rectangle';
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        join(work, 'list.txt'),
        '-filter_complex',
        filter,
        '-loop',
        '0',
        join(OUT, `${name}.gif`),
      ]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

/** Shows `text` as keys on the page (`Shift+drag`, `6 then 6`), or nothing for ''. */
const keys = (page: Page, text: string, at: [number, number] = KEYS_AT) =>
  page.evaluate(([t, x, y]) => (window as unknown as Overlay).tutorialKeys(t, x, y), [
    text,
    ...at,
  ] as [string, number, number]);

/** Where the keys are shown unless said otherwise: low on the left, inside `TOOL_AREA`. */
const KEYS_AT: [number, number] = [70, 450];

/** Where the mouse of each page is, so it can glide from there. */
const mice = new WeakMap<Page, [number, number]>();

/** Moves the mouse along a straight line, slowly enough to be seen. */
async function glide(page: Page, to: [number, number], steps = 20): Promise<void> {
  const start = mice.get(page) ?? to;
  for (let i = 1; i <= steps; i++) {
    const at: [number, number] = [
      start[0] + ((to[0] - start[0]) * i) / steps,
      start[1] + ((to[1] - start[1]) * i) / steps,
    ];
    await page.mouse.move(...at);
    mice.set(page, at);
    await page.waitForTimeout(16);
  }
}

/** Drags the mouse through `points` (pressed from the first to the last). */
async function drag(page: Page, points: [number, number][], steps = 4) {
  await glide(page, points[0]!, 12);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    await glide(page, p, steps);
  }
  await page.mouse.up();
}

/** The points of a circle-ish loop around (cx, cy). */
function loop(cx: number, cy: number, rx: number, ry: number, n = 28): [number, number][] {
  return Array.from({ length: n + 3 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2.1;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

/** Presses a key, showing it on the page for a moment. */
async function press(page: Page, key: string, label = key, at = KEYS_AT) {
  await keys(page, label, at);
  await page.keyboard.press(key);
  await page.waitForTimeout(500);
  await keys(page, '', at);
}

let site: PresenterSite;

/** A presenter page with the overlay and the slide as its screen, at `VIEW` size. */
async function presenter(): Promise<Page> {
  const ctx = await site.context({ viewport: VIEW });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[presenter]', e.message));
  await page.addInitScript(OVERLAY);
  await slideDisplay(page);
  await page.goto(`${site.origin}/present.html?tr=${encodeURIComponent(site.tracker.url)}`);
  return page;
}

/** A session on a whiteboard, the controls folded away: a clean board to show a tool on. */
async function board(): Promise<Page> {
  const page = await presenter();
  await site.startSession(page);
  await page.locator('#background').selectOption('whiteboard');
  await page.locator('#panelClose').click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await glide(page, [640, 400], 1);
  await page.waitForTimeout(500);
  return page;
}

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  site = await PresenterSite.start();
});
afterAll(() => site?.close());

/** The left of the board with the toolbar and the hint line: where most tools are shown. */
const TOOL_AREA: Box = { x: 0, y: 0, width: 900, height: 520 };

/** A viewer that joins `link` as `name`, with the overlay and a slide of its own to share. */
async function viewer(link: string, name: string): Promise<Page> {
  const ctx = await site.context({ viewport: VIEW });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[viewer]', e.message));
  await page.addInitScript(OVERLAY);
  await slideDisplay(page, 'Design review');
  await page.goto(link);
  await page.locator('#name').fill(name);
  await page.locator('#color').fill('#8e44ad');
  await page.locator('#joinForm button[type=submit]').click();
  await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
  return page;
}

/** A file to drop on the board: its name, type and bytes (made in the page from `make`). */
interface Drop {
  name: string;
  type: string;
  base64: string;
}

/** A one-page PDF with a title and a few lines of text, for the preview of a dropped file. */
function briefPdf(): Drop {
  const lines = [
    'BT /F1 34 Tf 72 700 Td (Project brief) Tj ET',
    '0.18 0.5 0.76 rg 72 670 468 6 re f 0 0 0 rg',
    ...['Goals for the quarter', 'Owners and dates', 'Open questions', 'Budget'].map(
      (t, i) => `BT /F1 20 Tf 90 ${620 - i * 40} Td (- ${t}) Tj ET`,
    ),
    '0.91 0.44 0.17 rg 72 200 220 140 re f 0.42 0.66 0.31 rg 320 200 220 200 re f',
  ];
  const content = lines.join('\n');
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return {
    name: 'brief.pdf',
    type: 'application/pdf',
    base64: Buffer.from(out).toString('base64'),
  };
}

/** A small landscape photo (sky, sun, hills), drawn in the page as a JPEG. */
async function photo(page: Page): Promise<Drop> {
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 320;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 320);
    sky.addColorStop(0, '#6cb6e8');
    sky.addColorStop(1, '#f6d9a8');
    g.fillStyle = sky;
    g.fillRect(0, 0, 480, 320);
    g.fillStyle = '#f9c440';
    g.beginPath();
    g.arc(360, 110, 42, 0, Math.PI * 2);
    g.fill();
    for (const [color, y, k] of [
      ['#7aa95c', 220, 0.012],
      ['#4f7d3e', 250, 0.02],
    ] as const) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, 320);
      for (let x = 0; x <= 480; x += 8) g.lineTo(x, y + Math.sin(x * k) * 30);
      g.lineTo(480, 320);
      g.fill();
    }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]!;
  });
  return { name: 'hills.jpg', type: 'image/jpeg', base64 };
}

/** A picture with a transparent background: the inksplat logo. */
function logo(): Drop {
  const file = resolve(import.meta.dirname, '../../viewer/src/assets/logo.png');
  return { name: 'logo.png', type: 'image/png', base64: readFileSync(file).toString('base64') };
}

/**
 * Drags `file` in from the right edge, as from the desktop (the card follows the mouse), and drops
 * it at `at`.
 */
async function dropFile(page: Page, file: Drop, at: [number, number]): Promise<void> {
  await glide(page, [VIEW.width - 20, at[1] - 60], 1);
  await page.evaluate((label) => (window as unknown as Overlay).tutorialGhost(label), file.name);
  await glide(page, at, 24);
  await page.evaluate(
    ({ x, y, f }) => {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], f.name, { type: f.type }));
      const target = document.elementFromPoint(x, y)!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: dt,
            clientX: x,
            clientY: y,
            bubbles: true,
            composed: true,
            cancelable: true,
          }),
        );
      }
      (window as unknown as Overlay).tutorialGhost('');
    },
    { x: at[0], y: at[1], f: file },
  );
}

/** Pastes `text` (as Ctrl+V would) where the mouse is. */
async function paste(page: Page, text: string): Promise<void> {
  await keys(page, 'Ctrl+V');
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.body.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, text);
  await page.waitForTimeout(600);
  await keys(page, '');
}

/** The box of the last item put on the board (a note, picture, sticker...). */
async function lastItem(page: Page): Promise<Box> {
  const box = await page.locator('collab-whiteboard .item').last().boundingBox();
  if (!box) throw new Error('no item on the board');
  return box;
}

const centre = (b: Box): [number, number] => [b.x + b.width / 2, b.y + b.height / 2];

/** The box of `selector` with a margin of `margin` around it. */
async function around(page: Page, selector: string, margin = 24): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not shown`);
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

/** A screenshot of `clip` of the page. */
const shot = (page: Page, name: string, clip?: Box) =>
  page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });

describe('tutorial media', () => {
  it('start page', async () => {
    const page = await presenter();
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.locator('#startSession').waitFor({ state: 'visible' });
    await shot(page, 'start', await around(page, '#startForm'));
  });

  it('session', async () => {
    const page = await presenter();
    const link = await site.startSession(page);
    await page.locator('#share').click();
    await page.locator('#shareNotice button[value=continue]').click();
    await page.waitForTimeout(1500);
    // The join form of a viewer.
    const ctx = await site.context({ viewport: { width: 900, height: 760 } });
    const join = await ctx.newPage();
    await join.goto(link);
    await join.locator('#name').fill('Ana');
    await join.locator('#color').fill('#8e44ad');
    await join.locator('#name').blur();
    await shot(join, 'join', await around(join, '#joinForm'));
    // Ana joins and draws on the presenter's slide.
    const ana = await viewer(link, 'Ana');
    await page.locator('#panelClose').click();
    await page.mouse.move(1000, 600);
    await page.waitForTimeout(1500);
    const rec = await Recording.start(page);
    await press(ana, '2');
    await drag(ana, loop(570, 450, 120, 150), 2);
    await press(ana, '3');
    await glide(ana, [520, 230], 15);
    await ana.mouse.click(520, 230);
    await ana.keyboard.type('Best month yet!', { delay: 70 });
    await ana.keyboard.press('Enter');
    await press(ana, '1');
    await glide(page, [1060, 312], 20);
    await page.keyboard.press('4');
    await page.mouse.click(1060, 312);
    await page.waitForTimeout(300);
    await page.keyboard.press('1');
    await glide(ana, [700, 380], 20);
    await rec.save('together', { x: 0, y: 0, width: 1280, height: 720 }, { scale: 0.6, hold: 2 });

    // Ana offers her screen: the presenter picks what everybody sees.
    await ana.locator('#share').click();
    await ana.locator('#shareNotice button[value=continue]').click();
    await ana.locator('#askTurn, button:has-text("Ask for a turn")').first().click();
    await page.locator('#panelToggle').click();
    await page.waitForTimeout(2500);
    // The link of a test server means nothing to a reader: show one of the real site.
    const shown = 'https://binary-dice-games.github.io/inksplat/#inksplat=2bk8iKqm...';
    await page.locator('#link').evaluate((el, v) => ((el as HTMLInputElement).value = v), shown);
    await shot(page, 'session');
    const panel = await page.locator('#panel').boundingBox();
    if (panel) await shot(page, 'panel', panel);
    await page.locator('#panel #saveBoard').click();
    await page.waitForTimeout(300);
    const dialog = await page.locator('#save').boundingBox();
    if (dialog) await shot(page, 'save', dialog);
  });

  it('toolbar', async () => {
    const page = await board();
    await shot(page, 'toolbar', { x: 0, y: 0, width: 60, height: 410 });
    await page.mouse.click(28, 64);
    await page.waitForTimeout(400);
    await shot(page, 'pen-options', { x: 0, y: 30, width: 260, height: 80 });
    await page.keyboard.press('Escape');
    await page.mouse.click(28, 310);
    await page.waitForTimeout(400);
    await shot(page, 'colours', { x: 0, y: 270, width: 300, height: 120 });
  });

  it('pen', async () => {
    const page = await board();
    const rec = await Recording.start(page);
    await press(page, '2');
    await drag(page, loop(420, 280, 150, 90), 2);
    await press(page, '2');
    await drag(page, [
      [300, 420],
      [420, 450],
      [560, 410],
    ]);
    await rec.save('pen', TOOL_AREA, { scale: 0.75 });
  });

  it('text and stickers', async () => {
    const page = await board();
    const rec = await Recording.start(page);
    await press(page, '3');
    await glide(page, [260, 200], 15);
    await page.mouse.click(260, 200);
    await page.keyboard.type('Ship it on Friday', { delay: 70 });
    await press(page, 'Enter');
    await press(page, '4');
    await glide(page, [330, 330], 12);
    await page.mouse.click(330, 330);
    await press(page, '4');
    await glide(page, [450, 330], 12);
    await page.mouse.click(450, 330);
    await press(page, '4');
    await glide(page, [570, 330], 12);
    await page.mouse.click(570, 330);
    await press(page, '1');
    // Shift+drag scales a sticker, Ctrl+drag turns it.
    await glide(page, [570, 330], 12);
    await keys(page, 'Shift+drag');
    await page.keyboard.down('Shift');
    await drag(
      page,
      [
        [570, 330],
        [582, 342],
      ],
      10,
    );
    await page.keyboard.up('Shift');
    await keys(page, 'Ctrl+drag');
    await page.keyboard.down('Control');
    await drag(page, [
      [450, 330],
      [470, 380],
      [420, 390],
    ]);
    await page.keyboard.up('Control');
    await keys(page, '');
    await rec.save('text-stickers', TOOL_AREA, { scale: 0.75 });
  });

  it('eraser and undo', async () => {
    const page = await board();
    await page.keyboard.press('2');
    await drag(page, loop(300, 250, 90, 60), 1);
    await drag(page, [
      [480, 200],
      [620, 320],
    ]);
    await drag(page, [
      [480, 320],
      [620, 200],
    ]);
    const rec = await Recording.start(page);
    await press(page, '5');
    await drag(
      page,
      [
        [505, 170],
        [505, 350],
        [600, 350],
        [600, 170],
      ],
      10,
    );
    await page.waitForTimeout(500);
    await press(page, 'Control+z', 'Ctrl+Z');
    await page.waitForTimeout(500);
    await rec.save('eraser', TOOL_AREA, { scale: 0.75 });
  });

  it('notes, pins and threads', async () => {
    const page = await board();
    const rec = await Recording.start(page);
    await press(page, '6');
    await drag(
      page,
      [
        [180, 150],
        [330, 280],
      ],
      12,
    );
    await page.waitForTimeout(300);
    await glide(page, [255, 215], 8);
    await page.mouse.click(255, 215);
    await page.keyboard.type('Research', { delay: 70 });
    await page.mouse.click(700, 460);
    await press(page, '6');
    await press(page, '6');
    await glide(page, [600, 260], 12);
    await page.mouse.click(600, 260);
    await page.waitForTimeout(300);
    await page.mouse.click(600, 260);
    await page.keyboard.type('Launch', { delay: 70 });
    await page.mouse.click(700, 460);
    await press(page, '8');
    await drag(
      page,
      [
        [255, 170],
        [420, 140],
        [600, 230],
      ],
      10,
    );
    await press(page, '7');
    await glide(page, [420, 400], 12);
    await page.mouse.click(420, 400);
    await press(page, '1');
    // Shift+drag from a pin pulls a thread with any tool.
    await keys(page, 'Shift+drag from a pin');
    await page.keyboard.down('Shift');
    await drag(
      page,
      [
        [420, 396],
        [520, 340],
        [600, 290],
      ],
      10,
    );
    await page.keyboard.up('Shift');
    await keys(page, '');
    await rec.save('notes-threads', TOOL_AREA, { scale: 0.75 });
  });

  it('select', async () => {
    const page = await board();
    await page.keyboard.press('4');
    for (const x of [300, 380, 460]) await page.mouse.click(x, 260);
    await page.keyboard.press('2');
    await drag(page, loop(380, 340, 110, 25), 1);
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    const rec = await Recording.start(page);
    await drag(
      page,
      [
        [240, 262],
        [500, 262],
        [500, 362],
        [380, 372],
      ],
      10,
    );
    await page.waitForTimeout(500);
    await drag(
      page,
      [
        [380, 260],
        [500, 180],
      ],
      15,
    );
    await page.waitForTimeout(400);
    await press(page, 'Delete');
    await page.waitForTimeout(400);
    await rec.save('select', TOOL_AREA, { scale: 0.75 });
  });

  it('pointer modes', async () => {
    const LOW: [number, number] = [70, 380];
    const page = await presenter();
    await site.startSession(page);
    await page.locator('#share').click();
    await page.locator('#shareNotice button[value=continue]').click();
    await page.locator('#panelClose').click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await glide(page, [640, 400], 1);
    await page.waitForTimeout(1500);
    const rec = await Recording.start(page);
    await press(page, '1', '1', LOW);
    await press(page, '1', '1', LOW);
    await drag(
      page,
      [
        [100, 330],
        [300, 230],
        [520, 160],
        [560, 120],
      ],
      10,
    );
    await page.waitForTimeout(600);
    await press(page, '1', '1', LOW);
    await glide(page, [520, 330], 10);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await glide(page, [520, 262], 10);
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(150);
    // Clicking a live emote makes it bigger.
    await page.mouse.click(520, 300);
    await page.waitForTimeout(100);
    await page.mouse.click(520, 290);
    await page.waitForTimeout(1500);
    await press(page, 'Escape', 'Esc', LOW);
    await rec.save('laser-emotes', { x: 0, y: 0, width: 800, height: 450 }, { scale: 0.85 });
    // The magnifier over the small print of the slide.
    await press(page, '1', '1', LOW);
    await press(page, '1', '1', LOW);
    await press(page, '1', '1', LOW);
    await glide(page, [200, 170], 10);
    await page.waitForTimeout(500);
    await shot(page, 'magnifier', { x: 0, y: 0, width: 760, height: 430 });
  });

  it('files', async () => {
    const page = await board();
    const rec = await Recording.start(page);
    await dropFile(page, await photo(page), [300, 230]);
    await page.waitForTimeout(800);
    const pic = await lastItem(page);
    await keys(page, 'drag the corner');
    await drag(
      page,
      [
        [pic.x + pic.width - 14, pic.y + pic.height - 14],
        [pic.x + pic.width - 84, pic.y + pic.height - 60],
      ],
      12,
    );
    await keys(page, '');
    await dropFile(page, briefPdf(), [620, 260]);
    await page.waitForTimeout(1500);
    await rec.save('drop-files', TOOL_AREA, { scale: 0.75, hold: 2 });
    // A picture with a transparent background is cut out; it turns with Ctrl+drag.
    const rec2 = await Recording.start(page);
    await dropFile(page, logo(), [260, 470]);
    await page.waitForTimeout(800);
    const cut = await lastItem(page);
    await keys(page, 'Ctrl+drag');
    await page.keyboard.down('Control');
    await drag(page, [centre(cut), [centre(cut)[0] + 60, centre(cut)[1] + 40]], 12);
    await page.keyboard.up('Control');
    await keys(page, '');
    await glide(page, [660, 470], 10);
    await paste(page, 'https://github.com/binary-dice-games/inksplat');
    await page.waitForTimeout(1200);
    await rec2.save('cutout-link', { x: 0, y: 0, width: 900, height: 620 }, { scale: 0.75 });
  });

  it('zoom and canvases', async () => {
    const page = await presenter();
    await site.startSession(page);
    await page.locator('#share').click();
    await page.locator('#shareNotice button[value=continue]').click();
    await page.locator('#panelClose').click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await glide(page, [640, 400], 1);
    await page.waitForTimeout(1500);
    const rec = await Recording.start(page);
    await glide(page, [390, 470], 15);
    await keys(page, 'mouse wheel', [70, 620]);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(120);
    }
    await keys(page, 'Space+drag', [70, 620]);
    await page.keyboard.down(' ');
    await drag(
      page,
      [
        [390, 470],
        [700, 300],
      ],
      15,
    );
    await page.keyboard.up(' ');
    await page.waitForTimeout(400);
    await press(page, '0', '0', [70, 620]);
    await page.waitForTimeout(600);
    for (const x of [606, 640, 674, 708, 572]) {
      await glide(page, [x, 25], 12);
      await page.mouse.click(x, 25);
      await page.waitForTimeout(900);
    }
    await rec.save('zoom-canvases', { x: 0, y: 0, width: 1280, height: 720 }, { scale: 0.6 });
  });
});
