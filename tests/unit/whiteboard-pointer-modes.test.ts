// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  EMOTES,
  EMOTE_LEVELS,
  POINTER_MODES,
  createWhiteboard,
  drawingGate,
} from '@inksplat/collab-whiteboard';
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

function pointer(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

/** A host and a guest, each with a board, both on the first canvas. */
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

describe('pins', () => {
  it('are drawn at half size but catch the pointer over the same circle as before', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    try {
      wb.addPin({ x: 100, y: 100 });
      const pin = root.querySelector('.pin-item')!;
      expect(pin.querySelector('circle.paper')?.getAttribute('r')).toBe('2.5');
      expect(pin.querySelector('circle.hit')?.getAttribute('r')).toBe('9');
      expect(pin.querySelector('circle.hit')?.getAttribute('class')).toBe('hit box');

      // The pin of a note: its head is half the circle that catches the pointer.
      wb.addNote({ x: 400, y: 200 }, 'hello');
      const notePin = root.querySelector('.note-item .pin')!;
      const hit = Number(notePin.querySelector('circle.hit')?.getAttribute('r'));
      const head = Number(notePin.querySelectorAll('circle')[1]?.getAttribute('r'));
      expect(hit).toBeGreaterThanOrEqual(4);
      expect(head).toBe(hit / 2);
    } finally {
      wb.destroy();
      room.close();
    }
  });
});

describe('the modes of the pointer tool', () => {
  it('are chosen in its panel or with the 1 key, and the board takes the input outside cursor mode', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    try {
      expect([...POINTER_MODES]).toEqual(['cursor', 'laser', 'emote', 'magnify']);
      expect(board.classList.contains('active')).toBe(false);

      const tool = root.querySelector<HTMLButtonElement>('.toolbar button[data-key="1"]')!;
      tool.click();
      const options = [...root.querySelectorAll<HTMLButtonElement>('.pop button')];
      expect(options).toHaveLength(4);
      expect(options.map((b) => b.getAttribute('aria-pressed'))).toEqual([
        'true',
        'false',
        'false',
        'false',
      ]);
      options[1]!.click();
      expect(board.classList.contains('laser')).toBe(true);
      expect(board.classList.contains('active')).toBe(true);

      keydown('1');
      expect(board.classList.contains('emote')).toBe(true);
      // The magnifier lets the input through, like the cursor.
      keydown('1');
      expect(board.classList.contains('magnify')).toBe(true);
      expect(board.classList.contains('active')).toBe(false);
      keydown('1');
      expect(board.classList.contains('magnify')).toBe(false);

      // Escape goes back to the cursor; another tool keeps the mode for when the pointer comes back.
      wb.setStyle({ pointerMode: 'laser' });
      keydown('Escape');
      expect(board.classList.contains('laser')).toBe(false);
      wb.setStyle({ pointerMode: 'emote' });
      wb.setTool('pen');
      expect(board.classList.contains('emote')).toBe(false);
      wb.setTool('pointer');
      expect(board.classList.contains('emote')).toBe(true);
    } finally {
      wb.destroy();
      room.close();
    }
  });

  it('are not changed by the first press of 1 when the pointer came back by itself', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const board = wb.element.shadowRoot!.querySelector('svg')!;
    try {
      // At the start the pointer is in hand: 1 confirms it, 1 again goes to the laser.
      keydown('1');
      expect(board.classList.contains('active')).toBe(false);
      keydown('1');
      expect(board.classList.contains('laser')).toBe(true);

      // A note put down gives the pointer back (in its laser mode): 1 keeps it so.
      // jsdom has no hit testing: nothing is under the pointer.
      Object.defineProperty(wb.element.shadowRoot!, 'elementsFromPoint', { value: () => [] });
      keydown('6');
      pointer(board, 'pointerdown', 100, 100);
      pointer(board, 'pointerup', 100, 100);
      wb.element.shadowRoot!.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      expect(board.classList.contains('laser')).toBe(true);
      keydown('1');
      expect(board.classList.contains('laser')).toBe(true);
      keydown('1');
      expect(board.classList.contains('emote')).toBe(true);

      // Chosen with its key, the next press goes to the next mode at once.
      keydown('2');
      keydown('1');
      keydown('1');
      expect(board.classList.contains('magnify')).toBe(true); // the next mode after emotes
    } finally {
      wb.destroy();
      room.close();
    }
  });

  it('lets the laser and emotes through the drawing lock, like cursors', () => {
    const gate = drawingGate(() => false);
    expect(gate('wb', { t: 'laser', id: 'l1', seq: 0, pts: [1, 2] }, 'ana')).toBe(true);
    expect(gate('wb', { t: 'emote', id: 'a.e1', name: 'heart', x: 1, y: 2, level: 1 }, 'ana')).toBe(
      true,
    );
    expect(gate('wb', { t: 'ink', id: 'a.1' }, 'ana')).toBe(false);
  });
});

describe('the magnifier', () => {
  it('shows a lens beside the pointer with the content and the drawings enlarged; the wheel sets how much', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const stage = box(800, 450);
    const content = document.createElement('div');
    const picture = document.createElement('div');
    picture.id = 'picture';
    picture.style.background = 'rgb(1, 2, 3)';
    content.append(picture);
    stage.append(content);
    let zoomed = 0;
    const adapter = { ...identity, content: () => content, zoomAt: () => (zoomed += 1) };
    const wb = createWhiteboard(stage, { session: host, adapter });
    const root = wb.element.shadowRoot!;
    const lens = root.querySelector<HTMLElement>('.lens')!;
    const move = (x: number, y: number) =>
      stage.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    try {
      wb.addPin({ x: 400, y: 300 });
      move(400, 300);
      expect(lens.hidden).toBe(true); // only with the magnifier

      wb.setStyle({ pointerMode: 'magnify' });
      move(400, 300);
      expect(lens.hidden).toBe(false);
      // A copy of the content (its ids dropped, its look kept) and the live drawings.
      const copy = lens.querySelector<HTMLElement>('.view > div > div')!;
      expect(copy.id).toBe('');
      expect(copy.style.getPropertyValue('background-color')).toBe('rgb(1, 2, 3)');
      expect(lens.querySelector('use')?.getAttribute('href')).toBe('#wb-layer');
      // Clipped round by a clip-path on an inner layer (border-radius alone left the copy square).
      const glass = lens.querySelector<HTMLElement>(':scope > .glass')!;
      expect(glass.querySelector(':scope > .view')).not.toBeNull();
      expect(glass.querySelector(':scope > .aim')).not.toBeNull();
      expect(root.querySelector('style')?.textContent).toMatch(
        /\.lens \.glass \{[^}]*clip-path: circle\(50%\)/,
      );
      expect(root.querySelector('#wb-layer .pin-item')).not.toBeNull();
      // Up and to the right of the pointer, enlarged 2.5 times about it.
      expect(lens.style.transform).toBe('translate(420px, 60px)');
      const view = lens.querySelector<HTMLElement>('.view')!;
      expect(view.style.transform).toBe('translate(-893px, -643px) scale(2.5)');

      // A zoom of the content moves the copy instead of making it again (with its videos).
      content.style.transformOrigin = '0 0';
      content.style.transform = 'translate(-40px, -20px) scale(2)';
      move(400, 300);
      expect(lens.querySelector('.view > div')).toBe(copy.parentElement);
      expect(copy.parentElement!.style.transform).toBe('translate(-40px, -20px) scale(2)');
      // Another background does make it again.
      picture.style.background = 'rgb(4, 5, 6)';
      move(400, 300);
      expect(lens.querySelector('.view > div')).not.toBe(copy.parentElement);
      content.style.transform = '';

      // Near the top right corner it goes down and to the left.
      move(750, 20);
      expect(lens.style.transform).toBe('translate(510px, 40px)');

      // The wheel enlarges more (or less), and does not zoom the board.
      const wheel = new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 400,
        clientY: 300,
        cancelable: true,
      });
      stage.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(zoomed).toBe(0);
      expect(lens.querySelector<HTMLElement>('.view')!.style.transform).toContain('scale(3)');

      // It goes when the pointer leaves, and with another mode.
      stage.dispatchEvent(new MouseEvent('pointerleave'));
      expect(lens.hidden).toBe(true);
      move(400, 300);
      expect(lens.hidden).toBe(false);
      wb.setStyle({ pointerMode: 'cursor' });
      expect(lens.hidden).toBe(true);
      stage.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }),
      );
      expect(zoomed).toBe(1);
    } finally {
      wb.destroy();
      room.close();
    }
  });
});

describe('the laser', () => {
  it('leaves a trail the others see, which fades away by itself', async () => {
    const t = await pair();
    const hostRoot = t.hostBoard.element.shadowRoot!;
    const guestRoot = t.guestBoard.element.shadowRoot!;
    try {
      t.guestBoard.setStyle({ pointerMode: 'laser' });
      const board = guestRoot.querySelector('svg')!;
      pointer(board, 'pointerdown', 100, 100);
      for (let i = 1; i <= 10; i++) {
        pointer(board, 'pointermove', 100 + i * 10, 100 + i * 5);
      }
      pointer(board, 'pointerup', 200, 150);
      expect(guestRoot.querySelector('.laser-trail')).not.toBeNull();
      await until(() => hostRoot.querySelector('.laser-trail path'), 'the host sees the trail');
      // Nothing is stored on the board.
      expect(t.hostBoard.items()).toHaveLength(0);
      expect(t.guestBoard.items()).toHaveLength(0);
      await until(
        () => !hostRoot.querySelector('.laser-trail') && !guestRoot.querySelector('.laser-trail'),
        'the trail faded',
        5000,
      );
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });

  it('shows on the remote cursor', async () => {
    const t = await pair();
    const hostRoot = t.hostBoard.element.shadowRoot!;
    try {
      t.guestBoard.setStyle({ pointerMode: 'laser' });
      const stage = t.guestBoard.element.parentElement!;
      stage.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 50, clientY: 60, bubbles: true }),
      );
      await until(() => hostRoot.querySelector('.cursor svg.laser'), 'the laser cursor');
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });
});

describe('emotes', () => {
  it('are picked from a wheel: press, move towards one and let go', async () => {
    const t = await pair();
    const hostRoot = t.hostBoard.element.shadowRoot!;
    const guestRoot = t.guestBoard.element.shadowRoot!;
    try {
      t.guestBoard.setStyle({ pointerMode: 'emote' });
      const board = guestRoot.querySelector('svg')!;
      pointer(board, 'pointerdown', 300, 200);
      const wheel = guestRoot.querySelector('.wheel')!;
      expect([...wheel.querySelectorAll('.slot')].map((s) => s.getAttribute('data-name'))).toEqual([
        ...EMOTES,
      ]);
      // Straight right is the third one, clockwise from the top.
      pointer(board, 'pointermove', 360, 200);
      expect(wheel.querySelector('.slot.on')?.getAttribute('data-name')).toBe(EMOTES[2]);
      pointer(board, 'pointerup', 360, 200);
      expect(guestRoot.querySelector('.wheel')).toBeNull();
      expect(guestRoot.querySelector(`.emote[data-name="${EMOTES[2]}"]`)).not.toBeNull();
      await until(() => hostRoot.querySelector(`.emote[data-name="${EMOTES[2]}"]`), 'host sees it');
      expect(t.hostBoard.items()).toHaveLength(0);
      await until(() => !hostRoot.querySelector('.emote'), 'the emote faded', 5000);
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });

  it('stay open after a click for a second click on one, and close on Escape', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    try {
      wb.setStyle({ pointerMode: 'emote' });
      pointer(board, 'pointerdown', 300, 200);
      pointer(board, 'pointerup', 300, 200);
      expect(root.querySelector('.wheel')).not.toBeNull();
      keydown('Escape');
      expect(root.querySelector('.wheel')).toBeNull();

      pointer(board, 'pointerdown', 300, 200);
      pointer(board, 'pointerup', 300, 200);
      // A click straight up: the first emote.
      pointer(board, 'pointerdown', 300, 136);
      pointer(board, 'pointerup', 300, 136);
      expect(root.querySelector('.wheel')).toBeNull();
      expect(root.querySelector(`.emote[data-name="${EMOTES[0]}"]`)).not.toBeNull();
    } finally {
      wb.destroy();
      room.close();
    }
  });

  it('grow when clicked while they live, for everybody, up to the largest size', async () => {
    const t = await pair();
    const hostRoot = t.hostBoard.element.shadowRoot!;
    const guestRoot = t.guestBoard.element.shadowRoot!;
    try {
      const id = t.hostBoard.addEmote('heart', { x: 300, y: 200 });
      expect(id).not.toBeNull();
      expect(t.hostBoard.addEmote('no-such-face', { x: 1, y: 1 })).toBeNull();
      const width = (root: ShadowRoot) =>
        parseFloat((root.querySelector('.emote') as HTMLElement)?.style.width || '0');
      await until(() => width(guestRoot) > 0, 'the guest sees it');
      const first = width(guestRoot);

      // The guest clicks it (it has only just started to rise): it grows, for the host too.
      t.guestBoard.setStyle({ pointerMode: 'emote' });
      const board = guestRoot.querySelector('svg')!;
      pointer(board, 'pointerdown', 300, 195);
      pointer(board, 'pointerup', 300, 195);
      expect(guestRoot.querySelector('.wheel')).toBeNull();
      await until(() => width(guestRoot) > first, 'it grew here');
      await until(() => width(hostRoot) > first, 'it grew for the host');
      expect(EMOTE_LEVELS).toBe(5);
    } finally {
      t.hostBoard.destroy();
      t.guestBoard.destroy();
      t.room.close();
    }
  });
});
