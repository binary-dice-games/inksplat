// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { cleanItem, createWhiteboard } from '@inksplat/collab-whiteboard';
import type { NoteItem } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

/** Units are CSS pixels: a pointer at (x, y) is at (x, y) on the board. */
const identity = {
  transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  onChange: () => () => {},
};

function pointer(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

/** Sets a note's width, for tests whose positions assume a note of that size. */
function resize(wb: unknown, id: string, size: number): void {
  const inner = wb as {
    local(f: () => unknown): unknown;
    model: { change(i: string, f: object): unknown };
  };
  inner.local(() => inner.model.change(id, { size }));
}

function keydown(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };
const note = {
  ...base,
  kind: 'note',
  x: 100,
  y: 100,
  size: 180,
  ratio: 1,
  text: 'Hi',
  color: '#ffe9a8',
};

/** The parts of the board these tests look at. */
interface Inside {
  tool: string;
  style: { color: string };
}

describe('sticky note items', () => {
  it('keeps a good note, even an empty one, and nothing it should not', () => {
    expect(cleanItem(note)).toMatchObject({ kind: 'note', text: 'Hi', color: '#ffe9a8' });
    expect(cleanItem({ ...note, text: '', rot: 4 })).toMatchObject({ text: '', rot: 4 });
    expect(cleanItem({ ...note, extra: 1 })).not.toHaveProperty('extra');
    expect(cleanItem({ ...note, size: 10 })).toBeNull();
    expect(cleanItem({ ...note, size: 700 })).toBeNull();
    expect(cleanItem({ ...note, ratio: 9 })).toBeNull();
    expect(cleanItem({ ...note, color: 'red' })).toBeNull();
    expect(cleanItem({ ...note, text: 'x'.repeat(501) })).toBeNull();
    expect(cleanItem({ ...note, text: 5 })).toBeNull();
  });
});

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

describe('sticky notes on the board', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const stage = box(800, 450);
    const wb = createWhiteboard(stage, { session: host, adapter: identity, random: () => 0.5 });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    const node = () => root.querySelector('.item')!;
    // jsdom has no hit testing: the note is under the pointer.
    Object.defineProperty(root, 'elementsFromPoint', { value: () => [node()].filter(Boolean) });
    return { room, host, stage, wb, root, board, node };
  }

  it('is a tool after the eraser, before the colour', async () => {
    const t = await mount();
    try {
      keydown('6');
      expect((t.wb as unknown as Inside).tool).toBe('note');
      const color = (t.wb as unknown as Inside).style.color;
      keydown('9');
      expect((t.wb as unknown as Inside).tool).toBe('note');
      expect((t.wb as unknown as Inside).style.color).not.toBe(color);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is made with a click, written in a text box, and kept when it is left', async () => {
    const t = await mount();
    try {
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 200, 150);
      pointer(t.board, 'pointerup', 200, 150);
      expect((t.wb as unknown as Inside).tool).toBe('pointer');
      expect(t.wb.items()).toMatchObject([{ kind: 'note', x: 200, y: 150, text: '', size: 90 }]); // half the width of earlier versions
      const ta = t.root.querySelector('textarea.sticky') as HTMLTextAreaElement;
      expect(ta).not.toBeNull();
      const text = 'Buy milk\nand a very long line of words that has to wrap around';
      ta.value = text;
      ta.dispatchEvent(new Event('blur'));
      expect(t.root.querySelector('textarea')).toBeNull();
      const item = t.wb.items()[0]!;
      expect(item).toMatchObject({ text });
      // The text is drawn in lines inside the paper, and the pin is there for what comes later.
      expect(t.node().querySelectorAll('tspan').length).toBeGreaterThan(2);
      expect(t.node().querySelector('.pin circle')).not.toBeNull();
      expect(t.node().querySelector('.pin')?.getAttribute('data-id')).toBe(item.id);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is dragged out to the bounds wanted, from the corner where the press was', async () => {
    const t = await mount();
    try {
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 250, 160);
      const outline = t.root.querySelector('.live rect.note-outline');
      expect(outline?.getAttribute('width')).toBe('150'); // where the note will be, as it is dragged
      expect(outline?.getAttribute('height')).toBe('60');
      pointer(t.board, 'pointerup', 300, 200);
      expect(t.root.querySelector('.live rect.note-outline')).toBeNull();
      expect((t.wb as unknown as Inside).tool).toBe('pointer');
      const n = t.wb.items()[0] as NoteItem;
      expect(n).toMatchObject({ kind: 'note', x: 200, y: 150, size: 200, ratio: 0.5 });
      expect(n.rot).toBeUndefined(); // straight, the way it was drawn
      expect(t.root.querySelector('textarea.sticky')).not.toBeNull(); // and written at once
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is made on another note with a click or a drag, attached to it, not grabbing it', async () => {
    const t = await mount();
    try {
      const under = t.wb.addNote({ x: 200, y: 150 }, 'under')!;
      resize(t.wb, under, 180);
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 200, 150);
      pointer(t.board, 'pointerup', 200, 150);
      expect(t.wb.items()).toHaveLength(2);
      const [first, made] = t.wb.items() as NoteItem[];
      expect(first).toMatchObject({ id: under, x: 200, y: 150 }); // not moved
      expect(made).toMatchObject({ kind: 'note', x: 200, y: 150, on: under });
      expect(t.root.querySelector('textarea.sticky')).not.toBeNull(); // the new one is written

      t.root.querySelector('textarea.sticky')!.dispatchEvent(new Event('blur'));
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 150, 100);
      pointer(t.board, 'pointermove', 260, 180);
      pointer(t.board, 'pointerup', 260, 180);
      const all = t.wb.items() as NoteItem[];
      expect(all).toHaveLength(3);
      expect(all[0]).toMatchObject({ id: under, x: 200, y: 150, size: 180 }); // neither moved nor resized
      expect(all[2]).toMatchObject({ kind: 'note', size: 110, on: under });
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is put on nothing when made on an empty spot', async () => {
    const t = await mount();
    try {
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 200, 150);
      pointer(t.board, 'pointerup', 200, 150);
      expect(t.wb.items()[0]).not.toHaveProperty('on');
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is at least the smallest note when dragged out too small, in any direction', async () => {
    const t = await mount();
    try {
      // Up and to the left: the note grows from the press that way.
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 500, 400);
      pointer(t.board, 'pointermove', 490, 395);
      pointer(t.board, 'pointerup', 490, 395);
      const m = t.wb.items()[0] as NoteItem;
      expect(m).toMatchObject({ size: 60, ratio: 0.3 });
      expect(m.x).toBeCloseTo(470);
      expect(m.y).toBeCloseTo(391);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is given the bounds asked for, within the limits of a note', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 300, y: 200 }, 'big', { width: 900, height: 300 });
      t.wb.addNote({ x: 300, y: 200 }, 'tall', { width: 100, height: 400 });
      expect(t.wb.items()).toMatchObject([
        { size: 600, ratio: 0.5 },
        { size: 100, ratio: 3 },
      ]);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is edited by a click, and Escape drops the change', async () => {
    const t = await mount();
    try {
      const id = t.wb.addNote({ x: 100, y: 100 }, 'first')!;
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointerup', 100, 100);
      const ta = t.root.querySelector('textarea.sticky') as HTMLTextAreaElement;
      expect(ta.value).toBe('first');
      ta.value = 'second';
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(t.wb.items()[0]).toMatchObject({ id, text: 'first' });

      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointerup', 100, 100);
      const again = t.root.querySelector('textarea.sticky') as HTMLTextAreaElement;
      again.value = 'third';
      again.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
      expect(t.wb.items()[0]).toMatchObject({ text: 'third' });
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('moves when dragged and resizes from its corner, keeping the top left corner', async () => {
    const t = await mount();
    try {
      resize(t.wb, t.wb.addNote({ x: 100, y: 100 }, 'note')!, 180);
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 130, 140);
      pointer(t.board, 'pointerup', 130, 140);
      expect(t.wb.items()[0]).toMatchObject({ x: 130, y: 140, size: 180 });
      expect(t.root.querySelector('textarea')).toBeNull(); // a drag does not start editing

      // Selected by the drag, it shows its grip on its bottom right corner, at (220, 230); the
      // pointer takes it to (255, 245).
      pointer(t.board, 'pointerdown', 218, 228);
      pointer(t.board, 'pointermove', 255, 245);
      pointer(t.board, 'pointerup', 255, 245);
      const n = t.wb.items()[0] as NoteItem;
      expect(n).toMatchObject({ size: 215, ratio: 0.907 }); // the grip follows the pointer
      expect(n.x - 215 / 2).toBeCloseTo(40, 0); // the top left corner stays at (40, 50)
      expect(n.y - 195 / 2).toBeCloseTo(50, 0);
      expect(t.root.querySelector('textarea')).toBeNull();
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is removed by selecting it and pressing Delete, not with the right button', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 100, y: 100 }, 'bye');
      pointer(t.board, 'contextmenu', 100, 100);
      expect(t.wb.items()).toHaveLength(1);
      keydown('1'); // the pointer, in hand already: 1 only confirms it
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointerup', 100, 100);
      // A click writes in the note; once the writing ends the note stays selected.
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      keydown('Delete');
      expect(t.wb.items()).toHaveLength(0);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is changed by others unless locked, and then they can only copy it', async () => {
    const t = await mount();
    try {
      const copied: string[] = [];
      const ana = await t.room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaBoard = createWhiteboard(box(800, 450), {
        session: ana,
        adapter: identity,
        copyText: async (text) => {
          copied.push(text);
          return true;
        },
      });
      const id = t.wb.addNote({ x: 100, y: 100 }, 'Shared text\nsecond line')!;
      await until(() => anaBoard.items().length === 1, 'the note arrived');
      const root = anaBoard.element.shadowRoot!;
      Object.defineProperty(root, 'elementsFromPoint', {
        value: () => [root.querySelector('.item')].filter(Boolean),
      });
      const board = root.querySelector('svg')!;
      // Open to everybody by default: Ana can move it and edit it.
      expect(root.querySelector('.grip')).not.toBeNull();
      pointer(board, 'pointerdown', 100, 100);
      pointer(board, 'pointermove', 150, 150);
      pointer(board, 'pointerup', 150, 150);
      expect(anaBoard.items()[0]).toMatchObject({ x: 150, y: 150 });
      pointer(board, 'pointerdown', 150, 150);
      pointer(board, 'pointerup', 150, 150);
      expect(root.querySelector('textarea.sticky')).not.toBeNull();
      root.querySelector('textarea')!.dispatchEvent(new Event('blur'));

      // The owner locks it: Ana cannot move or edit it, and sees no grip; she can copy it.
      const owner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      await until(() => (t.wb.items()[0] as { x: number }).x === 150, 'the move reached the owner');
      owner.local(() => owner.model.change(id, { lock: 'owner' }));
      await until(
        () => (anaBoard.items()[0] as { lock?: string }).lock === 'owner',
        'the lock arrived',
      );
      expect(root.querySelector('.grip')).toBeNull();
      pointer(board, 'pointerdown', 150, 150);
      pointer(board, 'pointermove', 200, 200);
      pointer(board, 'pointerup', 200, 200);
      expect(anaBoard.items()[0]).toMatchObject({ x: 150, y: 150 });
      expect(root.querySelector('textarea')).toBeNull();
      pointer(board, 'dblclick', 100, 100);
      await until(() => copied.length === 1, 'the text was copied');
      expect(copied).toEqual(['Shared text\nsecond line']);
      await until(() => (root.textContent ?? '').includes('Note copied'), 'the message');
      anaBoard.destroy();
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('does nothing on a read-only board', async () => {
    const t = await mount();
    try {
      t.wb.readOnly = true;
      expect(t.wb.addNote()).toBeNull();
      expect(t.wb.items()).toHaveLength(0);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });
});

describe('the text box of a note being written', () => {
  it('follows the note when it is moved, resized or turned', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), {
      session: host,
      adapter: identity,
      random: () => 0.5,
    });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    Object.defineProperty(root, 'elementsFromPoint', {
      value: () => [root.querySelector('.item')].filter(Boolean),
    });
    try {
      resize(wb, wb.addNote({ x: 200, y: 200 }, 'writing')!, 180);
      pointer(board, 'pointerdown', 200, 200);
      pointer(board, 'pointerup', 200, 200);
      const ta = root.querySelector<HTMLTextAreaElement>('textarea.sticky')!;
      const at = () => ({
        left: Math.round(parseFloat(ta.style.left)),
        top: Math.round(parseFloat(ta.style.top)),
        width: Math.round(parseFloat(ta.style.width)),
        height: Math.round(parseFloat(ta.style.height)),
      });
      expect(at()).toEqual({ left: 110, top: 110, width: 180, height: 180 });

      // Dragged: the box goes along while the button is down, and stays where the note lands.
      pointer(board, 'pointerdown', 200, 200);
      pointer(board, 'pointermove', 260, 240);
      expect(at()).toMatchObject({ left: 170, top: 150 });
      pointer(board, 'pointerup', 260, 240);
      expect(at()).toMatchObject({ left: 170, top: 150 });
      expect(root.querySelector('textarea.sticky')).toBe(ta); // the same box, kept: what was typed stays

      // Resized from the corner (at 350, 330): the box has the new size.
      pointer(board, 'pointerdown', 348, 328);
      pointer(board, 'pointermove', 395, 365);
      expect(at()).toMatchObject({ left: 170, top: 150, width: 225, height: 215 });
      pointer(board, 'pointerup', 395, 365);
      expect(at()).toMatchObject({ width: 225, height: 215 });
      expect(wb.items()[0]).toMatchObject({ size: 225 });
    } finally {
      wb.destroy();
      room.close();
    }
  });
});
