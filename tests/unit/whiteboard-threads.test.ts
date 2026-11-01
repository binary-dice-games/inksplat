// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  ARROW_HEADS,
  NOTE_SHAPES,
  cleanItem,
  createWhiteboard,
  pinPoint,
  threadCurve,
} from '@inksplat/collab-whiteboard';
import type { ArrowItem, Item, NoteItem } from '@inksplat/collab-whiteboard';
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

function keydown(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

interface Inside {
  tool: string;
  style: { color: string; shape: string; heads: string };
}

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };

describe('pins and threads as items', () => {
  it('keeps a good pin, thread and note shape, and nothing else', () => {
    expect(cleanItem({ ...base, kind: 'pin', x: 1, y: 2, color: '#e5484d' })).toMatchObject({
      kind: 'pin',
    });
    expect(cleanItem({ ...base, kind: 'pin', x: 1, y: 2, color: 'red' })).toBeNull();
    const thread = { ...base, kind: 'arrow', from: 'ana.2', to: 'ben.3', color: '#e5484d' };
    for (const heads of ARROW_HEADS) {
      expect(cleanItem({ ...thread, heads })).toMatchObject({ heads, from: 'ana.2', to: 'ben.3' });
    }
    expect(cleanItem({ ...thread, heads: 'both', extra: 1 })).not.toHaveProperty('extra');
    expect(cleanItem({ ...thread, heads: 'sideways' })).toBeNull();
    expect(cleanItem({ ...thread, heads: 'end', to: 'ana.2' })).toBeNull(); // to itself
    expect(cleanItem({ ...thread, heads: 'end', from: '../x' })).toBeNull();
    const note = {
      ...base,
      kind: 'note',
      x: 0,
      y: 0,
      size: 100,
      ratio: 1,
      text: '',
      color: '#ffe9a8',
    };
    expect(cleanItem({ ...note, shape: 'oval' })).toMatchObject({ shape: 'oval' });
    expect(cleanItem({ ...note, shape: 'square' })).not.toHaveProperty('shape');
    expect(cleanItem({ ...note, shape: 'star' })).not.toHaveProperty('shape');
  });

  it('knows where each kind of item is pinned', () => {
    const at = (item: object) => pinPoint({ ...base, ...item } as Item);
    expect(at({ kind: 'pin', x: 5, y: 6, color: '#000000' })).toEqual({ x: 5, y: 6 });
    const note = at({ kind: 'note', x: 100, y: 100, size: 100, ratio: 1, text: '', color: '#fff' });
    expect(note!.x).toBeCloseTo(100);
    expect(note!.y).toBeLessThan(60); // at the top, not at the middle (100)
    const turned = at({
      kind: 'note',
      x: 100,
      y: 100,
      size: 100,
      ratio: 1,
      text: '',
      color: '#fff',
      rot: 90,
    });
    expect(turned!.x).toBeCloseTo(100); // it turns about its pin: the pin stays
    expect(turned!.y).toBeCloseTo(note!.y);
    expect(at({ kind: 'text', x: 1, y: 1, size: 10, text: 'x', color: '#000000' })).toBeNull();
    expect(pinPoint(null)).toBeNull();
  });

  it('hangs a thread below the straight line, more when it is longer', () => {
    const short = threadCurve({ x: 0, y: 0 }, { x: 50, y: 0 });
    const long = threadCurve({ x: 0, y: 0 }, { x: 500, y: 0 });
    expect(short.c.y).toBeGreaterThan(0);
    expect(long.c.y).toBeGreaterThan(short.c.y);
    expect(long.c.x).toBe(250);
    expect(long.d).toMatch(/^M0 0Q250 [\d.]+ 500 0$/);
    expect(threadCurve({ x: 0, y: 0 }, { x: 500, y: 0 }, 1).c.y).toBeGreaterThan(long.c.y);
  });
});

describe('the pin and thread tools', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    let under: string | null = null;
    Object.defineProperty(root, 'elementsFromPoint', {
      value: () => {
        const node = under ? root.querySelector(`[data-id="${under}"]`) : null;
        return node ? [node] : [];
      },
    });
    return {
      room,
      wb,
      root,
      board,
      inside: wb as unknown as Inside,
      over: (id: string | null) => (under = id),
    };
  }
  type Mounted = Awaited<ReturnType<typeof mount>>;
  const done = (t: Mounted) => {
    t.wb.destroy();
    t.room.close();
  };
  const kinds = (t: Mounted) => t.wb.items().map((i) => i.kind);

  it('are keys 7 and 8, and the colour is key 9', async () => {
    const t = await mount();
    try {
      keydown('7');
      expect(t.inside.tool).toBe('pin');
      keydown('8');
      expect(t.inside.tool).toBe('arrow');
      const color = t.inside.style.color;
      keydown('9');
      expect(t.inside.style.color).not.toBe(color);
      expect(t.inside.tool).toBe('arrow');
    } finally {
      done(t);
    }
  });

  it('cycles the shapes of the note with key 6 and the heads of the thread with key 8', async () => {
    const t = await mount();
    try {
      keydown('6');
      expect(t.inside.style.shape).toBe('square');
      const seen = [t.inside.style.shape];
      for (let i = 1; i < NOTE_SHAPES.length; i++) {
        keydown('6');
        seen.push(t.inside.style.shape);
      }
      expect(seen).toEqual([...NOTE_SHAPES]);
      keydown('6');
      expect(t.inside.style.shape).toBe('square'); // round again
      keydown('6'); // rounded
      keydown('6'); // oval
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 300, 200);
      pointer(t.board, 'pointerup', 300, 200);
      expect(t.wb.items()[0]).toMatchObject({ kind: 'note', shape: 'oval' });
      expect(t.root.querySelector('.note-item ellipse.paper')).not.toBeNull();
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur')); // done writing

      keydown('8');
      expect(t.inside.style.heads).toBe('end');
      const heads = [t.inside.style.heads];
      for (let i = 1; i < ARROW_HEADS.length; i++) {
        keydown('8');
        heads.push(t.inside.style.heads);
      }
      expect(heads).toEqual(['end', 'both', 'none', 'start']);
    } finally {
      done(t);
    }
  });

  it('puts a bare pin where the board is clicked', async () => {
    const t = await mount();
    try {
      t.wb.setTool('pin');
      pointer(t.board, 'pointerdown', 120, 80);
      pointer(t.board, 'pointerup', 120, 80);
      expect(t.wb.items()).toMatchObject([
        { kind: 'pin', x: 120, y: 80, color: t.inside.style.color },
      ]);
      expect(t.root.querySelector('.pin-item circle.paper')).not.toBeNull();
    } finally {
      done(t);
    }
  });

  it('ties a thread by pressing on a pin and releasing on another', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 400, y: 120 })!;
      const note = t.wb.addNote({ x: 250, y: 300 })!;
      t.wb.setTool('arrow');
      // To empty board: nothing. From empty board: nothing.
      pointer(t.board, 'pointerdown', 100, 100);
      expect(t.root.querySelector('.live path')).not.toBeNull(); // the thread being pulled
      pointer(t.board, 'pointermove', 300, 250);
      pointer(t.board, 'pointerup', 300, 250);
      expect(t.root.querySelector('.live path')).toBeNull();
      pointer(t.board, 'pointerdown', 600, 400);
      pointer(t.board, 'pointerup', 400, 120);
      expect(kinds(t).filter((k) => k === 'arrow')).toHaveLength(0);

      // Pin to pin, then pin to the pin of a note (near the top of it).
      pointer(t.board, 'pointerdown', 102, 99);
      pointer(t.board, 'pointermove', 399, 121);
      pointer(t.board, 'pointerup', 399, 121);
      const notePin = pinPoint(t.wb.items().find((i) => i.id === note))!;
      pointer(t.board, 'pointerdown', 400, 120);
      pointer(t.board, 'pointerup', notePin.x, notePin.y);
      const threads = t.wb.items().filter((i): i is ArrowItem => i.kind === 'arrow');
      expect(threads.map((x) => [x.from, x.to, x.heads])).toEqual([
        [a, b, 'end'],
        [b, note, 'end'],
      ]);
      // Drawn as a hanging thread with a head, and with the shadow of the other pinned things.
      const drawn = t.root.querySelector('.arrow-item')!;
      expect(drawn.querySelector('path.paper')?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+Q/);
      expect(drawn.querySelectorAll('g:not(.shadow) > polygon')).toHaveLength(1);
      // Its shadow is a copy of it (thread and head), with no filter.
      expect(drawn.querySelectorAll('g.shadow > polygon')).toHaveLength(1);
      expect(drawn.querySelector('g.shadow > path')?.getAttribute('d')).toBe(
        drawn.querySelector('path.paper')?.getAttribute('d'),
      );
      expect(drawn.querySelector('[filter]')).toBeNull();
      // Not to itself.
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointerup', 101, 101);
      expect(t.wb.items().filter((i) => i.kind === 'arrow')).toHaveLength(2);
    } finally {
      done(t);
    }
  });

  it('follows its pins when they move, and is taken down with them', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 300, y: 100 })!;
      const thread = t.wb.addArrow(a, b)!;
      const d = () => t.root.querySelector('.arrow-item path.paper')!.getAttribute('d');
      const before = d();
      t.over(a);
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 100, 200);
      expect(d()).not.toBe(before); // the thread follows while the pin is dragged
      pointer(t.board, 'pointerup', 100, 200);
      expect(t.wb.items().find((i) => i.id === a)).toMatchObject({ x: 100, y: 200 });
      expect(d()).toMatch(/^M100 200Q/);

      // Taking a pin down takes its threads down (and that is no undo step of its own).
      t.over(b);
      pointer(t.board, 'pointerdown', 300, 100);
      pointer(t.board, 'pointerup', 300, 100);
      keydown('Delete');
      await until(() => !t.wb.items().some((i) => i.id === thread), 'the thread went');
      expect(t.root.querySelector('.arrow-item')).toBeNull();
    } finally {
      done(t);
    }
  });

  it('is removed by selecting it and pressing Delete, not with the right button', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 300, y: 100 })!;
      const thread = t.wb.addArrow(a, b)!;
      t.over(thread);
      pointer(t.board, 'contextmenu', 200, 130);
      expect(kinds(t)).toHaveLength(3);
      pointer(t.board, 'pointerdown', 200, 130);
      pointer(t.board, 'pointerup', 200, 130);
      keydown('Delete');
      expect(kinds(t)).toEqual(['pin', 'pin']);
    } finally {
      done(t);
    }
  });

  it('puts a pin on the element it is let go over, and ties itself to that pin', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const note = t.wb.addNote({ x: 400, y: 300 })!;
      t.wb.setTool('arrow');
      pointer(t.board, 'pointerdown', 100, 100);
      t.over(note);
      pointer(t.board, 'pointermove', 410, 320);
      const ring = t.root.querySelector<SVGElement>('.live circle')!;
      expect(ring.style.display).toBe(''); // where it will be tied
      pointer(t.board, 'pointerup', 410, 320);
      const pin = t.wb.items().find((i) => i.kind === 'pin' && i.id !== a)!;
      expect(pin).toMatchObject({ x: 410, y: 320, on: note });
      const threads = t.wb.items().filter((i): i is ArrowItem => i.kind === 'arrow');
      expect(threads.map((x) => [x.from, x.to])).toEqual([[a, pin.id]]);

      // Not from an element to itself: let go on the note it is pulled from, nothing happens.
      const count = t.wb.items().length;
      const own = pinPoint(t.wb.items().find((i) => i.id === note))!;
      pointer(t.board, 'pointerdown', own.x, own.y);
      pointer(t.board, 'pointermove', 380, 330);
      pointer(t.board, 'pointerup', 380, 330);
      pointer(t.board, 'pointerdown', 410, 320); // nor from the new pin to its own note
      pointer(t.board, 'pointermove', 390, 300);
      pointer(t.board, 'pointerup', 390, 300);
      expect(t.wb.items()).toHaveLength(count);
    } finally {
      done(t);
    }
  });

  it('starts from a new pin when pressed on an element, put only if the thread is tied', async () => {
    const t = await mount();
    try {
      const a = t.wb.addNote({ x: 200, y: 200 })!;
      const b = t.wb.addNote({ x: 500, y: 300 })!;
      const bare = t.wb.addPin({ x: 700, y: 100 })!;
      const count = t.wb.items().length;
      t.wb.setTool('arrow');

      // Let go over the board, or over the element it started on: nothing is left behind.
      pointer(t.board, 'pointerdown', 210, 220);
      expect(t.root.querySelector('.live circle.pending-pin')).not.toBeNull(); // the pin to be
      pointer(t.board, 'pointermove', 350, 50);
      pointer(t.board, 'pointerup', 350, 50);
      expect(t.root.querySelector('.live circle.pending-pin')).toBeNull();
      pointer(t.board, 'pointerdown', 210, 220);
      pointer(t.board, 'pointermove', 190, 230);
      pointer(t.board, 'pointerup', 190, 230);
      expect(t.wb.items()).toHaveLength(count);

      // Element to element: a pin on each, tied together.
      pointer(t.board, 'pointerdown', 210, 220);
      pointer(t.board, 'pointermove', 520, 310);
      pointer(t.board, 'pointerup', 520, 310);
      const pins = () => t.wb.items().filter((i) => i.kind === 'pin' && i.id !== bare);
      expect(pins()).toMatchObject([
        { x: 210, y: 220, on: a },
        { x: 520, y: 310, on: b },
      ]);
      const threads = () => t.wb.items().filter((i): i is ArrowItem => i.kind === 'arrow');
      expect(threads().map((x) => [x.from, x.to])).toEqual([[pins()[0]!.id, pins()[1]!.id]]);

      // Element to a pin: a pin on the element, tied to that pin.
      pointer(t.board, 'pointerdown', 190, 180);
      pointer(t.board, 'pointermove', 700, 100);
      pointer(t.board, 'pointerup', 700, 100);
      expect(pins()[2]).toMatchObject({ x: 190, y: 180, on: a });
      expect(threads()[1]).toMatchObject({ from: pins()[2]!.id, to: bare });
    } finally {
      done(t);
    }
  });

  it('refuses a thread to something without a pin, and everything on a read-only board', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      t.wb.addNote({ x: 10, y: 10 });
      t.wb.readOnly = true;
      expect(t.wb.addPin()).toBeNull();
      expect(t.wb.addArrow(a, 'nothing.1')).toBeNull();
      t.wb.readOnly = false;
      expect(t.wb.addArrow(a, 'nothing.1')).toBeNull();
      const ink = t.wb.items().length;
      expect(ink).toBe(2);
    } finally {
      done(t);
    }
  });
});

describe('selecting a note or a thread', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    const pick = { find: () => root.querySelector('.item') };
    Object.defineProperty(root, 'elementsFromPoint', {
      value: () => [pick.find()].filter(Boolean),
    });
    return { room, wb, root, board, pick };
  }
  const buttons = (root: ShadowRoot) => [
    ...root.querySelectorAll<HTMLButtonElement>('.selbar button'),
  ];

  it('shows a bar to change the shape and the paper of a note, and applies it', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 200, y: 200 }, 'idea');
      const bar = t.root.querySelector<HTMLElement>('.selbar')!;
      expect(bar.hidden).toBe(true);
      pointer(t.board, 'pointerdown', 200, 200);
      pointer(t.board, 'pointerup', 200, 200);
      expect(bar.hidden).toBe(false);
      expect(t.root.querySelector('.note-item.selected')).not.toBeNull();
      const labels = buttons(t.root).map((b) => b.getAttribute('aria-label'));
      expect(labels.filter((l) => l?.startsWith('Shape'))).toHaveLength(NOTE_SHAPES.length);

      buttons(t.root)
        .find((b) => b.getAttribute('aria-label') === 'Shape: Diamond')!
        .click();
      expect(t.wb.items()[0]).toMatchObject({ shape: 'diamond', text: 'idea' });
      expect(t.root.querySelector('.note-item polygon.paper')).not.toBeNull();
      const pressed = buttons(t.root).filter((b) => b.getAttribute('aria-pressed') === 'true');
      expect(pressed.map((b) => b.getAttribute('aria-label'))).toContain('Shape: Diamond');

      const before = (t.wb.items()[0] as NoteItem).color;
      buttons(t.root)
        .filter((b) => b.getAttribute('aria-label')?.startsWith('Colour'))[0]!
        .click();
      expect((t.wb.items()[0] as NoteItem).color).not.toBe(before);

      // Escape lets go.
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur')); // done writing
      keydown('Escape');
      expect(bar.hidden).toBe(true);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('shows the heads and colours of a thread, and applies them', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 300, y: 100 })!;
      t.wb.addArrow(a, b);
      // The thread is the last item under the pointer.
      t.pick.find = () => t.root.querySelector('.arrow-item');
      pointer(t.board, 'pointerdown', 200, 130);
      pointer(t.board, 'pointerup', 200, 130);
      expect(t.root.querySelector('.arrow-item.selected')).not.toBeNull();
      const head = (name: string) =>
        buttons(t.root).find((x) => x.getAttribute('aria-label') === name)!;
      head('Heads at both ends').click();
      expect(t.wb.items()[2]).toMatchObject({ kind: 'arrow', heads: 'both' });
      expect(t.root.querySelectorAll('.arrow-item g:not(.shadow) > polygon')).toHaveLength(2);
      head('No heads').click();
      expect(t.root.querySelectorAll('.arrow-item g:not(.shadow) > polygon')).toHaveLength(0);
      head('Head at the source').click();
      expect(t.root.querySelectorAll('.arrow-item g:not(.shadow) > polygon')).toHaveLength(1);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('shows the bar again when the same element is selected after letting it go', async () => {
    const t = await mount();
    try {
      t.wb.addPin({ x: 200, y: 200 });
      const bar = t.root.querySelector<HTMLElement>('.selbar')!;
      const pin = () => t.root.querySelector('.pin-item');
      for (let i = 0; i < 2; i++) {
        t.pick.find = pin;
        pointer(t.board, 'pointerdown', 200, 200);
        pointer(t.board, 'pointerup', 200, 200);
        expect(bar.hidden).toBe(false);
        expect(buttons(t.root).length).toBeGreaterThan(0);
        // A click on the empty board lets go.
        t.pick.find = () => null;
        const away = { clientX: 600, clientY: 400, bubbles: true, composed: true };
        t.board.dispatchEvent(new MouseEvent('pointerdown', away));
        t.board.dispatchEvent(new MouseEvent('pointerup', away));
        expect(bar.hidden).toBe(true);
      }
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('hides the bar while the element is dragged, and shows it when it is let go', async () => {
    const t = await mount();
    try {
      t.wb.addPin({ x: 200, y: 200 });
      const bar = t.root.querySelector<HTMLElement>('.selbar')!;
      t.pick.find = () => t.root.querySelector('.pin-item');
      pointer(t.board, 'pointerdown', 200, 200);
      expect(bar.hidden).toBe(false);
      expect(bar.classList.contains('moving')).toBe(false); // a press alone keeps it
      pointer(t.board, 'pointermove', 260, 240);
      expect(bar.classList.contains('moving')).toBe(true);
      pointer(t.board, 'pointerup', 260, 240);
      expect(bar.classList.contains('moving')).toBe(false);
      expect(bar.hidden).toBe(false);
      expect(t.wb.items()[0]).toMatchObject({ x: 260, y: 240 });
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is offered to others too, with only what they may do once it is locked', async () => {
    const t = await mount();
    try {
      const ana = await t.room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaBoard = createWhiteboard(box(800, 450), { session: ana, adapter: identity });
      const id = t.wb.addNote({ x: 200, y: 200 }, 'mine')!;
      await until(() => anaBoard.items().length === 1, 'the note arrived');
      const root = anaBoard.element.shadowRoot!;
      Object.defineProperty(root, 'elementsFromPoint', {
        value: () => [root.querySelector('.item')],
      });
      const labels = () =>
        [...root.querySelectorAll('.selbar button')].map((b) => b.getAttribute('aria-label') ?? '');
      pointer(root.querySelector('svg')!, 'pointerdown', 200, 200);
      pointer(root.querySelector('svg')!, 'pointerup', 200, 200);
      expect(root.querySelector<HTMLElement>('.selbar')!.hidden).toBe(false);
      expect(labels().some((l) => l.startsWith('Shape'))).toBe(true);
      expect(labels().some((l) => l.startsWith('Locked') || l.startsWith('Unlocked'))).toBe(false); // the owner's
      root.querySelector('textarea')?.dispatchEvent(new Event('blur'));

      const owner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      owner.local(() => owner.model.change(id, { lock: 'all' }));
      await until(
        () => (anaBoard.items()[0] as { lock?: string }).lock === 'all',
        'the lock arrived',
      );
      expect(labels()).toEqual(['Copy the text']);
      anaBoard.destroy();
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });
});

describe('clearing only the drawings', () => {
  it('removes lines, texts and stickers of everyone and leaves the elements', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    try {
      const ana = await room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaBoard = createWhiteboard(box(800, 450), { session: ana, adapter: identity });
      const note = wb.addNote({ x: 100, y: 100 }, 'keep')!;
      const pin = wb.addPin({ x: 300, y: 100 })!;
      wb.addArrow(note, pin);
      await until(() => anaBoard.items().length === 3, 'the elements arrived');
      // Drawings by both of them, made the way the tools make them.
      const draw = (b: unknown) => {
        const inner = b as {
          local(make: () => unknown): unknown;
          model: { add(f: object): unknown };
        };
        for (const fields of [
          { kind: 'ink', points: [0, 0, 10, 10], color: '#e5484d', width: 4 },
          { kind: 'sticker', x: 5, y: 5, size: 32, name: 'check' },
          { kind: 'text', x: 5, y: 5, size: 18, text: 'hi', color: '#e5484d' },
        ]) {
          inner.local(() => inner.model.add(fields));
        }
      };
      draw(wb);
      draw(anaBoard);
      await until(() => wb.items().length === 9, 'all the drawings are in');
      expect(wb.clearDrawings()).toBe(6);
      expect(
        wb
          .items()
          .map((i) => i.kind)
          .sort(),
      ).toEqual(['arrow', 'note', 'pin']);
      expect(wb.clearDrawings()).toBe(0);
      await until(
        () => anaBoard.items().every((i) => ['arrow', 'note', 'pin'].includes(i.kind)),
        'Ana sees only the elements',
      );
      expect(wb.readOnly).toBe(false);
      wb.readOnly = true;
      expect(wb.clearDrawings()).toBe(0);
    } finally {
      wb.destroy();
      room.close();
    }
  });
});

describe('pins attached to what they are put on', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), {
      session: host,
      adapter: identity,
      random: () => 0.5,
    });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    const pick = { find: (): Element | null => null };
    Object.defineProperty(root, 'elementsFromPoint', {
      value: () => [pick.find()].filter(Boolean),
    });
    const where = (id: string) =>
      pinPoint(
        wb.items().find((i) => i.id === id),
        (other) => wb.items().find((i) => i.id === other),
      )!;
    return { room, wb, root, board, pick, where, inside: wb as unknown as Inside };
  }
  type Mounted = Awaited<ReturnType<typeof mount>>;
  const done = (t: Mounted) => {
    t.wb.destroy();
    t.room.close();
  };
  /** A pointer event the way the browser makes it: it crosses into the page and can be stopped there. */
  const press = (t: Mounted, type: string, x: number, y: number, init: MouseEventInit = {}) =>
    t.board.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      }),
    );
  const change = (t: Mounted, id: string, fields: object) =>
    (
      t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      }
    ).local(() =>
      (t.wb as unknown as { model: { change(i: string, f: object): unknown } }).model.change(
        id,
        fields,
      ),
    );

  it('stays where it was put on a note when the note is moved, turned or scaled', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 }, 'host')!;
      change(t, note, { size: 180 }); // the positions below assume a note this wide
      const pin = t.wb.addPin({ x: 230, y: 180 })!; // on the note (110..290 by 110..290)
      const other = t.wb.addPin({ x: 600, y: 400 })!; // on nothing
      const items = t.wb.items();
      expect(items.find((i) => i.id === pin)).toMatchObject({ on: note });
      expect(items.find((i) => i.id === other)).not.toHaveProperty('on');
      expect(t.where(pin).x).toBeCloseTo(230, 0);
      expect(t.where(pin).y).toBeCloseTo(180, 0);
      const thread = t.wb.addArrow(pin, other)!;
      const d = () => t.root.querySelector('.arrow-item path.paper')!.getAttribute('d');
      const before = d();

      change(t, note, { x: 300, y: 250 });
      expect(t.where(pin).x).toBeCloseTo(330, 0); // moved with it
      expect(t.where(pin).y).toBeCloseTo(230, 0);
      expect(d()).not.toBe(before); // and so did the thread
      expect(d()).toMatch(/^M330 230Q/);
      // The drawn pin is there too.
      expect(
        Number(t.root.querySelector('.pin-item circle.paper')!.getAttribute('cx')),
      ).toBeCloseTo(330, 0);

      change(t, note, { size: 360 }); // twice as wide and as high: twice as far from the centre
      expect(t.where(pin).x).toBeCloseTo(360, 0);
      expect(t.where(pin).y).toBeCloseTo(210, 0);
      change(t, note, { size: 180, rot: 90 });
      // Turned a quarter about its pin (the note's centre goes to (212, 162)).
      expect(t.where(pin).x).toBeCloseTo(232, 0);
      expect(t.where(pin).y).toBeCloseTo(192, 0);
      expect(thread).toBeTruthy();
    } finally {
      done(t);
    }
  });

  it('goes with its note when the note goes, and so does what is tied to it', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 }, 'host')!;
      const pin = t.wb.addPin({ x: 230, y: 180 })!;
      const other = t.wb.addPin({ x: 600, y: 400 })!;
      t.wb.addArrow(pin, other);
      t.wb.addArrow(other, note);
      const kinds = () =>
        t.wb
          .items()
          .map((i) => i.kind)
          .sort();
      expect(kinds()).toEqual(['arrow', 'arrow', 'note', 'pin', 'pin']);
      t.pick.find = () => t.root.querySelector('.note-item');
      press(t, 'pointerdown', 200, 250);
      press(t, 'pointerup', 200, 250);
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      keydown('Delete');
      await until(
        () => !kinds().includes('arrow') && kinds().length === 1,
        'all that hung on it went',
      );
      expect(t.wb.items()[0]).toMatchObject({ id: other, kind: 'pin' });
    } finally {
      done(t);
    }
  });

  it('is attached when it is moved onto something, and loose when it is moved off', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 })!;
      const pin = t.wb.addPin({ x: 600, y: 400 })!;
      t.pick.find = () => t.root.querySelector('.pin-item');
      const drag = (from: [number, number], to: [number, number]) => {
        press(t, 'pointerdown', ...from);
        press(t, 'pointermove', ...to);
        press(t, 'pointerup', ...to);
      };
      drag([600, 400], [180, 230]);
      expect(t.wb.items().find((i) => i.id === pin)).toMatchObject({ on: note });
      expect(t.where(pin).x).toBeCloseTo(180, 0);
      t.pick.find = () => t.root.querySelector('.pin-item');
      drag([180, 230], [700, 100]);
      expect(t.wb.items().find((i) => i.id === pin)).not.toHaveProperty('on');
      expect(t.where(pin)).toEqual({ x: 700, y: 100 });
    } finally {
      done(t);
    }
  });

  it('outlines what it would be attached to while it is dragged', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 })!;
      t.wb.addPin({ x: 600, y: 400 });
      const node = () => t.root.querySelector(`.items > [data-id="${note}"]`)!;
      const outlined = () => t.root.querySelector('.drop-target');
      t.pick.find = () => t.root.querySelector('.pin-item');
      press(t, 'pointerdown', 600, 400);
      press(t, 'pointermove', 650, 420); // over nothing
      expect(outlined()).toBeNull();
      press(t, 'pointermove', 180, 230); // over the note
      expect(node().classList.contains('drop-target')).toBe(true);
      press(t, 'pointermove', 700, 100); // and off it again
      expect(outlined()).toBeNull();
      press(t, 'pointermove', 180, 230);
      press(t, 'pointerup', 180, 230);
      expect(outlined()).toBeNull();
      expect(t.root.querySelector('.pin-ring')).toBeNull(); // the ring is for elements dragged by their pin
    } finally {
      done(t);
    }
  });

  it('pulls a thread when pressed on with Shift and dragged, whatever tool is in hand, and gives the tool back', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 400, y: 120 })!;
      for (const tool of ['pointer', 'note', 'text', 'sticker', 'pin']) {
        t.wb.setTool(tool as never);
        press(t, 'pointerdown', 101, 99, { shiftKey: true });
        expect(t.inside.tool, tool).toBe('arrow'); // the thread tool, for as long as the button is down
        press(t, 'pointermove', 300, 110, { shiftKey: true });
        press(t, 'pointerup', 399, 121, { shiftKey: true });
        expect(t.inside.tool, tool).toBe(tool);
      }
      const threads = t.wb.items().filter((i): i is ArrowItem => i.kind === 'arrow');
      expect(threads).toHaveLength(5);
      expect(threads.every((x) => x.from === a && x.to === b)).toBe(true);
      // Nothing else was made, and the pins did not move.
      expect(t.wb.items().filter((i) => i.kind === 'pin')).toHaveLength(2);
      expect(t.where(a)).toEqual({ x: 100, y: 100 });

      // Not with the pen or the eraser, nor without Shift (that moves the pin), nor off a pin.
      for (const tool of ['pen', 'eraser']) {
        t.wb.setTool(tool as never);
        press(t, 'pointerdown', 101, 99, { shiftKey: true });
        expect(t.inside.tool).toBe(tool);
        press(t, 'pointerup', 101, 99, { shiftKey: true });
      }
      t.wb.setTool('pointer');
      press(t, 'pointerdown', 101, 99);
      expect(t.inside.tool).toBe('pointer');
      press(t, 'pointerup', 101, 99);
      press(t, 'pointerdown', 600, 300, { shiftKey: true });
      expect(t.inside.tool).toBe('pointer');
      press(t, 'pointerup', 600, 300, { shiftKey: true });
      // Let go on nothing: the tool comes back and there is no new thread.
      press(t, 'pointerdown', 100, 100, { shiftKey: true });
      press(t, 'pointerup', 650, 350, { shiftKey: true });
      expect(t.inside.tool).toBe('pointer');
      expect(t.wb.items().filter((i) => i.kind === 'arrow')).toHaveLength(5);
    } finally {
      done(t);
    }
  });

  it('selects the pin, not the thread or the note that lie over it, when it is clicked', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 400, y: 120 })!;
      t.wb.addArrow(a, b);
      t.wb.addNote({ x: 100, y: 130 }, 'under');
      // Whatever the page finds first under the pointer, the thread is on top of the pin.
      t.pick.find = () => t.root.querySelector('.arrow-item');
      press(t, 'pointerdown', 103, 98);
      press(t, 'pointerup', 103, 98);
      expect(t.root.querySelector('.pin-item.selected')).not.toBeNull();
      expect(t.root.querySelector('.arrow-item.selected')).toBeNull();
      expect(t.root.querySelector<HTMLElement>('.selbar')!.hidden).toBe(false);
      expect(t.wb.items().filter((i) => i.kind === 'arrow')).toHaveLength(1); // a click is no thread
      // A click on the thread itself, away from the pins, still selects the thread.
      press(t, 'pointerdown', 250, 200);
      press(t, 'pointerup', 250, 200);
      expect(t.root.querySelector('.arrow-item.selected')).not.toBeNull();
    } finally {
      done(t);
    }
  });

  it('is dragged from where it is drawn when its note has been moved', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 })!;
      change(t, note, { size: 180 }); // the positions below assume a note this wide
      const pin = t.wb.addPin({ x: 230, y: 180 })!;
      const other = t.wb.addPin({ x: 600, y: 400 })!;
      const thread = t.wb.addArrow(pin, other)!;
      change(t, note, { x: 400, y: 300 }); // the pin is now drawn at (430, 280)
      t.pick.find = () => t.root.querySelector('.pin-item');
      const drawn = () => t.root.querySelector('.arrow-item path.paper')!.getAttribute('d')!;
      press(t, 'pointerdown', 430, 280);
      press(t, 'pointermove', 460, 300);
      // While it is dragged the thread starts under the pointer's pin, not at the old place.
      expect(drawn()).toMatch(/^M460 300Q/);
      press(t, 'pointerup', 460, 300);
      // Let go on the note: still attached, 30 right and 20 down of where it was.
      expect(t.wb.items().find((i) => i.id === pin)).toMatchObject({ on: note });
      expect(t.where(pin).x).toBeCloseTo(460, 0);
      expect(t.where(pin).y).toBeCloseTo(300, 0);
      expect(drawn()).toMatch(/^M460 300Q/);
      expect(thread).toBeTruthy();
    } finally {
      done(t);
    }
  });

  it('has its bar over the pin where it is drawn, not where it was put', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 })!;
      const pin = t.wb.addPin({ x: 230, y: 180 })!;
      Object.defineProperty(t.wb.element, 'clientWidth', { value: 800 }); // jsdom has no layout
      change(t, note, { x: 400, y: 300 }); // the pin is now drawn at (430, 280)
      t.pick.find = () => t.root.querySelector('.pin-item');
      press(t, 'pointerdown', 430, 280);
      press(t, 'pointerup', 430, 280);
      expect(t.root.querySelector('.pin-item.selected')).not.toBeNull();
      const bar = t.root.querySelector<HTMLElement>('.selbar')!;
      expect(bar.hidden).toBe(false);
      expect(parseFloat(bar.style.left)).toBeCloseTo(430, 0);
      expect(parseFloat(bar.style.top)).toBeCloseTo(280 - 22, 0);
      // And it follows the note while the bar is open.
      change(t, note, { x: 500 });
      expect(parseFloat(bar.style.left)).toBeCloseTo(530, 0);
      expect(pin).toBeTruthy();
    } finally {
      done(t);
    }
  });

  it('keeps its bar inside the board near the edges, under the pin when there is no room over it', async () => {
    const t = await mount();
    try {
      // jsdom has no layout: an 800 by 450 board and a 200 by 40 bar.
      Object.defineProperty(t.wb.element, 'clientWidth', { value: 800 });
      Object.defineProperty(t.wb.element, 'clientHeight', { value: 450 });
      const bar = t.root.querySelector<HTMLElement>('.selbar')!;
      Object.defineProperty(bar, 'offsetWidth', { value: 200 });
      Object.defineProperty(bar, 'offsetHeight', { value: 40 });
      const select = (x: number, y: number) => {
        const pin = t.wb.addPin({ x, y })!;
        t.pick.find = () => t.root.querySelector(`.pin-item[data-id="${pin}"]`);
        press(t, 'pointerdown', x, y);
        press(t, 'pointerup', x, y);
        expect(bar.hidden).toBe(false);
        // The bar's anchor is its bottom middle: its box is left - 100 .. left + 100, top - 40 .. top.
        return { left: parseFloat(bar.style.left), top: parseFloat(bar.style.top) };
      };

      const topLeft = select(20, 10);
      expect(topLeft.left - 100).toBeGreaterThanOrEqual(0);
      expect(topLeft.top - 40).toBeGreaterThan(10); // under the pin
      expect(topLeft.top).toBeLessThanOrEqual(450);

      const bottomRight = select(790, 440);
      expect(bottomRight.left + 100).toBeLessThanOrEqual(800);
      expect(bottomRight.top).toBeLessThan(440); // over the pin
      expect(bottomRight.top - 40).toBeGreaterThanOrEqual(0);

      const middle = select(400, 200);
      expect(middle).toEqual({ left: 400, top: 200 - 22 }); // away from the edges: right over it
    } finally {
      done(t);
    }
  });

  it('is taken down by the Delete key when it is selected, unless it is locked against you', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 200, y: 200 })!;
      const b = t.wb.addPin({ x: 400, y: 200 })!;
      const thread = t.wb.addArrow(a, b)!;
      const key = (k: string) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      key('Delete'); // nothing selected: nothing happens
      expect(t.wb.items()).toHaveLength(3);
      t.pick.find = () => t.root.querySelector('.arrow-item');
      press(t, 'pointerdown', 300, 230);
      press(t, 'pointerup', 300, 230);
      expect(t.root.querySelector('.arrow-item.selected')).not.toBeNull();
      key('Delete');
      expect(t.wb.items().map((i) => i.id)).toEqual([a, b]);
      expect(t.wb.items().some((i) => i.id === thread)).toBe(false);
      // A pin, with its threads going with it.
      const second = t.wb.addArrow(a, b)!;
      t.pick.find = () => t.root.querySelectorAll('.pin-item')[0] ?? null;
      press(t, 'pointerdown', 200, 200);
      press(t, 'pointerup', 200, 200);
      key('Backspace');
      await until(() => !t.wb.items().some((i) => i.id === second), 'the thread went with its pin');
      expect(t.wb.items().map((i) => i.id)).toEqual([b]);
    } finally {
      done(t);
    }
  });

  it('keeps its place on its note through a saved board', async () => {
    const t = await mount();
    try {
      const note = t.wb.addNote({ x: 200, y: 200 })!;
      const pin = t.wb.addPin({ x: 230, y: 180 })!;
      change(t, note, { x: 210 }); // the note is newer than the pin now
      const saved = await t.wb.saveBoard();
      const room = new TestRoom();
      try {
        const host = await room.start();
        const next = createWhiteboard(box(800, 450), { session: host, adapter: identity });
        await next.loadBoard(JSON.parse(JSON.stringify(saved)));
        const items = next.items();
        const newNote = items.find((i) => i.kind === 'note')!;
        const newPin = items.find((i) => i.kind === 'pin')!;
        expect(newPin).toMatchObject({ on: newNote.id });
        expect(newPin.id).not.toBe(pin);
        const at = pinPoint(newPin, (id) => items.find((i) => i.id === id))!;
        expect(at.x).toBeCloseTo(240, 1);
        expect(at.y).toBeCloseTo(180, 1);
        next.destroy();
      } finally {
        room.close();
      }
    } finally {
      done(t);
    }
  });
});

describe('the options of a tool', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const tool = (key: string) =>
      root.querySelector<HTMLButtonElement>(`.toolbar button[data-key="${key}"]`)!;
    const panel = () =>
      root.querySelector<HTMLElement>('.pop')!.hidden
        ? []
        : [...root.querySelectorAll<HTMLButtonElement>('.pop button')];
    return { room, wb, root, tool, panel, inside: wb as unknown as Inside };
  }

  it('open a panel with all of them when the tool is clicked, and a choice closes it', async () => {
    const t = await mount();
    try {
      // key: tool, how many options, the option to choose, what it changes
      const cases: [string, number, number, () => unknown, unknown][] = [
        ['2', 3, 2, () => (t.inside.style as unknown as { width: number }).width, 8],
        ['3', 3, 0, () => (t.inside.style as unknown as { size: number }).size, 14],
        ['6', 5, 3, () => t.inside.style.shape, 'diamond'],
        ['7', 5, 4, () => (t.inside.style as unknown as { pinShape: string }).pinShape, 'star'],
        ['8', 4, 1, () => t.inside.style.heads, 'start'],
      ];
      for (const [key, count, choose, read, expected] of cases) {
        t.tool(key).click();
        expect(t.panel(), key).toHaveLength(count);
        expect(t.panel().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
        t.panel()[choose]!.click();
        expect(read(), key).toBe(expected);
        expect(t.panel(), key).toHaveLength(0); // closed by the choice
        // The tool is the one in hand, and clicking it again opens and closes the panel.
        t.tool(key).click();
        expect(t.panel()).toHaveLength(count);
        t.tool(key).click();
        expect(t.panel()).toHaveLength(0);
      }
      // The stickers and the colours already had one.
      t.tool('4').click();
      expect(t.panel().length).toBeGreaterThan(4);
      t.panel()[1]!.click();
      t.tool('9').click();
      expect(t.panel()).toHaveLength(8);
      t.panel()[1]!.click();
      expect(t.inside.style.color).toBe('#f5a524');
      // The pointer has its modes; the eraser has nothing to choose: it only selects.
      t.tool('1').click();
      expect(t.panel()).toHaveLength(4);
      t.tool('1').click();
      t.tool('5').click();
      expect(t.panel()).toHaveLength(0);
      expect(t.inside.tool).toBe('eraser');
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('have as many slots as options, up to four a row', async () => {
    const t = await mount();
    try {
      const columns = (key: string) => {
        t.tool(key).click();
        const n = t.panel().length;
        const cols = t.root.querySelector<HTMLElement>('.pop')!.style.gridTemplateColumns;
        t.tool(key).click();
        return [n, cols];
      };
      expect(columns('2')).toEqual([3, 'repeat(3, 34px)']); // line widths
      expect(columns('8')).toEqual([4, 'repeat(4, 34px)']); // thread heads
      expect(columns('6')).toEqual([5, 'repeat(5, 34px)']); // note shapes
      expect(columns('9')).toEqual([8, 'repeat(4, 34px)']); // colours: two rows
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('show the choice on the note panel with the colour of the paper', async () => {
    const t = await mount();
    try {
      t.tool('6').click();
      expect(t.panel()[0]!.querySelector('rect, ellipse, polygon')!.getAttribute('fill')).toMatch(
        /^#/,
      );
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });
});
