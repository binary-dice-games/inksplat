// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { createWhiteboard } from '@inksplat/collab-whiteboard';
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

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

function keydown(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  pointerType?: string,
): MouseEvent {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  if (pointerType) {
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
  }
  target.dispatchEvent(ev);
  return ev;
}

/** A clipboard event with a clipboard of its own. */
function clip(type: string, data = new Map<string, string>()) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      setData: (t: string, v: string) => data.set(t, v),
      getData: (t: string) => data.get(t) ?? '',
      types: [],
    },
  });
  window.dispatchEvent(ev);
  return { ev, data };
}

type Item = { id: string; kind: string; x?: number; y?: number; [k: string]: unknown };

const sticker = (author: string, n: number, x: number, y: number, extra = {}) => ({
  id: `${author}.${n}`,
  author,
  stamp: [n, author],
  kind: 'sticker',
  x,
  y,
  size: 40,
  name: 'star',
  ...extra,
});

const snapshot = (items: unknown[]) => ({ v: 1, clock: 50, clear: [0, ''], items });

/**
 * A board whose items catch the pointer over the square of their size around (x, y) (jsdom lays
 * nothing out), on a stage the sweeps start from.
 */
async function mount(adapter: object = identity) {
  const room = new TestRoom();
  const host = await room.start();
  const stage = box(800, 450);
  const wb = createWhiteboard(stage, { session: host, adapter: adapter as typeof identity });
  const root = wb.element.shadowRoot!;
  const board = root.querySelector('svg')!;
  Object.defineProperty(root, 'elementsFromPoint', {
    value: (x: number, y: number) =>
      (wb.items() as unknown as Item[])
        .filter((i) => {
          const r = ((i.size as number) ?? 20) / 2;
          return i.x !== undefined && Math.abs(i.x - x) <= r && Math.abs(i.y! - y) <= r;
        })
        .reverse()
        .map((i) => root.querySelector(`[data-id="${i.id}"]`))
        .filter(Boolean),
  });
  const sweep = (...points: [number, number][]) => {
    const [first, ...rest] = points;
    pointer(stage, 'pointerdown', ...first!);
    for (const p of rest) {
      pointer(stage, 'pointermove', ...p);
    }
    pointer(stage, 'pointerup', ...points[points.length - 1]!);
  };
  const get = (id: string) => (wb.items() as unknown as Item[]).find((i) => i.id === id);
  const done = () => {
    wb.destroy();
    room.close();
  };
  return { room, host, me: host.me.id, stage, wb, root, board, sweep, get, done };
}

describe('selecting several items', () => {
  it('selects what a drag from an empty place passes over, as the eraser marks it', async () => {
    const t = await mount();
    try {
      t.wb.load(
        snapshot([
          sticker(t.me, 1, 100, 100),
          sticker(t.me, 2, 200, 100),
          sticker(t.me, 3, 300, 300),
        ]),
      );
      // A quick move with no point over the second sticker still takes it.
      t.sweep([40, 100], [120, 100], [260, 100]);
      expect(t.wb.selection().sort()).toEqual([`${t.me}.1`, `${t.me}.2`]);
      const marked = [...t.root.querySelectorAll('.item.selected')].map((n) =>
        n.getAttribute('data-id'),
      );
      expect(marked.sort()).toEqual([`${t.me}.1`, `${t.me}.2`]);
      expect(t.root.querySelector('.selbar')!.textContent).toContain('2 selected');
      expect(t.root.querySelector('.sweep')).toBeNull(); // the trail goes on letting go

      // A click on an empty place selects nothing, and the selection goes.
      t.sweep([600, 400]);
      expect(t.wb.selection()).toEqual([]);
      expect(t.root.querySelectorAll('.item.selected')).toHaveLength(0);

      // A sweep over one item selects it as a click does; Escape lets go of a selection.
      t.sweep([40, 300], [320, 300]);
      expect(t.wb.selection()).toEqual([`${t.me}.3`]);
      t.wb.selectItems([`${t.me}.1`, `${t.me}.3`]);
      keydown('Escape');
      expect(t.wb.selection()).toEqual([]);
    } finally {
      t.done();
    }
  });

  it('leaves the other tools and touch alone, and pans with Space+drag when zoomed in', async () => {
    const pans: number[][] = [];
    const t = await mount({
      ...identity,
      zoomed: () => true,
      panBy: (dx: number, dy: number) => pans.push([dx, dy]),
    });
    try {
      t.wb.load(snapshot([sticker(t.me, 1, 100, 100), sticker(t.me, 2, 200, 100)]));
      // By touch the drag pans the board, as before.
      pointer(t.stage, 'pointerdown', 40, 100, 'touch');
      pointer(t.stage, 'pointermove', 260, 100, 'touch');
      pointer(t.stage, 'pointerup', 260, 100, 'touch');
      expect(t.wb.selection()).toEqual([]);
      expect(pans).toEqual([[220, 0]]);
      // With Space held a mouse drag pans too.
      keydown(' ');
      t.sweep([40, 100], [260, 110]);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      expect(t.wb.selection()).toEqual([]);
      expect(pans).toEqual([
        [220, 0],
        [220, 10],
      ]);
      // A plain drag selects, also zoomed in.
      t.sweep([40, 100], [260, 100]);
      expect(t.wb.selection()).toHaveLength(2);
      // The pen draws instead.
      keydown('Escape');
      t.wb.setTool('pen');
      t.sweep([40, 300], [260, 300]);
      expect(t.wb.selection()).toEqual([]);
    } finally {
      t.done();
    }
  });

  it('moves them all together when one of them is dragged, and not what is locked', async () => {
    const t = await mount();
    try {
      t.wb.load(
        snapshot([
          sticker(t.me, 1, 100, 100),
          {
            id: `${t.me}.2`,
            author: t.me,
            stamp: [2, t.me],
            kind: 'ink',
            points: [300, 300, 340, 320],
            color: '#000000',
            width: 3,
          },
          sticker('other', 3, 200, 100, { lock: 'owner' }),
          // A note, and one that sits on it: the second goes with the first, once.
          {
            id: `${t.me}.4`,
            author: t.me,
            stamp: [4, t.me],
            kind: 'note',
            x: 500,
            y: 100,
            size: 100,
            ratio: 1,
            text: '',
            color: '#fff1b3',
          },
          {
            id: `${t.me}.5`,
            author: t.me,
            stamp: [5, t.me],
            kind: 'note',
            x: 510,
            y: 110,
            size: 60,
            ratio: 1,
            text: '',
            color: '#fff1b3',
            on: `${t.me}.4`,
            u: 0.1,
            v: 0.1,
          },
        ]),
      );
      const all = [`${t.me}.1`, `${t.me}.2`, 'other.3', `${t.me}.4`, `${t.me}.5`];
      t.wb.selectItems(all);
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 130, 140);
      expect(t.root.querySelector(`[data-id="${t.me}.1"]`)!.getAttribute('transform')).toBe(
        'translate(30 40)',
      );
      expect(t.root.querySelector('.selbar')!.classList.contains('moving')).toBe(true);
      pointer(t.board, 'pointerup', 130, 140);
      expect(t.get(`${t.me}.1`)).toMatchObject({ x: 130, y: 140 });
      expect(t.get(`${t.me}.2`)).toMatchObject({ points: [330, 340, 370, 360] });
      expect(t.get('other.3')).toMatchObject({ x: 200, y: 100 }); // locked against me
      expect(t.get(`${t.me}.4`)).toMatchObject({ x: 530, y: 140 });
      expect(t.get(`${t.me}.5`)).toMatchObject({ x: 540, y: 150, on: `${t.me}.4` });
      expect(t.root.querySelector(`[data-id="${t.me}.1"]`)!.hasAttribute('transform')).toBe(false);
      expect(t.wb.selection()).toHaveLength(5); // still selected

      // A press and release on one of them without moving selects just that one.
      pointer(t.board, 'pointerdown', 130, 140);
      pointer(t.board, 'pointerup', 130, 140);
      expect(t.wb.selection()).toEqual([`${t.me}.1`]);
    } finally {
      t.done();
    }
  });

  it('changes the colour of those that have one from the bar, a note to its pale tone', async () => {
    const t = await mount();
    try {
      t.wb.load(
        snapshot([
          sticker(t.me, 1, 100, 100),
          {
            id: `${t.me}.2`,
            author: t.me,
            stamp: [2, t.me],
            kind: 'ink',
            points: [300, 300, 340, 320],
            color: '#000000',
            width: 3,
          },
          {
            id: `${t.me}.3`,
            author: t.me,
            stamp: [3, t.me],
            kind: 'note',
            x: 500,
            y: 100,
            size: 100,
            ratio: 1,
            text: '',
            color: '#fff1b3',
          },
        ]),
      );
      t.wb.selectItems([`${t.me}.1`, `${t.me}.2`, `${t.me}.3`]);
      const blue = t.root.querySelector<HTMLButtonElement>('.selbar [aria-label="Colour: blue"]')!;
      blue.click();
      expect(t.get(`${t.me}.2`)).toMatchObject({ color: '#3e63dd' });
      const note = t.get(`${t.me}.3`)!.color as string;
      expect(note).not.toBe('#fff1b3');
      expect(note).not.toBe('#3e63dd');
      expect(t.get(`${t.me}.1`)).not.toHaveProperty('color');
      expect(
        t.root.querySelector('.selbar [aria-label="Colour: blue"]')!.getAttribute('aria-pressed'),
      ).toBe('true');
      expect(t.wb.selection()).toHaveLength(3);
    } finally {
      t.done();
    }
  });

  it('removes them with Delete, but not what is locked', async () => {
    const t = await mount();
    try {
      t.wb.load(
        snapshot([
          sticker(t.me, 1, 100, 100),
          sticker(t.me, 2, 200, 100),
          sticker('other', 3, 300, 100, { lock: 'owner' }),
        ]),
      );
      t.sweep([40, 100], [340, 100]);
      expect(t.wb.selection()).toHaveLength(3);
      keydown('Delete');
      expect((t.wb.items() as unknown as Item[]).map((i) => i.id)).toEqual(['other.3']);
      expect(t.root.textContent).toContain('Some of them are locked');
      expect(t.wb.selection()).toEqual(['other.3']);
    } finally {
      t.done();
    }
  });

  it('copies, cuts and pastes them with what hangs on them, as new items of this person', async () => {
    const t = await mount();
    const guest = await t.room.join('Ana');
    await until(() => guest.host(), 'guest reached host');
    const other = createWhiteboard(box(800, 450), { session: guest, adapter: identity });
    await until(() => t.host.peers().some((p) => p.id === guest.me.id), 'host sees the guest');
    try {
      const a = t.wb.addNote({ x: 100, y: 100 }, 'first')!;
      const b = t.wb.addNote({ x: 300, y: 100 }, 'second')!;
      const pin = t.wb.addPin({ x: 100, y: 100 })!; // on the first note
      const thread = t.wb.addArrow(a, b)!;
      const loose = t.wb.addPin({ x: 600, y: 400 })!;
      expect(t.get(pin)).toMatchObject({ on: a });
      t.wb.selectItems([a, b]);

      const { ev, data } = clip('copy');
      expect(ev.defaultPrevented).toBe(true);
      expect(data.get('text/plain')).toBe('first\nsecond');
      const copied = JSON.parse(data.get('application/x-inksplat-items')!);
      expect(copied.items.map((i: Item) => i.id).sort()).toEqual([a, b, pin, thread].sort());

      const pasted = clip('paste', data);
      expect(pasted.ev.defaultPrevented).toBe(true);
      const items = t.wb.items() as unknown as Item[];
      expect(items).toHaveLength(9);
      const fresh = items.filter((i) => ![a, b, pin, thread, loose].includes(i.id));
      const note = (text: string) => fresh.find((i) => i.text === text)!;
      expect(note('first')).toMatchObject({ x: 120, y: 120, author: t.me });
      expect(note('second')).toMatchObject({ x: 320, y: 120 });
      expect(fresh.find((i) => i.kind === 'pin')).toMatchObject({ on: note('first').id });
      expect(fresh.find((i) => i.kind === 'arrow')).toMatchObject({
        from: note('first').id,
        to: note('second').id,
      });
      expect(t.wb.selection().sort()).toEqual(fresh.map((i) => i.id).sort());
      // (Both boards share this window, so the guest's pastes too: only the host's are counted.)
      await until(
        () => other.items().filter((i) => i.author === t.me).length === 9,
        'the copies reached the guest',
      );

      // Cut: on the clipboard, and gone from the board.
      t.wb.selectItems([a, b]);
      const cut = clip('cut');
      expect(cut.ev.defaultPrevented).toBe(true);
      expect(t.get(a)).toBeUndefined();
      expect(t.get(b)).toBeUndefined();
      // Pasted on another canvas, they are on that one.
      t.wb.setPage(2);
      clip('paste', cut.data);
      expect(t.wb.items().filter((i) => (i as unknown as Item).page === 2)).toHaveLength(4);
    } finally {
      other.destroy();
      t.done();
    }
  });

  it('leaves the clipboard alone with nothing selected or while text is typed', async () => {
    const t = await mount();
    try {
      t.wb.load(snapshot([sticker(t.me, 1, 100, 100)]));
      expect(clip('copy').ev.defaultPrevented).toBe(false);
      t.wb.selectItems([`${t.me}.1`]);
      const field = document.createElement('input');
      document.body.append(field);
      const ev = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', {
        value: { setData: () => {}, getData: () => '' },
      });
      field.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      field.remove();
      // A single item is copied as a selection of one.
      const { data } = clip('copy');
      clip('paste', data);
      expect(t.wb.items()).toHaveLength(2);
      expect(t.wb.selection()).toHaveLength(1);
      expect(t.wb.selection()[0]).not.toBe(`${t.me}.1`);
    } finally {
      t.done();
    }
  });
});
