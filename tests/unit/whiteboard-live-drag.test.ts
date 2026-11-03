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

const identity = {
  transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  onChange: () => () => {},
};

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

async function pair() {
  const room = new TestRoom();
  const host = await room.start();
  const hostBoard = createWhiteboard(box(800, 450), { session: host, adapter: identity });
  const guest = await room.join('Ana');
  await until(() => guest.host(), 'guest reached host');
  const guestBoard = createWhiteboard(box(800, 450), { session: guest, adapter: identity });
  await until(() => host.peers().some((p) => p.id === guest.me.id), 'host sees the guest');
  const hostRoot = hostBoard.element.shadowRoot!;
  const guestRoot = guestBoard.element.shadowRoot!;
  const board = hostRoot.querySelector('svg')!;
  let under: string | null = null;
  Object.defineProperty(hostRoot, 'elementsFromPoint', {
    value: () => [under ? hostRoot.querySelector(`[data-id="${under}"]`) : null].filter(Boolean),
  });
  const press = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
    board.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }),
    );
  return {
    hostBoard,
    guestBoard,
    hostRoot,
    guestRoot,
    press,
    over: (id: string) => {
      under = id;
    },
    done: () => {
      hostBoard.destroy();
      guestBoard.destroy();
      room.close();
    },
  };
}

describe('items being edited, seen by the others as it happens', () => {
  it('shows a note moving before it is let go, and as it is when it is', async () => {
    const t = await pair();
    try {
      const id = t.hostBoard.addNote({ x: 300, y: 200 })!;
      await until(() => t.guestBoard.items().length === 1, 'the note arrived');
      const node = () => t.guestRoot.querySelector(`[data-id="${id}"]`)!;
      t.over(id);
      t.press('pointerdown', 300, 200);
      t.press('pointermove', 340, 210);
      await until(() => node().getAttribute('transform') === 'translate(40 10)', 'it moves there');
      expect((t.guestBoard.items()[0] as unknown as { x: number }).x).toBe(300); // the note is not changed yet

      // And back and forth: a shake (the sender sends at most every 33 ms).
      await new Promise((resolve) => setTimeout(resolve, 50));
      t.press('pointermove', 280, 190);
      await until(() => node().getAttribute('transform') === 'translate(-20 -10)', 'it shakes');

      t.press('pointerup', 280, 190);
      const moved = t.hostBoard.items()[0] as unknown as { x: number };
      await until(
        () => (t.guestBoard.items()[0] as unknown as { x: number }).x === moved.x,
        'the move arrived',
      );
      await until(() => !node().hasAttribute('transform'), 'the preview is gone');
    } finally {
      t.done();
    }
  });

  it('shows a note turning and scaling, and puts it back when the gesture is cancelled', async () => {
    const t = await pair();
    try {
      const id = t.hostBoard.addNote({ x: 300, y: 200 })!;
      await until(() => t.guestBoard.items().length === 1, 'the note arrived');
      const before = t.guestRoot.querySelector(`[data-id="${id}"]`)!.outerHTML;
      const rot = (t.guestBoard.items()[0] as unknown as { rot?: number }).rot;
      t.over(id);
      t.press('pointerdown', 300, 200);
      t.press('pointermove', 360, 260, { ctrlKey: true });
      await until(
        () => t.guestRoot.querySelector(`[data-id="${id}"]`)!.outerHTML !== before,
        'it turns',
      );
      expect((t.guestBoard.items()[0] as unknown as { rot?: number }).rot).toBe(rot); // not changed yet
      t.press('pointercancel', 360, 260);
      await until(
        () => t.guestRoot.querySelector(`[data-id="${id}"]`)!.outerHTML === before,
        'it is put back',
      );
    } finally {
      t.done();
    }
  });

  it('ignores bad or late messages', async () => {
    const t = await pair();
    try {
      const id = t.hostBoard.addNote({ x: 300, y: 200 })!;
      await until(() => t.guestBoard.items().length === 1, 'the note arrived');
      const inner = t.guestBoard as unknown as { remoteDrag(from: string, m: object): void };
      const node = () => t.guestRoot.querySelector(`[data-id="${id}"]`)!;
      inner.remoteDrag('ana', { g: '../x', seq: 0, ids: [id], dx: 5, dy: 5 });
      inner.remoteDrag('ana', { g: 'd1', seq: 0, ids: [id], dx: 'a', dy: 5 });
      inner.remoteDrag('ana', { g: 'd1', seq: 0, ids: [id], f: { size: 1e9 } });
      inner.remoteDrag('ana', { g: 'd1', seq: 0, ids: [id], f: { text: 'x' } });
      inner.remoteDrag('ana', { g: 'd1', seq: 0, ids: [id, id], f: { x: 1 } });
      inner.remoteDrag('ana', { g: 'd1', seq: 0, ids: [id], dx: 5, dy: 5, pg: 2 });
      inner.remoteDrag('ana', { g: 'd1', seq: 0, ids: ['nothing'], dx: 5, dy: 5 });
      expect(node().hasAttribute('transform')).toBe(false);

      inner.remoteDrag('ana', { g: 'd2', seq: 1, ids: [id], dx: 5, dy: 6 });
      expect(node().getAttribute('transform')).toBe('translate(5 6)');
      inner.remoteDrag('ana', { g: 'd2', seq: 0, ids: [id], dx: 50, dy: 60 }); // late
      expect(node().getAttribute('transform')).toBe('translate(5 6)');
      inner.remoteDrag('ana', { g: 'd2', end: true });
      expect(node().hasAttribute('transform')).toBe(false);
      inner.remoteDrag('ana', { g: 'd2', seq: 2, ids: [id], dx: 7, dy: 7 }); // after its end
      expect(node().hasAttribute('transform')).toBe(false);
    } finally {
      t.done();
    }
  });
});
