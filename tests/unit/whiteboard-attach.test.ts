// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { NOTE_SHAPES, createWhiteboard } from '@inksplat/collab-whiteboard';
import type { NoteItem, Whiteboard } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';

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

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

type Attached = NoteItem & { on?: string; u?: number; v?: number; dr?: number };

async function mount() {
  const room = new TestRoom();
  const host = await room.start();
  const wb = createWhiteboard(box(800, 600), {
    session: host,
    adapter: identity,
    random: () => 0.5,
  });
  const root = wb.element.shadowRoot!;
  const board = root.querySelector('svg')!;
  const pick = { id: null as string | null };
  Object.defineProperty(root, 'elementsFromPoint', {
    value: () => {
      const node = pick.id ? root.querySelector(`[data-id="${pick.id}"]`) : null;
      return node ? [node] : [];
    },
  });
  const fire = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
    board.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }),
    );
  const drag = (
    id: string,
    from: [number, number],
    to: [number, number],
    init: MouseEventInit = {},
  ) => {
    pick.id = id;
    fire('pointerdown', ...from, init);
    fire('pointermove', ...to, init);
    fire('pointerup', ...to, init);
  };
  const get = (id: string) => wb.items().find((i) => i.id === id) as Attached;
  const order = () =>
    [...root.querySelectorAll('.items > .item')].map((n) => n.getAttribute('data-id'));
  return {
    room,
    wb,
    root,
    drag,
    fire,
    pick,
    get,
    order,
    close: () => (wb.destroy(), room.close()),
  };
}
type Mounted = Awaited<ReturnType<typeof mount>>;

/** Two notes: a small one (A) up left, and a big one (B) in the middle. */
function setup(t: Mounted) {
  const a = t.wb.addNote({ x: 100, y: 100 }, 'A')!;
  const b = t.wb.addNote({ x: 400, y: 350 }, 'B')!;
  // Size A down to 100 and make both straight, so the numbers are easy.
  for (const [id, size] of [
    [a, 100],
    [b, 200],
  ] as const) {
    const inner = t.wb as unknown as {
      local(f: () => unknown): unknown;
      model: { change(i: string, f: object): unknown };
    };
    inner.local(() => inner.model.change(id, { size, rot: undefined }));
  }
  return { a, b };
}

describe('the grip that resizes a shape', () => {
  it('sits on the bottom right corner of the box, outside round shapes, and resizes from there', async () => {
    for (const shape of NOTE_SHAPES) {
      const t = await mount();
      try {
        const id = t.wb.addNote({ x: 300, y: 300 })!;
        const inner = t.wb as unknown as {
          local(f: () => unknown): unknown;
          model: { change(i: string, f: object): unknown };
        };
        inner.local(() =>
          inner.model.change(id, {
            shape: shape === 'square' ? undefined : shape,
            rot: undefined,
            size: 180,
          }),
        );
        t.wb.selectItems([id]);
        const note = t.get(id);
        const corner = { x: 300 + 90, y: 300 + (180 * note.ratio) / 2 };
        const grip = t.root.querySelector('.note-item .grip circle:not(.hit)')!;
        expect(Number(grip.getAttribute('cx')), shape).toBe(corner.x);
        expect(Number(grip.getAttribute('cy')), shape).toBe(corner.y);
        // It has its own hit area, so a press on it is a press on the note.
        expect(t.root.querySelector('.note-item .grip .hit.box'), shape).not.toBeNull();
        t.drag(id, [corner.x, corner.y], [corner.x + 40, corner.y + 40]);
        expect(t.get(id).size, shape).toBe(220);
        expect(t.get(id).x - t.get(id).size / 2).toBeCloseTo(210, 0); // resized: the top left stays
        expect(t.wb.selection(), shape).toEqual([id]); // still selected
      } finally {
        t.close();
      }
    }
  });

  it('shows only on the note selected alone, and resizes only from there', async () => {
    const t = await mount();
    try {
      const a = t.wb.addNote({ x: 200, y: 200 }, 'A')!;
      const b = t.wb.addNote({ x: 500, y: 400 }, 'B')!;
      const node = (id: string) => t.root.querySelector(`.note-item[data-id="${id}"]`)!;
      t.wb.selectItems([a]);
      expect(node(a).classList.contains('single')).toBe(true);
      expect(node(b).classList.contains('single')).toBe(false); // its grip is hidden
      // Several selected: no grip on any of them.
      t.wb.selectItems([a, b]);
      expect(node(a).classList.contains('single')).toBe(false);
      expect(node(b).classList.contains('single')).toBe(false);
      // Nothing selected: a press at the corner of a note moves it (and selects it), not resizes it.
      t.wb.selectItems([]);
      const before = t.get(b);
      const corner = [
        before.x + before.size / 2 - 2,
        before.y + (before.size * before.ratio) / 2 - 2,
      ] as [number, number];
      t.drag(b, corner, [corner[0] + 30, corner[1] + 30]);
      expect(t.get(b)).toMatchObject({ size: before.size, x: before.x + 30, y: before.y + 30 });
      expect(node(b).classList.contains('single')).toBe(true); // the grip shows now
    } finally {
      t.close();
    }
  });
});

describe('an element dragged by its pin onto another', () => {
  it('is attached to it, drawn on top of it, and goes with it when it is moved', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      // Drawn in the order they were made; A's pin is at the top middle of A (100, ~51).
      expect(t.order()).toEqual([a, b]);
      t.drag(a, [100, 52], [420, 360]);
      // Dropped on B: A moved by (320, 308) and is attached.
      expect(t.get(a)).toMatchObject({ on: b, x: 420, y: 408 });
      expect(t.get(a).u).toBeCloseTo((420 - 400) / 200, 3);
      expect(t.get(a).v).toBeCloseTo((408 - 350) / 200, 3);
      expect(t.order()).toEqual([b, a]); // A is on top of B now

      // B moves (by its body, away from A): A goes along, keeping its place on it.
      t.drag(b, [330, 440], [380, 480]);
      expect(t.get(b)).toMatchObject({ x: 450, y: 390 });
      expect(t.get(a)).toMatchObject({ x: 470, y: 448 });
      expect(t.order()).toEqual([b, a]); // although B was changed after A

      // A moved by its body is still on B, at its new place there.
      t.drag(a, [470, 470], [500, 490]);
      expect(t.get(a)).toMatchObject({ on: b, x: 500, y: 468 });
      t.drag(b, [330, 440], [310, 440]);
      expect(t.get(a)).toMatchObject({ x: 480, y: 468 });
    } finally {
      t.close();
    }
  });

  it('outlines the pin being dragged, and what it would be attached to, not the element', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      const node = (id: string) => t.root.querySelector(`.items > [data-id="${id}"]`)!;
      const ring = () => t.root.querySelector('.live .pin-ring');
      // Dragged by its pin: a ring is around the pin, which goes along; the note is not outlined.
      t.pick.id = a;
      t.fire('pointerdown', 100, 52);
      expect(ring()).not.toBeNull();
      expect(node(a).classList.contains('by-pin')).toBe(true);
      t.fire('pointermove', 200, 200); // over nothing
      expect(Number(ring()!.getAttribute('cx'))).toBeCloseTo(200, 0);
      expect(Number(ring()!.getAttribute('cy'))).toBeCloseTo(200, 0);
      expect(t.root.querySelector('.drop-target')).toBeNull();
      t.fire('pointermove', 420, 360); // over B: it is the one to be attached to
      expect(node(b).classList.contains('drop-target')).toBe(true);
      expect(node(a).classList.contains('drop-target')).toBe(false);
      t.fire('pointermove', 700, 80); // and away again
      expect(t.root.querySelector('.drop-target')).toBeNull();
      t.fire('pointermove', 420, 360);
      t.fire('pointerup', 420, 360);
      expect(ring()).toBeNull();
      expect(t.root.querySelector('.by-pin, .drop-target')).toBeNull();
      expect(t.get(a).on).toBe(b);

      // Dragged by its body: nothing of that.
      t.pick.id = a;
      t.fire('pointerdown', 420, 430);
      t.fire('pointermove', 450, 440);
      expect(ring()).toBeNull();
      expect(node(a).classList.contains('by-pin')).toBe(false);
      t.fire('pointerup', 450, 440);
    } finally {
      t.close();
    }
  });

  it('is detached when dragged by its pin onto nothing, and then stays when B moves', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      t.drag(a, [100, 52], [420, 360]);
      expect(t.get(a).on).toBe(b);
      // A's pin is now at (420, ~359): drag it to the empty corner.
      t.drag(a, [420, 360], [700, 80]);
      expect(t.get(a)).toMatchObject({ x: 700 });
      expect(t.get(a).on).toBeUndefined();
      expect(t.get(a)).not.toHaveProperty('u');
      t.drag(b, [330, 440], [380, 480]);
      expect(t.get(a).x).toBeCloseTo(700, 0);
    } finally {
      t.close();
    }
  });

  it('turns and scales with what it is on, and chains of them follow', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      const c = t.wb.addNote({ x: 700, y: 100 }, 'C')!;
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      inner.local(() => inner.model.change(c, { size: 60, rot: undefined }));
      t.drag(a, [100, 52], [420, 360]); // A on B, at (420, 408)
      // C by its pin (60 wide: at the top middle, (700, 72)) onto A (box 370..470 by 358..458).
      t.drag(c, [700, 72], [430, 420]);
      expect(t.get(c)).toMatchObject({ on: a, x: 430, y: 448 });
      expect(t.order()).toEqual([b, a, c]);
      // B moves: A and then C go along.
      t.drag(b, [330, 440], [350, 460]);
      expect(t.get(b)).toMatchObject({ x: 420, y: 370 });
      expect(t.get(a)).toMatchObject({ x: 440, y: 428 });
      expect(t.get(c)).toMatchObject({ x: 450, y: 468 });
      // B is turned a quarter (Ctrl+drag about its pin, at (420, 272)): what is on it goes round with it.
      t.drag(b, [520, 272], [420, 372], { ctrlKey: true });
      expect(t.get(b).rot).toBeCloseTo(90, 0);
      expect(t.get(a).rot).toBeCloseTo(90, 0);
      // B's centre went to (322, 272); A, (20, 58) from it, turned 90 degrees: (-58, 20) from it, and
      // A's own pin is 48.4 above its centre, so it is stored that much to the side and below.
      expect(t.get(a).x).toBeCloseTo(312.45, 0);
      expect(t.get(a).y).toBeCloseTo(340.45, 0);
      expect(t.get(c).rot).toBeCloseTo(90, 0);
    } finally {
      t.close();
    }
  });

  it('is not attached to what is on it, nor does a locked one follow', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      t.drag(a, [100, 52], [420, 360]); // A on B
      // Dragging B by its pin onto A would hold B up by A: it is refused (B stays free).
      const pinOfB = { x: t.get(b).x, y: t.get(b).y - 100 - 6 + 4 };
      t.drag(b, [pinOfB.x, pinOfB.y + 1], [425, 360]);
      expect(t.get(b).on).toBeUndefined();
      // A locked element stays where it is when what it is on moves.
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      const x = t.get(a).x;
      inner.local(() => inner.model.change(a, { lock: 'all' }));
      t.drag(b, [330, 560], [360, 560]);
      expect(t.get(a).x).toBe(x);
    } finally {
      t.close();
    }
  });

  it('keeps its place through a saved board', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      t.drag(a, [100, 52], [420, 360]);
      const saved = JSON.parse(JSON.stringify(await t.wb.saveBoard()));
      const room = new TestRoom();
      try {
        const host = await room.start();
        const next = createWhiteboard(box(800, 600), { session: host, adapter: identity });
        await next.loadBoard(saved);
        const items = next.items() as Attached[];
        const newA = items.find((i) => i.text === 'A')!;
        const newB = items.find((i) => i.text === 'B')!;
        expect(newA.on).toBe(newB.id);
        expect(newA.id).not.toBe(a);
        expect(newB.id).not.toBe(b);
        expect(newA.u).toBeCloseTo(0.1, 3);
        next.destroy();
      } finally {
        room.close();
      }
    } finally {
      t.close();
    }
  });
});

export type { Whiteboard };
