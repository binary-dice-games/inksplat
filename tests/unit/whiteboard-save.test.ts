// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { createWhiteboard, frameAdapter } from '@inksplat/collab-whiteboard';
import type { ArrowItem, PreparedFile, Whiteboard } from '@inksplat/collab-whiteboard';
import { readBoardArchive, writeBoardArchive } from '../../viewer/src/board-archive';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

/** Stands in for the canvas work of the browser, which jsdom does not have. */
async function prepare(file: File): Promise<PreparedFile> {
  return {
    data: PNG,
    width: 320,
    height: 400,
    card: true,
    name: file.name,
    file: { name: file.name, mime: file.type || 'application/octet-stream', bytes: file.size },
    blob: file,
  };
}

/** The board file in a board zip (read with FileReader: jsdom's Blob has no arrayBuffer()). */
const throughZip = async (zip: Blob) =>
  readBoardArchive(
    await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(zip);
    }),
  );

const bytesOf = async (blob: Blob): Promise<string> =>
  await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new TextDecoder().decode(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

describe('saving a board', () => {
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
        random: () => 0.5,
      });
      boards.push(wb);
      return wb;
    };
    return {
      room,
      host,
      make,
      hostBoard: make(host),
      done: () => {
        boards.forEach((b) => b.destroy());
        room.close();
      },
    };
  }

  it('draws the frame as an SVG with everything needed to show it alone', async () => {
    const p = await party();
    try {
      const wb = p.hostBoard;
      wb.addNote({ x: 200, y: 200 }, 'idea'); // yours: it has a grip to resize it, not saved
      const a = wb.addPin({ x: 100, y: 100 })!;
      const b = wb.addPin({ x: 400, y: 120 })!;
      wb.addArrow(a, b);
      wb.addLink('https://example.com/page');
      (wb as unknown as { select(id: string): void }).select(a); // a selected item is drawn as any other
      const svg = wb.toSvg(undefined, {
        background: { background: '#f6f7f8' },
        backdrop: PNG,
      });
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
      const root = doc.documentElement;
      expect(root.getAttribute('viewBox')).toBe('0 0 1000 562.5');
      expect(root.querySelector('filter#wb-shadow')).toBeNull(); // shadows are shapes, not filters
      expect(root.querySelector('foreignObject div')?.getAttribute('style')).toContain(
        'background:#f6f7f8',
      );
      expect(root.querySelector('image')?.getAttribute('href')).toBe(PNG);
      expect(root.querySelectorAll('.item')).toHaveLength(5);
      expect(
        root.querySelector('.selected, .editing, .hit, [data-id]')?.outerHTML.slice(0, 120),
      ).toBeUndefined();
      expect(svg).toContain('idea');
      expect(svg).toContain('example.com');
      // Without the extras, only the items.
      const plain = wb.toSvg();
      expect(plain).not.toContain('foreignObject');
      expect(plain).not.toContain('<image href="data:image/png');
    } finally {
      p.done();
    }
  });

  it('falls back to the bounds of the items when there is no frame', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), {
      session: host,
      adapter: {
        transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        onChange: () => () => {},
      },
    });
    try {
      expect(wb.exportArea().width).toBe(1000); // nothing yet: a 16:9 frame
      wb.addPin({ x: 50, y: 60 });
      expect(wb.exportArea().width).toBeLessThan(100);
    } finally {
      wb.destroy();
      room.close();
    }
  });

  it('keeps a board in a file and carries on in another session, as its own', async () => {
    const p = await party();
    try {
      const wb = p.hostBoard;
      const file = await wb.addFile(
        new File(['hello shared file'], 'notes.txt', { type: 'text/plain' }),
        {
          x: 300,
          y: 150,
        },
      );
      const note = wb.addNote({ x: 200, y: 300 }, 'Remember')!;
      const pin = wb.addPin({ x: 500, y: 100 })!;
      const thread = wb.addArrow(note, pin)!;
      wb.addLink('https://example.com/');
      const saved = await wb.saveBoard({ background: 'cork' });
      expect(saved).toMatchObject({
        format: 'inksplat-board',
        version: 1,
        meta: { background: 'cork' },
      });
      expect(saved.items).toHaveLength(5);
      expect(saved.files.map((f) => f.id)).toEqual([file]);

      // Through a file (a zip), into a new session where somebody else is the host, and Ana joins.
      const zip = (await writeBoardArchive(saved)).blob;
      const room = new TestRoom();
      try {
        const host2 = await room.start();
        const stage2 = box(800, 450);
        const next = createWhiteboard(stage2, {
          session: host2,
          adapter: frameAdapter(stage2, () => 16 / 9),
          random: () => 0.5,
        });
        const ana = await room.join('Ana');
        await until(() => ana.host(), 'Ana reached the host');
        const anaStage = box(800, 450);
        const anaBoard = createWhiteboard(anaStage, {
          session: ana,
          adapter: frameAdapter(anaStage, () => 16 / 9),
        });
        const result = await next.loadBoard(await throughZip(zip));
        expect(result).toMatchObject({
          added: 5,
          skipped: 0,
          files: 1,
          meta: { background: 'cork' },
        });
        const items = next.items();
        expect(items).toHaveLength(5);
        expect(items.every((i) => i.author === host2.me.id)).toBe(true);
        expect(items.map((i) => i.kind).sort()).toEqual(['arrow', 'image', 'link', 'note', 'pin']);
        // The thread still ties the same note and pin, under their new ids.
        const arrow = items.find((i): i is ArrowItem => i.kind === 'arrow')!;
        expect(arrow.id).not.toBe(thread);
        expect(items.find((i) => i.id === arrow.from)?.kind).toBe('note');
        expect(items.find((i) => i.id === arrow.to)?.kind).toBe('pin');
        // The file is there again, and reaches the one who is in the session.
        const image = items.find((i) => i.kind === 'image')!;
        expect(await bytesOf(next.fileOf(image.id)!.blob)).toBe('hello shared file');
        await until(() => anaBoard.items().length === 5, 'Ana got the items');
        await until(() => anaBoard.fileOf(image.id), 'Ana got the file');
        expect(await bytesOf(anaBoard.fileOf(image.id)!.blob)).toBe('hello shared file');
        expect(anaBoard.fileOf(image.id)?.name).toBe('notes.txt');
        // Not an undo step: undo does nothing to what was loaded.
        next.undo();
        expect(next.items()).toHaveLength(5);
        // Loading it again adds it again (a copy).
        await next.loadBoard(await throughZip(zip));
        expect(next.items()).toHaveLength(10);
        anaBoard.destroy();
        next.destroy();
      } finally {
        room.close();
      }
    } finally {
      p.done();
    }
  });

  it('loads a file without its bytes as a picture, drops what is broken, and refuses other files', async () => {
    const p = await party();
    try {
      const wb = p.hostBoard;
      await wb.addFile(new File(['abc'], 'a.txt', { type: 'text/plain' }));
      wb.addNote({ x: 10, y: 10 }, 'n');
      const saved = await wb.saveBoard();
      const stripped = { ...saved, files: [] };
      const broken = {
        ...saved,
        items: [...saved.items, { kind: 'note', id: 'x.1', author: 'x', stamp: [1, 'x'] }, 42],
      };
      const second = p.make(await p.room.join('Ben'));
      const r1 = await second.loadBoard(stripped);
      expect(r1).toMatchObject({ added: 2, files: 0 });
      const image = second.items().find((i) => i.kind === 'image')!;
      expect(second.fileOf(image.id)?.name).toBe('picture.png'); // only the preview
      expect('file' in image).toBe(false);
      const r2 = await second.loadBoard(broken);
      expect(r2).toMatchObject({ added: 2, skipped: 2, files: 1 });
      await expect(second.loadBoard({ format: 'other', version: 1, items: [] })).rejects.toThrow(
        /not an inksplat board/,
      );
      await expect(second.loadBoard(null)).rejects.toThrow(/not an inksplat board/);
      second.readOnly = true;
      await expect(second.loadBoard(saved)).rejects.toThrow(/locked/);
    } finally {
      p.done();
    }
  });

  it('saves the files as bytes, and loads them back from a zip with the canvases', async () => {
    const p = await party();
    try {
      const wb = p.hostBoard;
      await wb.addFile(new File(['zip me'], 'z.txt', { type: 'text/plain' }));
      wb.setPage(2);
      wb.addNote({ x: 10, y: 10 }, 'on canvas 3');
      const saved = await wb.saveBoard();
      expect(saved.files).toHaveLength(1);
      expect(saved.files[0]!.data).toBeInstanceOf(Uint8Array);
      const board = await throughZip((await writeBoardArchive(saved)).blob);
      const second = p.make(await p.room.join('Zed'));
      expect(await second.loadBoard(board)).toMatchObject({ added: 2, files: 1 });
      const image = second.items().find((i) => i.kind === 'image')!;
      expect(await bytesOf(second.fileOf(image.id)!.blob)).toBe('zip me');
      const note = second.items().find((i) => i.kind === 'note')!;
      expect((note as { page?: number }).page).toBe(2);
    } finally {
      p.done();
    }
  });

  it('keeps a guest under the host limit of operations when loading a big board', async () => {
    const p = await party();
    try {
      const big = {
        format: 'inksplat-board',
        version: 1,
        saved: '',
        meta: {},
        files: [],
        items: Array.from({ length: 90 }, (_, i) => ({
          kind: 'pin',
          id: `old.${i}`,
          author: 'old',
          stamp: [i + 1, 'old'],
          x: i,
          y: 5,
          color: '#e5484d',
        })),
      };
      const guest = p.make(await p.room.join('Gus'));
      await until(() => p.host.peers().length === 2, 'roster');
      const result = await guest.loadBoard(big);
      expect(result.added).toBe(90);
      expect(guest.items()).toHaveLength(90); // at once here
      // The first batch goes out now, the rest a second later: 40, then 40, then 10.
      await until(() => p.hostBoard.items().length >= 40, 'the first batch');
      expect(p.hostBoard.items().length).toBeLessThan(90);
      await until(() => p.hostBoard.items().length === 90, 'all of it', 6000);
    } finally {
      p.done();
    }
  });
});
