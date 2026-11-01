// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIMITS,
  cleanFileInfo,
  cleanItem,
  WhiteboardError,
  createWhiteboard,
  drawingGate,
  frameAdapter,
} from '@inksplat/collab-whiteboard';
import type { PreparedFile } from '@inksplat/collab-whiteboard';
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

describe('file info', () => {
  it('keeps a valid description and makes the name safe as a file name', () => {
    expect(cleanFileInfo({ name: 'plan.pdf', mime: 'application/pdf', bytes: 10 })).toEqual({
      name: 'plan.pdf',
      mime: 'application/pdf',
      bytes: 10,
    });
    expect(
      cleanFileInfo({ name: '../a:b\\c\u0007.zip', mime: 'application/zip', bytes: 1 }),
    ).toEqual({
      name: '.._a_b_c_.zip',
      mime: 'application/zip',
      bytes: 1,
    });
  });

  it('refuses a bad description', () => {
    const ok = { name: 'a.txt', mime: 'text/plain', bytes: 1 };
    expect(cleanFileInfo(null)).toBeNull();
    expect(cleanFileInfo({ ...ok, name: '   ' })).toBeNull();
    expect(cleanFileInfo({ ...ok, mime: 'text/plain; x=1' })).toBeNull();
    expect(cleanFileInfo({ ...ok, mime: 'javascript' })).toBeNull();
    expect(cleanFileInfo({ ...ok, bytes: LIMITS.fileBytes + 1 })).toBeNull();
    expect(cleanFileInfo({ ...ok, bytes: 1.5 })).toBeNull();
    expect(cleanFileInfo({ ...ok, bytes: -1 })).toBeNull();
  });

  it('keeps the file on a picture item and drops a bad one without losing the picture', () => {
    const image = {
      id: 'a.1',
      author: 'a',
      stamp: [1, 'a'],
      kind: 'image',
      x: 0,
      y: 0,
      size: 100,
      ratio: 1.25,
      data: PNG,
    };
    const file = { name: 'a.txt', mime: 'text/plain', bytes: 3 };
    expect(cleanItem({ ...image, file })).toMatchObject({ file });
    expect(cleanItem({ ...image, file: { ...file, bytes: -2 } })).not.toHaveProperty('file');
    expect(cleanItem(image)).not.toHaveProperty('file');
  });

  it('lets only small, well formed file messages through the host gate', () => {
    const gate = drawingGate(() => true);
    expect(gate('wb', { t: 'file', id: 'a.1', data: 'aGVsbG8=' }, 'g')).toBe(true);
    expect(gate('wb', { t: 'file', id: 'a.1', data: 'A'.repeat(LIMITS.fileBytes * 2) }, 'g')).toBe(
      false,
    );
    expect(gate('wb', { t: 'file', data: 'aGVsbG8=' }, 'g')).toBe(false);
    expect(gate('wb', { t: 'file', id: 'a.1', data: 5 }, 'g')).toBe(false);
    expect(drawingGate(() => false)('wb', { t: 'file', id: 'a.1', data: 'aGVsbG8=' }, 'g')).toBe(
      false,
    );
  });
});

describe('files pinned on the board', () => {
  const created: string[] = [];
  beforeEach(() => {
    URL.createObjectURL = () => {
      created.push('blob:test');
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
  });
  afterEach(() => {
    created.length = 0;
  });

  async function party() {
    const room = new TestRoom();
    const host = await room.start();
    const sides: { destroy(): void }[] = [];
    const make = (session: typeof host) => {
      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session,
        adapter: frameAdapter(stage, () => 16 / 9),
        prepareFile: prepare,
      });
      sides.push(wb);
      return wb;
    };
    const hostBoard = make(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'Ana reached the host');
    const anaBoard = make(ana);
    const ben = await room.join('Ben');
    await until(() => ben.host(), 'Ben reached the host');
    const benBoard = make(ben);
    await until(() => host.peers().length === 3, 'roster');
    return {
      room,
      ana,
      ben,
      make,
      hostBoard,
      anaBoard,
      benBoard,
      done: () => {
        sides.forEach((s) => s.destroy());
        room.close();
      },
    };
  }

  const proxies = (wb: { element: HTMLElement }) =>
    wb.element.shadowRoot!.querySelectorAll('.drag .proxy');

  it('sends the file to everyone, and others drag out a copy', async () => {
    const p = await party();
    try {
      const id = await p.anaBoard.addFile(
        new File(['hello world'], 'notes.txt', { type: 'text/plain' }),
        {
          x: 200,
          y: 150,
        },
      );
      expect(id).not.toBeNull();
      for (const wb of [p.hostBoard, p.benBoard]) {
        await until(() => wb.fileOf(id!), 'the file arrived');
        expect(wb.fileOf(id!)).toMatchObject({ name: 'notes.txt', mime: 'text/plain' });
        expect(wb.fileOf(id!)?.blob.size).toBe(11);
      }

      // Everybody gets a box to drag a copy from (it takes the pointer only while Shift is held).
      expect(proxies(p.benBoard)).toHaveLength(1);
      expect(proxies(p.hostBoard)).toHaveLength(1);
      expect(proxies(p.anaBoard)).toHaveLength(1);

      const add = vi.fn();
      const setData = vi.fn();
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(drag, 'dataTransfer', {
        value: { items: { add }, setData, setDragImage: () => {}, effectAllowed: '' },
      });
      proxies(p.benBoard)[0]!.dispatchEvent(drag);
      expect(drag.defaultPrevented).toBe(false);
      expect((add.mock.calls[0]?.[0] as File).name).toBe('notes.txt');
      expect(setData).toHaveBeenCalledWith('DownloadURL', 'text/plain:notes.txt:blob:test');
    } finally {
      p.done();
    }
  });

  it('shows a pinned print: a border, a shadow and a pin', async () => {
    const p = await party();
    try {
      await p.anaBoard.addFile(new File(['x'], 'a.txt', { type: 'text/plain' }));
      await until(() => p.benBoard.element.shadowRoot!.querySelector('.item.image-item'), 'item');
      const item = p.benBoard.element.shadowRoot!.querySelector('.item.image-item')!;
      expect(item.querySelector('rect.paper')?.getAttribute('fill')).toBe('#ffffff');
      // The shadow: the same shape in see-through black under it, offset, with no filter (a blur
      // was drawn again at every step of a zoom).
      const shadow = item.querySelector<SVGGElement>('g.shadow')!;
      expect(shadow.getAttribute('transform')).toBe('translate(1.5 3)');
      expect(shadow.querySelector('rect')?.getAttribute('fill')).toBe('rgba(0,0,0,0.2)');
      expect(shadow.compareDocumentPosition(item.querySelector('rect.paper')!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(item.querySelector('[filter]')).toBeNull();
      expect(item.querySelectorAll('.pin circle')).toHaveLength(3); // what catches the pointer, the pin, its highlight
      expect(item.querySelector('ellipse')).not.toBeNull(); // the shadow of the pin
      expect(p.benBoard.element.shadowRoot!.querySelector('filter#wb-shadow')).toBeNull();
      expect(p.benBoard.toSvg()).toContain('class="shadow"');
    } finally {
      p.done();
    }
  });

  it('gives the file to whoever joins later, and drops it with the item', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(
        new File(['zip!'], 'a.zip', { type: 'application/zip' }),
      ))!;
      await until(() => p.hostBoard.fileOf(id), 'host has it');
      const cat = await p.room.join('Cat');
      await until(() => cat.host(), 'Cat reached the host');
      const late = p.make(cat);
      await until(() => late.fileOf(id), 'Cat has the file');
      expect(late.fileOf(id)?.blob.size).toBe(4);
      late.destroy();
    } finally {
      p.done();
    }
  });

  it('gives the picture when no file was sent, and refuses a drag while the file arrives', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(new File(['x'], 'x.png', { type: 'image/png' })))!;
      expect(id).not.toBeNull();
      // A picture without a file (too big to send): the file is the picture itself.
      p.anaBoard.load({
        v: 1,
        clock: 99,
        clear: [0, ''],
        items: [
          {
            id: `${p.ana.me.id}.99`,
            author: p.ana.me.id,
            stamp: [99, p.ana.me.id],
            kind: 'image',
            x: 5,
            y: 5,
            size: 60,
            ratio: 1,
            data: PNG,
          },
        ],
      });
      await until(() => p.benBoard.fileOf(`${p.ana.me.id}.99`), 'picture on Ben');
      expect(p.benBoard.fileOf(`${p.ana.me.id}.99`)).toMatchObject({
        name: 'picture.png',
        mime: 'image/png',
      });

      // An item whose file has not arrived cannot be dragged yet.
      const missing = `${p.ana.me.id}.98`;
      p.anaBoard.load({
        v: 1,
        clock: 100,
        clear: [0, ''],
        items: [
          {
            id: missing,
            author: p.ana.me.id,
            stamp: [100, p.ana.me.id],
            kind: 'image',
            x: 5,
            y: 5,
            size: 60,
            ratio: 1,
            data: PNG,
            file: { name: 'late.pdf', mime: 'application/pdf', bytes: 5 },
          },
        ],
      });
      await until(() => p.benBoard.items().some((i) => i.id === missing), 'item on Ben');
      expect(p.benBoard.fileOf(missing)).toBeNull();
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(drag, 'dataTransfer', { value: { items: { add: vi.fn() } } });
      const boxes = [...proxies(p.benBoard)];
      boxes.forEach((b) => b.dispatchEvent(drag));
      expect(drag.defaultPrevented).toBe(true);
    } finally {
      p.done();
    }
  });

  it('accepts a file only from its author, and only as long as the item says', async () => {
    const p = await party();
    try {
      const id = `${p.ana.me.id}.7`;
      p.anaBoard.load({
        v: 1,
        clock: 7,
        clear: [0, ''],
        items: [
          {
            id,
            author: p.ana.me.id,
            stamp: [7, p.ana.me.id],
            kind: 'image',
            x: 5,
            y: 5,
            size: 60,
            ratio: 1,
            data: PNG,
            file: { name: 'five.txt', mime: 'text/plain', bytes: 5 },
          },
        ],
      });
      await until(() => p.benBoard.items().length === 1, 'item on Ben');

      // Ben cannot supply Ana's file, nor can anybody make it the wrong length.
      p.ben.channel('wb').send({ t: 'file', id, data: btoa('hello') });
      p.ana.channel('wb').send({ t: 'file', id, data: btoa('hi') });
      p.ana.channel('wb').send({ t: 'file', id, data: '!!!not base64!!!' });
      await new Promise((r) => setTimeout(r, 150));
      expect(p.hostBoard.fileOf(id)).toBeNull();
      expect(p.benBoard.fileOf(id)).toBeNull();

      p.ana.channel('wb').send({ t: 'file', id, data: btoa('hello') });
      await until(() => p.benBoard.fileOf(id), 'the right file');
      expect(p.benBoard.fileOf(id)?.blob.size).toBe(5);
      expect(p.hostBoard.fileOf(id)?.blob.size).toBe(5);
    } finally {
      p.done();
    }
  });

  it('turns a drop of several files into items and reports a refused one', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session: host,
        adapter: frameAdapter(stage, () => 16 / 9),
        prepareFile: async (file) => {
          if (file.name === 'big.iso') {
            throw new WhiteboardError('big.iso is too large to share');
          }
          return prepare(file);
        },
      });
      const errors: string[] = [];
      wb.on('error', (e) => errors.push(e.message));
      const drop = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 40,
      });
      Object.defineProperty(drop, 'dataTransfer', {
        value: {
          types: ['Files'],
          files: [
            new File(['a'], 'a.txt'),
            new File(['b'], 'b.zip'),
            new File(['i'], 'big.iso'),
            new File(['c'], 'c.docx'),
          ],
        },
      });
      stage.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      await until(() => wb.items().length === 3, 'three items');
      expect(wb.items().map((i) => (i.kind === 'image' ? i.file?.name : ''))).toEqual([
        'a.txt',
        'b.zip',
        'c.docx',
      ]);
      await until(() => errors.length === 1, 'the refusal');
      expect(errors).toEqual(['big.iso is too large to share']);
      wb.destroy();
    } finally {
      room.close();
    }
  });
});

describe('moving and copying out pictures and files', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), {
      session: host,
      adapter: {
        transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        onChange: () => () => {},
      },
    });
    const root = wb.element.shadowRoot!;
    wb.load({
      v: 1,
      clock: 1,
      clear: [0, ''],
      items: [
        {
          id: 'other.1',
          author: 'other',
          stamp: [1, 'other'],
          kind: 'image',
          x: 200,
          y: 200,
          size: 100,
          ratio: 0.5,
          data: PNG,
        },
      ],
    });
    Object.defineProperty(root, 'elementsFromPoint', {
      value: () => [root.querySelector('.item')].filter(Boolean),
    });
    const board = root.querySelector('svg')!;
    const fire = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
      board.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }),
      );
    return { room, wb, root, fire };
  }

  it('moves with a plain drag, whoever pinned it, and has a corner to resize it', async () => {
    const t = await mount();
    try {
      expect(t.root.querySelector('.image-item .grip')).not.toBeNull();
      t.fire('pointerdown', 200, 200);
      t.fire('pointermove', 250, 260);
      t.fire('pointerup', 250, 260);
      expect(t.wb.items()[0]).toMatchObject({ x: 250, y: 260, size: 100 });
      // Shift does not scale it (that copies it out): it only moves.
      t.fire('pointerdown', 250, 260, { shiftKey: true });
      t.fire('pointermove', 300, 260, { shiftKey: true });
      t.fire('pointerup', 300, 260, { shiftKey: true });
      expect(t.wb.items()[0]).toMatchObject({ size: 100 });
      // The bottom right corner (at 350, 285) resizes it, keeping its proportions and top left.
      t.fire('pointerdown', 345, 280);
      t.fire('pointermove', 450, 300);
      t.fire('pointerup', 450, 300);
      const image = t.wb.items()[0] as { x: number; y: number; size: number; ratio: number };
      expect(image.ratio).toBe(0.5);
      expect(image.size).toBeCloseTo(209, 0); // the grip follows the pointer at 450
      expect(image.x - image.size / 2).toBeCloseTo(250, 0); // the left edge stays
      expect(image.y - (image.size * image.ratio) / 2).toBeCloseTo(235, 0);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is copied out only while Shift is held: the box over it takes the pointer then', async () => {
    const t = await mount();
    try {
      const layer = t.root.querySelector('.drag')!;
      expect(layer.classList.contains('shift')).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
      expect(layer.classList.contains('shift')).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
      expect(layer.classList.contains('shift')).toBe(false);
      // The pointer knows too (Shift pressed before the page had the focus).
      t.root.host.parentElement!.dispatchEvent(
        new MouseEvent('pointermove', { shiftKey: true, bubbles: true }),
      );
      expect(layer.classList.contains('shift')).toBe(true);
      t.root.host.parentElement!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
      expect(layer.classList.contains('shift')).toBe(false);
      expect(t.root.querySelector('.proxy')).not.toBeNull();
      expect(t.root.querySelector('.image-item title')?.textContent).toContain('Shift+drag');
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });
});
