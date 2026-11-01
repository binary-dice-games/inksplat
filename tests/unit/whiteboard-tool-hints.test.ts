// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { createWhiteboard } from '@inksplat/collab-whiteboard';
import { setToolbarFolded } from '../../viewer/src/fold';
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
  /** The hint text while it is shown, else ''. */
  const shown = () => (tip.classList.contains('on') && !tip.hidden ? tip.textContent : '');
  const done = () => {
    wb.destroy();
    room.close();
  };
  return { me: host.me.id, wb, tip, shown, done };
}

describe('tool hints', () => {
  it('show for a moment when the tool or the pointer mode changes, with its number', async () => {
    const t = await mount({ toolHintMs: 60 });
    try {
      expect(t.shown()).toBe(''); // not at the start

      t.wb.setTool('pen');
      expect(t.shown()).toBe('Drag to draw · Press 2 again for another width');
      await until(() => t.shown() === '', 'the hint goes after a moment');

      t.wb.setStyle({ color: '#e5484d' }); // the same tool: nothing shows
      expect(t.shown()).toBe('');
      t.wb.setTool('note');
      expect(t.shown()).toContain('Press 6 again for another shape');
      t.wb.setTool('arrow');
      expect(t.shown()).toContain('Drag from a pin to another');

      t.wb.setTool('pointer');
      expect(t.shown()).toContain('Press 1 again for the laser');
      t.wb.setStyle({ pointerMode: 'laser' });
      expect(t.shown()).toContain('trail that fades');
      t.wb.setStyle({ pointerMode: 'magnify' });
      expect(t.shown()).toContain('The wheel');
    } finally {
      t.done();
    }
  });

  it('say how to handle a selection, and go when it is let go or drawing is locked', async () => {
    const t = await mount();
    try {
      t.wb.load({
        v: 1,
        clock: 50,
        clear: [0, ''],
        items: [sticker(t.me, 1, 100), sticker(t.me, 2, 200)],
      });
      t.wb.selectItems([`${t.me}.1`]);
      expect(t.shown()).toContain('Delete removes it');
      t.wb.selectItems([`${t.me}.1`, `${t.me}.2`]);
      expect(t.shown()).toContain('move them all');
      t.wb.selectItems([]);
      expect(t.shown()).toBe('');

      t.wb.setTool('pin');
      expect(t.shown()).toContain('Click to put a pin down');
      t.wb.readOnly = true;
      expect(t.shown()).toBe('');
    } finally {
      t.done();
    }
  });

  it('can be translated, turned off and on, and fold away with the toolbar', async () => {
    const t = await mount({ strings: { toolHints: { pen: 'Dibuja ({key})' } } });
    try {
      t.wb.setTool('pen');
      expect(t.shown()).toBe('Dibuja (2)');
      setToolbarFolded(t.wb, true);
      expect(t.tip.style.display).toBe('none');
      setToolbarFolded(t.wb, false);
      expect(t.tip.style.display).toBe('');

      t.wb.setToolHints(false);
      expect(t.wb.toolHintsShown).toBe(false);
      t.wb.setTool('pen');
      expect(t.shown()).toBe('');
      t.wb.setToolHints(true);
      t.wb.setTool('eraser');
      expect(t.shown()).toContain('Drag over what to remove');
    } finally {
      t.done();
    }
    const off = await mount({ toolHints: false });
    try {
      off.wb.setTool('pen');
      expect(off.shown()).toBe('');
    } finally {
      off.done();
    }
  });
});
