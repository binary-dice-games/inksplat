// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  cleanItem,
  createWhiteboard,
  drawingGate,
  nearestOnThread,
  splitHeads,
  threadCurve,
  threadSeed,
} from '@inksplat/collab-whiteboard';
import type { ArrowHeads, ArrowItem, PinItem } from '@inksplat/collab-whiteboard';
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

async function mount() {
  const room = new TestRoom();
  const host = await room.start();
  const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
  const root = wb.element.shadowRoot!;
  const board = root.querySelector('svg')!;
  // What the page finds under the pointer: the item with this id (set by `over`), else nothing.
  let find: () => Element | null = () => null;
  Object.defineProperty(root, 'elementsFromPoint', {
    value: () => [find()].filter(Boolean),
  });
  const press = (type: string, x: number, y: number) =>
    board.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  const drag = (from: [number, number], to: [number, number]) => {
    press('pointerdown', ...from);
    press('pointermove', ...to);
    press('pointerup', ...to);
  };
  const threads = () => wb.items().filter((i): i is ArrowItem => i.kind === 'arrow');
  const pins = () => wb.items().filter((i): i is PinItem => i.kind === 'pin');
  const done = () => {
    wb.destroy();
    room.close();
  };
  return {
    room,
    wb,
    root,
    board,
    press,
    drag,
    threads,
    pins,
    done,
    over: (id: string | null) => {
      find = () => (id ? root.querySelector(`[data-id="${id}"]`) : null);
    },
    overLabel: () => {
      find = () => root.querySelector('.pin-label');
    },
  };
}

describe('the thread helpers', () => {
  it('finds the point of a thread nearest to another', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    const { c } = threadCurve(a, b, 0.5);
    const middle = { x: 200, y: (c.y * 2) / 4 }; // the curve at its middle: a quarter of the way to its control point... (a + 2c + b) / 4
    const near = nearestOnThread(a, b, { x: 200, y: middle.y + 6 }, 0.5);
    expect(near.x).toBeCloseTo(200, 0);
    expect(near.y).toBeCloseTo(middle.y, 0);
    // Past an end, it is the end.
    expect(nearestOnThread(a, b, { x: -50, y: -50 }, 0.5)).toEqual(a);
    expect(threadSeed('ana.1')).toBeGreaterThanOrEqual(0);
    expect(threadSeed('ana.1')).toBeLessThan(1);
  });

  it('leaves no head where the two parts of a split thread meet, and keeps the others', () => {
    const cases: [ArrowHeads, string, string][] = [
      ['end', 'none', 'end'],
      ['start', 'start', 'none'],
      ['both', 'start', 'end'],
      ['none', 'none', 'none'],
    ];
    for (const [heads, first, second] of cases) {
      expect(splitHeads(heads), heads).toEqual({ first, second });
    }
  });
});

describe('a thread between any two points', () => {
  it('puts a pin at each end that has none, and ties them', async () => {
    const t = await mount();
    try {
      t.wb.setTool('arrow');
      t.drag([100, 100], [400, 300]);
      expect(t.pins()).toMatchObject([
        { x: 100, y: 100 },
        { x: 400, y: 300 },
      ]);
      expect(t.threads().map((x) => [x.from, x.to])).toEqual([[t.pins()[0]!.id, t.pins()[1]!.id]]);

      // From a pin that is there, or to one, it uses them.
      const [a, b] = t.pins().map((p) => p.id);
      t.drag([400, 300], [600, 100]);
      expect(t.pins()).toHaveLength(3);
      expect(t.threads()[1]).toMatchObject({ from: b, to: t.pins()[2]!.id });
      t.drag([602, 99], [101, 101]);
      expect(t.pins()).toHaveLength(3);
      expect(t.threads()[2]).toMatchObject({ from: t.pins()[2]!.id, to: a });
    } finally {
      t.done();
    }
  });

  it('leaves nothing for a click, or for a thread cancelled', async () => {
    const t = await mount();
    try {
      t.wb.setTool('arrow');
      t.press('pointerdown', 100, 100);
      t.press('pointerup', 101, 101);
      expect(t.wb.items()).toHaveLength(0);
      t.press('pointerdown', 100, 100);
      t.press('pointermove', 300, 300);
      t.press('pointercancel', 300, 300);
      expect(t.wb.items()).toHaveLength(0);
    } finally {
      t.done();
    }
  });
});

describe('splitting a thread', () => {
  async function tied(heads: ArrowHeads) {
    const t = await mount();
    const a = t.wb.addPin({ x: 100, y: 100 })!;
    const b = t.wb.addPin({ x: 500, y: 100 })!;
    t.wb.setStyle({ heads });
    const thread = t.wb.addArrow(a, b)!;
    const { c } = threadCurve({ x: 100, y: 100 }, { x: 500, y: 100 }, threadSeed(thread));
    const middle = { x: 300, y: 100 + (c.y - 100) / 2 }; // the curve at its middle
    return { t, a, b, thread, middle };
  }

  it('with the thread tool: a drag from the thread splits it and pulls a new thread from the pin', async () => {
    const { t, a, b, thread, middle } = await tied('end');
    try {
      t.over(thread);
      t.wb.setTool('arrow');
      t.press('pointerdown', middle.x, middle.y + 3);
      expect(t.root.querySelector('.live circle.pending-pin')).not.toBeNull();
      t.press('pointermove', 300, 380);
      // Nothing is split until the thread is let go.
      expect(t.threads()).toHaveLength(1);
      t.press('pointerup', 300, 380);
      const pin = t.pins().find((p) => p.id !== a && p.id !== b && p.y < 200)!;
      expect(pin.x).toBeCloseTo(middle.x, 0);
      expect(pin.y).toBeCloseTo(middle.y, 0); // on the thread, not where it was pressed
      const found = t.threads();
      expect(found.map((x) => [x.from, x.to, x.heads])).toEqual([
        [a, pin.id, 'none'],
        [pin.id, b, 'end'],
        [pin.id, t.pins().at(-1)!.id, 'end'],
      ]);
      expect(t.pins().at(-1)).toMatchObject({ x: 300, y: 380 });
      // The first part is the thread it was: the same item.
      expect(found[0]!.id).toBe(thread);
    } finally {
      t.done();
    }
  });

  it('with the thread tool: a click on the thread splits nothing, and a pull to a pin ties to it', async () => {
    const { t, a, b, thread, middle } = await tied('both');
    try {
      t.over(thread);
      t.wb.setTool('arrow');
      t.press('pointerdown', middle.x, middle.y);
      t.press('pointerup', middle.x, middle.y);
      expect(t.threads()).toHaveLength(1);
      expect(t.pins()).toHaveLength(2);

      t.drag([middle.x, middle.y], [101, 101]);
      expect(t.pins()).toHaveLength(3);
      const pin = t.pins()[2]!;
      expect(t.threads().map((x) => [x.from, x.to, x.heads])).toEqual([
        [a, pin.id, 'start'],
        [pin.id, b, 'end'],
        [pin.id, a, 'both'], // the new one has the heads in hand
      ]);
    } finally {
      t.done();
    }
  });

  it('with the pin tool: a click on the thread puts a pin on it and splits it', async () => {
    for (const [heads, first, second] of [
      ['end', 'none', 'end'],
      ['start', 'start', 'none'],
      ['both', 'start', 'end'],
      ['none', 'none', 'none'],
    ] as const) {
      const { t, a, b, thread, middle } = await tied(heads);
      try {
        t.over(thread);
        t.wb.setTool('pin');
        t.press('pointerdown', middle.x, middle.y + 2);
        t.press('pointerup', middle.x, middle.y + 2);
        const pin = t.pins().find((p) => p.id !== a && p.id !== b)!;
        expect(pin.y).toBeCloseTo(middle.y, 0);
        expect(
          t.threads().map((x) => [x.from, x.to, x.heads]),
          heads,
        ).toEqual([
          [a, pin.id, first],
          [pin.id, b, second],
        ]);
      } finally {
        t.done();
      }
    }
  });

  it('keeps the colour and the lock, and is refused for a thread locked against this person', async () => {
    const { t, a, b, thread, middle } = await tied('end');
    try {
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      inner.local(() => inner.model.change(thread, { color: '#30a46c', lock: 'owner' }));
      const pin = t.wb.splitThread(thread, middle)!;
      expect(t.threads()).toMatchObject([
        { from: a, to: pin, color: '#30a46c', lock: 'owner' },
        { from: pin, to: b, color: '#30a46c', lock: 'owner' },
      ]);

      // Another person's lock: the thread is not theirs to cut.
      const ana = await t.room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaBoard = createWhiteboard(box(800, 450), { session: ana, adapter: identity });
      await until(() => anaBoard.items().length === 5, 'the board arrived');
      expect(anaBoard.splitThread(thread, middle)).toBeNull();
      expect(anaBoard.items()).toHaveLength(5);
      anaBoard.destroy();
    } finally {
      t.done();
    }
  });
});

describe('the label of a pin', () => {
  const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };
  const pin = { ...base, kind: 'pin', x: 1, y: 2, color: '#e5484d' };

  it('is kept when it is good, with its size and place, and left out (not the pin) when it is not', () => {
    expect(cleanItem({ ...pin, label: 'Start' })).toMatchObject({ kind: 'pin', label: 'Start' });
    expect(cleanItem({ ...pin, label: 'Start' })).not.toHaveProperty('ls');
    expect(cleanItem({ ...pin, label: 'Start', ls: 21, lx: 5, ly: -3 })).toMatchObject({
      ls: 21,
      lx: 5,
      ly: -3,
    });
    expect(cleanItem({ ...pin, label: 'Start', ls: 14 })).not.toHaveProperty('ls'); // the usual
    expect(cleanItem({ ...pin, label: 'Start', ls: 99 })).not.toHaveProperty('ls');
    expect(cleanItem({ ...pin, label: 'Start', lx: 5 })).not.toHaveProperty('lx'); // both or none
    for (const label of ['', '   ', 'a\nb', 'x'.repeat(61), 7]) {
      const kept = cleanItem({ ...pin, label, ls: 21, lx: 1, ly: 1 });
      expect(kept, String(label)).toMatchObject({ kind: 'pin', x: 1, y: 2 });
      expect(kept).not.toHaveProperty('label');
      expect(kept).not.toHaveProperty('ls');
      expect(kept).not.toHaveProperty('lx');
    }
  });

  it('is offered on the bar of the pin: no label, and three sizes that ask for the text', async () => {
    const t = await mount();
    try {
      const id = t.wb.addPin({ x: 200, y: 200 })!;
      t.over(id);
      t.press('pointerdown', 200, 200);
      t.press('pointerup', 200, 200);
      const button = (label: string) =>
        t.root.querySelector<HTMLButtonElement>(`.selbar [aria-label="${label}"]`)!;
      const labels = [...t.root.querySelectorAll('.selbar button')].map((b) =>
        b.getAttribute('aria-label'),
      );
      expect(labels.filter((l) => l?.startsWith('Label'))).toEqual([
        'Label: Small',
        'Label: Medium',
        'Label: Large',
      ]);
      expect(button('No label').getAttribute('aria-pressed')).toBe('true'); // the default
      expect(t.root.querySelector('.pin-label')).toBeNull();

      // A size asks for the text; Enter keeps it, in that size.
      button('Label: Large').click();
      const text = t.root.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(text).not.toBeNull();
      expect(t.wb.items()[0]).not.toHaveProperty('label'); // nothing until it is written
      text.value = '  Start   here ';
      text.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      expect(t.wb.items()[0]).toMatchObject({ label: 'Start here', ls: 21 });
      const drawn = t.root.querySelector('.pin-item .pin-label')!;
      expect(drawn.textContent).toBe('Start here');
      expect(drawn.getAttribute('font-size')).toBe('21');
      expect(t.root.querySelector('textarea')).toBeNull();

      // With a label, the sizes change it, and "no label" takes it away.
      button('Label: Small').click();
      expect(t.wb.items()[0]).toMatchObject({ label: 'Start here', ls: 10 });
      expect(button('Label: Small').getAttribute('aria-pressed')).toBe('true');
      button('Label: Medium').click();
      expect(t.wb.items()[0]).toMatchObject({ label: 'Start here' });
      expect(t.wb.items()[0]).not.toHaveProperty('ls');
      button('No label').click();
      expect(t.wb.items()[0]).not.toHaveProperty('label');
      expect(t.root.querySelector('.pin-label')).toBeNull();
      expect(button('No label').getAttribute('aria-pressed')).toBe('true');

      // Escape drops what was typed.
      button('Label: Medium').click();
      const again = t.root.querySelector<HTMLTextAreaElement>('textarea')!;
      again.value = 'nope';
      again.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      expect(t.wb.items()[0]).not.toHaveProperty('label');
    } finally {
      t.done();
    }
  });

  it('is moved by dragging it, and written again by clicking it once the pin is selected', async () => {
    const t = await mount();
    try {
      const id = t.wb.addPin({ x: 200, y: 200 })!;
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      inner.local(() => inner.model.change(id, { label: 'Here' }));
      const text = () => t.root.querySelector<SVGTextElement>('.pin-label')!;
      expect(Number(text().getAttribute('x'))).toBe(211); // to the right of the pin

      // The label is what is under the pointer: pressing on it drags it, and the pin stays.
      t.overLabel();
      t.press('pointerdown', 215, 200);
      expect(t.root.querySelector('.pin-item.selected')).not.toBeNull();
      t.press('pointermove', 245, 170);
      expect(Number(text().getAttribute('x'))).toBe(241); // follows while dragged...
      expect(t.wb.items()[0]).not.toHaveProperty('lx'); // ...and is kept when let go
      t.press('pointerup', 245, 170);
      expect(t.wb.items()[0]).toMatchObject({ x: 200, y: 200, lx: 41, ly: -38.4 });
      expect(Number(text().getAttribute('x'))).toBe(241);
      expect(Number(text().getAttribute('y'))).toBeCloseTo(161.6, 1);
      expect(t.root.querySelector('textarea')).toBeNull();

      // A click on it (the pin being selected) writes it again; Enter with nothing takes it away.
      t.press('pointerdown', 245, 170);
      t.press('pointerup', 245, 170);
      const box = t.root.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(box.value).toBe('Here');
      box.value = '';
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      const kept = t.wb.items()[0]!;
      expect(kept).not.toHaveProperty('label');
      expect(kept).not.toHaveProperty('lx');
    } finally {
      t.done();
    }
  });

  it('goes to the others, and cannot be moved by someone it is locked against', async () => {
    const t = await mount();
    try {
      const ana = await t.room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaBoard = createWhiteboard(box(800, 450), { session: ana, adapter: identity });
      const id = t.wb.addPin({ x: 200, y: 200 })!;
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      inner.local(() => inner.model.change(id, { label: 'Shared', ls: 21, lx: 3, ly: 4 }));
      await until(() => anaBoard.items().length === 1, 'the pin arrived');
      await until(
        () => (anaBoard.items()[0] as PinItem & { label?: string }).label === 'Shared',
        'the label arrived',
      );
      const root = anaBoard.element.shadowRoot!;
      expect(root.querySelector('.pin-label')?.textContent).toBe('Shared');

      inner.local(() => inner.model.change(id, { lock: 'owner' }));
      await until(() => (anaBoard.items()[0] as { lock?: string }).lock === 'owner', 'locked');
      Object.defineProperty(root, 'elementsFromPoint', {
        value: () => [root.querySelector('.pin-label')],
      });
      const board = root.querySelector('svg')!;
      const at = (type: string, x: number, y: number) =>
        board.dispatchEvent(
          new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
        );
      at('pointerdown', 205, 204);
      at('pointermove', 300, 300);
      at('pointerup', 300, 300);
      expect(anaBoard.items()[0]).toMatchObject({ lx: 3, ly: 4 });
      anaBoard.destroy();
    } finally {
      t.done();
    }
  });
});

describe('the ping of the laser', () => {
  async function pair() {
    const room = new TestRoom();
    const host = await room.start();
    const hostBoard = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const guest = await room.join('Ana');
    await until(() => guest.host(), 'guest reached host');
    const guestBoard = createWhiteboard(box(800, 450), { session: guest, adapter: identity });
    await until(() => host.peers().some((p) => p.id === guest.me.id), 'host sees the guest');
    return { room, hostBoard, guestBoard };
  }
  const at = (board: Element, type: string, x: number, y: number) =>
    board.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );

  it('is what a click makes, shown to the others and stored nowhere', async () => {
    const t = await pair();
    const hostRoot = t.hostBoard.element.shadowRoot!;
    const guestRoot = t.guestBoard.element.shadowRoot!;
    try {
      t.guestBoard.setStyle({ pointerMode: 'laser' });
      const board = guestRoot.querySelector('svg')!;
      at(board, 'pointerdown', 120, 80);
      expect(guestRoot.querySelector('.ping')).toBeNull(); // not until it is let go
      expect(guestRoot.querySelector('.laser-trail')).toBeNull();
      at(board, 'pointermove', 121, 81); // a click may shake a little
      at(board, 'pointerup', 121, 81);
      expect(guestRoot.querySelector('.laser-trail')).toBeNull(); // no line
      const ring = guestRoot.querySelector('.ping circle')!;
      expect(Number(ring.getAttribute('cx'))).toBe(120);
      expect(Number(ring.getAttribute('cy'))).toBe(80);
      await until(() => hostRoot.querySelector('.ping'), 'the host sees the ping');
      expect(hostRoot.querySelector('.laser-trail')).toBeNull();
      expect(t.hostBoard.items()).toHaveLength(0);
      expect(t.guestBoard.items()).toHaveLength(0);
      await until(
        () => !hostRoot.querySelector('.ping') && !guestRoot.querySelector('.ping'),
        'the ping faded',
        5000,
      );
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });

  it('is not made by a drag, which leaves the trail from where it was pressed', async () => {
    const t = await pair();
    const guestRoot = t.guestBoard.element.shadowRoot!;
    try {
      t.guestBoard.setStyle({ pointerMode: 'laser' });
      const board = guestRoot.querySelector('svg')!;
      at(board, 'pointerdown', 100, 100);
      at(board, 'pointermove', 140, 120);
      at(board, 'pointermove', 180, 140);
      at(board, 'pointerup', 180, 140);
      expect(guestRoot.querySelector('.ping')).toBeNull();
      expect(guestRoot.querySelector('.laser-trail')).not.toBeNull();

      // A press that is cancelled is nothing.
      at(board, 'pointerdown', 300, 300);
      at(board, 'pointercancel', 300, 300);
      expect(guestRoot.querySelector('.ping')).toBeNull();
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });

  it('goes through the drawing lock like the laser, and bad ones are not shown', async () => {
    expect(drawingGate(() => false)('wb', { t: 'ping', id: 'p1', x: 1, y: 2 }, 'ana')).toBe(true);
    const t = await pair();
    const hostRoot = t.hostBoard.element.shadowRoot!;
    try {
      const board = t.hostBoard as unknown as {
        remotePing(from: string, m: object): void;
      };
      board.remotePing('ana', { id: '../x', x: 1, y: 2 });
      board.remotePing('ana', { id: 'p1', x: 'a', y: 2 });
      board.remotePing('ana', { id: 'p2', x: 1e9, y: 2 });
      board.remotePing('ana', { id: 'p3', x: 1, y: 2, pg: 3 }); // another canvas
      expect(hostRoot.querySelector('.ping')).toBeNull();
      board.remotePing('ana', { id: 'p4', x: 1, y: 2 });
      board.remotePing('ana', { id: 'p4', x: 1, y: 2 }); // repeated
      expect(hostRoot.querySelectorAll('.ping')).toHaveLength(1);
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });
});
