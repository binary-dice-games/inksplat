// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUNDS } from '@inksplat/defaults';
import type { Stage } from '@inksplat/defaults';
import { BACKGROUND_STYLES, bitmapBackground, showSheet } from '../../viewer/src/sheet';

const stage = (over: Partial<Stage> = {}): Stage => ({
  aspect: 2,
  w: 1000,
  h: 500,
  fps: 3,
  state: 'live',
  drawing: true,
  ...over,
});

function parts() {
  const box = document.createElement('div');
  Object.defineProperty(box, 'clientWidth', { value: 800 });
  Object.defineProperty(box, 'clientHeight', { value: 800 });
  const video = document.createElement('video');
  const page = document.createElement('div');
  page.hidden = true;
  return { box, video, page };
}

describe('the sheet of a canvas without video', () => {
  it('has a style for every background', () => {
    for (const name of BACKGROUNDS) {
      expect(BACKGROUND_STYLES[name].background).toContain('#');
      expect(BACKGROUND_STYLES[name].label).not.toBe('');
    }
  });

  it('gives the wall and the cork a lit rough surface, and the cork a frame', () => {
    for (const name of ['wall', 'cork'] as const) {
      const style = BACKGROUND_STYLES[name];
      expect(style.blend).toContain('multiply');
      expect(style.shadow).toContain('inset');
    }
    expect(BACKGROUND_STYLES.cork.border).toContain('solid');
  });

  it('shows the screen on the canvases that show it (canvas 1 unless chosen otherwise)', () => {
    const p = parts();
    showSheet(p, stage(), 2);
    expect(p.video.hidden).toBe(false);
    expect(p.page.hidden).toBe(true);
    showSheet(p, null, 2);
    expect(p.page.hidden).toBe(true);
    // Canvas 2 shows the whiteboard by default.
    showSheet(p, stage(), 2, 1);
    expect(p.video.hidden).toBe(true);
    expect(p.page.hidden).toBe(false);
    expect(p.page.style.border).toContain('rgb(185, 190, 198)');
    showSheet(p, stage({ backgrounds: ['cork', 'screen'] }), 2, 1);
    expect(p.video.hidden).toBe(false);
    expect(p.page.hidden).toBe(true);
    showSheet(p, stage({ backgrounds: ['cork', 'screen'] }), 2, 0);
    expect(p.page.style.border).toContain('rgb(139, 94, 52)');
  });

  it('lays the screen over the letterboxed frame, on black', () => {
    const p = parts();
    showSheet(p, stage(), 2);
    expect(p.video.style.width).toBe('800px');
    expect(p.video.style.height).toBe('400px');
    expect(p.video.style.top).toBe('200px');
    expect(p.video.style.background).toContain('rgb(0, 0, 0)');
  });

  it('shows a letterboxed sheet with the background instead of the screen', () => {
    const p = parts();
    showSheet(p, stage({ backgrounds: ['blackboard'] }), 2);
    expect(p.video.hidden).toBe(true);
    expect(p.page.hidden).toBe(false);
    expect(p.page.style.width).toBe('800px');
    expect(p.page.style.height).toBe('400px');
    expect(p.page.style.top).toBe('200px');
    expect(p.page.style.border).toContain('solid');
    showSheet(p, stage({ backgrounds: ['wall', 'wall', 'cork'] }), 2, 2);
    expect(p.page.style.border).toContain('rgb(139, 94, 52)');
  });
});

describe('the bitmap tiles of a sheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A browser that draws SVG into canvases: each tile becomes `blob:<its width>-<n>`. */
  function drawingBrowser(scale = 1) {
    const drawn: number[] = [];
    vi.stubGlobal('devicePixelRatio', scale);
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode = () => Promise.resolve();
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      drawn.push(this.width);
      return { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(new Blob([String(this.width)]));
    });
    let n = 0;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => `blob:${b.size}-${(n += 1)}`,
    });
    return drawn;
  }

  it('keeps the SVG tiles where nothing can be drawn into a canvas', async () => {
    expect(await bitmapBackground('blackboard')).toBeNull();
    const p = parts();
    showSheet(p, stage({ backgrounds: ['blackboard'] }), 2);
    await Promise.resolve();
    // (jsdom keeps no background images: the sizes tell the bitmaps from the SVG tiles.)
    expect(p.page.style.backgroundSize).toBe('');
    expect(BACKGROUND_STYLES.blackboard.background).toContain('data:image/svg+xml');
  });

  it('draws each tile once, at twice the screen scale (at most 4), and sizes it in CSS pixels', async () => {
    const drawn = drawingBrowser(2);
    const made = (await bitmapBackground('cork'))!;
    // Four tiles (300, 300, 500 and 300 CSS pixels) at 4 pixels each, under the colour.
    expect(drawn).toEqual([1200, 1200, 2000, 1200]);
    expect(made.background).toMatch(
      /^url\("blob:\d+-\d+"\), url\("blob:\d+-\d+"\), url\("blob:\d+-\d+"\), url\("blob:\d+-\d+"\), #bd9467$/,
    );
    expect(made.size).toBe('300px 300px, 300px 300px, 500px 500px, 300px 300px, auto');
    // Made once for the page.
    expect(await bitmapBackground('cork')).toBe(made);
    expect(drawn).toHaveLength(4);
  });

  it('shows the SVG tiles first, then the bitmaps if the sheet still shows that background', async () => {
    drawingBrowser(1);
    const p = parts();
    showSheet(p, stage({ backgrounds: ['wall'] }), 2);
    expect(p.page.style.backgroundSize).toBe('');
    await bitmapBackground('wall');
    await Promise.resolve();
    expect(p.page.style.backgroundSize).toBe('auto, 500px 500px, 300px 300px, auto');
    // The blend modes stay (the shorthand would reset them).
    expect(p.page.style.backgroundBlendMode).toBe(BACKGROUND_STYLES.wall.blend);
    // Shown again, the bitmaps are set at once.
    showSheet(p, stage({ backgrounds: ['wall'] }), 2);
    expect(p.page.style.backgroundSize).toBe('auto, 500px 500px, 300px 300px, auto');

    // A background changed before its bitmaps are made keeps the newer one.
    const q = parts();
    showSheet(q, stage({ backgrounds: ['whiteboard'] }), 2);
    showSheet(q, stage({ backgrounds: ['cork'] }), 2);
    await bitmapBackground('whiteboard');
    await Promise.resolve();
    expect(q.page.dataset.background).toBe('cork');
    expect(q.page.style.backgroundBlendMode).toBe(BACKGROUND_STYLES.cork.blend);
    expect(q.page.style.backgroundSize).not.toContain('240px');
  });
});
