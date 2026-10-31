// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanItem,
  createWhiteboard,
  fileToImageData,
  frameAdapter,
  hasTransparency,
  isGif,
} from '@inksplat/collab-whiteboard';
import type { PreparedFile, Whiteboard } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const GIF_BYTES = 'GIF89a-frames';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

/** Stands in for the canvas work of the browser: a picture, cut out when its name says so. */
async function prepare(file: File): Promise<PreparedFile> {
  return {
    data: PNG,
    width: 200,
    height: 100,
    name: file.name,
    ...(file.name.includes('cutout') ? { cutout: true } : {}),
    file: { name: file.name, mime: file.type || 'application/octet-stream', bytes: file.size },
    blob: file,
  };
}

describe('picture checks', () => {
  it('finds transparent parts only when there are enough of them', () => {
    const opaque = new Uint8ClampedArray(4 * 2000).fill(255);
    expect(hasTransparency(opaque)).toBe(false);
    const one = opaque.slice();
    one[3] = 0; // a single pixel in 2000 (under 0.1%)
    expect(hasTransparency(one)).toBe(false);
    const some = opaque.slice();
    some[3] = 0;
    some[7] = 100;
    expect(hasTransparency(some)).toBe(true);
  });

  it('knows a GIF by its first bytes', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(isGif(enc('GIF89a...'))).toBe(true);
    expect(isGif(enc('GIF87a'))).toBe(true);
    expect(isGif(enc('GIF8'))).toBe(false);
    expect(isGif(enc('\x89PNG\r\n'))).toBe(false);
  });

  it('keeps the cutout mark on a picture item, and only as true', () => {
    const image = {
      id: 'a.1',
      author: 'a',
      stamp: [1, 'a'],
      kind: 'image',
      x: 0,
      y: 0,
      size: 100,
      ratio: 1,
      data: PNG,
    };
    expect(cleanItem({ ...image, cutout: true })).toMatchObject({ cutout: true });
    expect(cleanItem({ ...image, cutout: 'yes' })).not.toHaveProperty('cutout');
    expect(cleanItem(image)).not.toHaveProperty('cutout');
  });
});

describe('reading a picture file', () => {
  let alpha = 255;
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('createImageBitmap', async () => ({ width: 40, height: 20, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return {
        drawImage: () => {},
        fillRect: () => calls.push('fill'),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(4 * w * h).fill(alpha),
        }),
      } as unknown as CanvasRenderingContext2D;
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      (type?: string) => `data:${type};base64,AAAA`,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps transparency as a PNG and marks the picture as a cutout', async () => {
    alpha = 0;
    const r = await fileToImageData(new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(r).toMatchObject({ data: 'data:image/png;base64,AAAA', cutout: true });
    expect(calls).not.toContain('fill');
  });

  it('puts an opaque picture on white as a JPEG, not a cutout', async () => {
    alpha = 255;
    const r = await fileToImageData(new File(['x'], 'a.webp', { type: 'image/webp' }));
    expect(r.data).toBe('data:image/jpeg;base64,AAAA');
    expect(r).not.toHaveProperty('cutout');
    expect(calls).toContain('fill');
  });
});

describe('pictures on the board', () => {
  const revoked: string[] = [];
  let made = 0;
  beforeEach(() => {
    URL.createObjectURL = () => `blob:test-${++made}`;
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
  });
  afterEach(() => {
    revoked.length = 0;
  });

  async function party() {
    const room = new TestRoom();
    const host = await room.start();
    const boards: Whiteboard[] = [];
    const make = (session: typeof host) => {
      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session,
        adapter: frameAdapter(stage, () => 16 / 9),
        prepareFile: prepare,
      });
      boards.push(wb);
      return wb;
    };
    const hostBoard = make(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'Ana reached the host');
    const anaBoard = make(ana);
    await until(() => host.peers().length === 2, 'roster');
    return {
      hostBoard,
      anaBoard,
      done: () => {
        boards.forEach((b) => b.destroy());
        room.close();
      },
    };
  }

  const imageOf = (wb: Whiteboard, id: string) =>
    wb.element.shadowRoot!.querySelector(`.item[data-id="${id}"] image`);

  it('draws a GIF from its file, animated, once the file is here; saves its still', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(
        new File([GIF_BYTES], 'dance.gif', { type: 'image/gif' }),
      ))!;
      for (const wb of [p.anaBoard, p.hostBoard]) {
        await until(
          () => imageOf(wb, id)?.getAttribute('href')?.startsWith('blob:test-'),
          'the GIF is drawn from its file',
        );
        expect(wb.toSvg()).toContain(PNG); // a blob address means nothing outside the page
        expect(wb.toSvg()).not.toContain('blob:');
      }
      const url = imageOf(p.hostBoard, id)!.getAttribute('href')!;
      p.anaBoard.undo(); // takes the picture away
      await until(() => revoked.includes(url), 'the address is let go with the item');
    } finally {
      p.done();
    }
  });

  it('draws other pictures from their preview', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(new File(['png'], 'a.png', { type: 'image/png' })))!;
      await until(() => p.hostBoard.fileOf(id), 'the file arrived');
      expect(imageOf(p.hostBoard, id)?.getAttribute('href')).toBe(PNG);
    } finally {
      p.done();
    }
  });

  it('draws a cutout with its border and shadow around what shows', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(new File(['x'], 'cutout.png', { type: 'image/png' })))!;
      await until(() => imageOf(p.hostBoard, id), 'item');
      const item = p.hostBoard.element.shadowRoot!.querySelector(`.item[data-id="${id}"]`)!;
      expect(item.querySelector('.paper')).toBeNull(); // no white rectangle
      expect(item.querySelector('g[filter="url(#wb-shadow)"]')).not.toBeNull();
      const filter = item.querySelector(`filter[id="wb-cut-${id}"]`)!;
      expect(filter).not.toBeNull();
      expect(filter.querySelectorAll('feMorphology')).toHaveLength(2);
      expect(filter.querySelector('.cut-edge')).not.toBeNull();
      expect(imageOf(p.hostBoard, id)?.getAttribute('filter')).toBe(`url(#wb-cut-${id})`);
      expect(item.querySelector('rect.hit.box')).not.toBeNull(); // grabbed anywhere, as a print
      expect(item.querySelectorAll('.pin circle')).toHaveLength(3);

      const svg = p.hostBoard.toSvg();
      expect(svg).toContain(`wb-cut-${id}`);
      expect(svg).not.toContain('hit box');
    } finally {
      p.done();
    }
  });
});
