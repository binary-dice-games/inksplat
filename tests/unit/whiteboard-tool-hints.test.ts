// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { createWhiteboard } from '@inksplat/collab-whiteboard';
import { setToolbarFolded } from '../../viewer/src/fold';
import { TestRoom } from '../support/rooms';

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

const sticker = (author: string, n: number, x: number) => ({
  id: `${author}.${n}`,
  author,
  stamp: [n, author],
  kind: 'sticker',
  x,
  y: 100,
  size: 40,
  name: 'star',
});

async function mount(options: object = {}) {
  const room = new TestRoom();
  const host = await room.start();
  const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity, ...options });
  const tip = wb.element.shadowRoot!.querySelector<HTMLElement>('.tip')!;
  const done = () => {
    wb.destroy();
    room.close();
  };
  return { me: host.me.id, wb, tip, done };
}

describe('tool hints', () => {
  it('follow the tool in hand, the pointer mode and its number', async () => {
    const t = await mount();
    try {
      expect(t.tip.hidden).toBe(false);
      expect(t.tip.textContent).toContain('Drag from an empty place to select');
      expect(t.tip.textContent).toContain('Press 1 again');

      t.wb.setTool('pen');
      expect(t.tip.textContent).toBe('Drag to draw · Press 2 again for another width');
      t.wb.setTool('note');
      expect(t.tip.textContent).toContain('Press 6 again for another shape');
      t.wb.setTool('arrow');
      expect(t.tip.textContent).toContain('Drag from a pin to another');

      t.wb.setTool('pointer');
      t.wb.setStyle({ pointerMode: 'laser' });
      expect(t.tip.textContent).toContain('trail that fades');
      t.wb.setStyle({ pointerMode: 'magnify' });
      expect(t.tip.textContent).toContain('The wheel');
    } finally {
      t.done();
    }
  });

  it('say how to handle a selection, and go while drawing is locked', async () => {
    const t = await mount();
    try {
      t.wb.load({
        v: 1,
        clock: 50,
        clear: [0, ''],
        items: [sticker(t.me, 1, 100), sticker(t.me, 2, 200)],
      });
      t.wb.selectItems([`${t.me}.1`]);
      expect(t.tip.textContent).toContain('Delete removes it');
      t.wb.selectItems([`${t.me}.1`, `${t.me}.2`]);
      expect(t.tip.textContent).toContain('move them all');
      t.wb.selectItems([]);
      expect(t.tip.textContent).toContain('Drag from an empty place');

      t.wb.readOnly = true;
      expect(t.tip.textContent).toBe('');
      t.wb.readOnly = false;
      t.wb.setTool('pin');
      expect(t.tip.textContent).toContain('Click to put a pin down');
    } finally {
      t.done();
    }
  });

  it('can be translated, turned off, and fold away with the toolbar', async () => {
    const t = await mount({ strings: { toolHints: { cursor: 'Hola ({key})' } } });
    try {
      expect(t.tip.textContent).toBe('Hola (1)');
      setToolbarFolded(t.wb, true);
      expect(t.tip.style.display).toBe('none');
      setToolbarFolded(t.wb, false);
      expect(t.tip.style.display).toBe('');
    } finally {
      t.done();
    }
    const off = await mount({ toolHints: false });
    try {
      expect(off.tip.hidden).toBe(true);
    } finally {
      off.done();
    }
  });
});
