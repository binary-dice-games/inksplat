// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { cleanItem, createWhiteboard } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';

HTMLCanvasElement.prototype.getContext = () => null;

const identity = {
  transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  onChange: () => () => {},
};

type Item = { id: string; kind: string; [k: string]: unknown };

async function mount() {
  const room = new TestRoom();
  const host = await room.start();
  const stage = document.createElement('div');
  Object.defineProperty(stage, 'clientWidth', { value: 800 });
  Object.defineProperty(stage, 'clientHeight', { value: 450 });
  document.body.append(stage);
  const wb = createWhiteboard(stage, { session: host, adapter: identity });
  const root = wb.element.shadowRoot!;
  const me = host.me.id;
  wb.load({
    v: 1,
    clock: 50,
    clear: [0, ''],
    items: [
      {
        id: `${me}.1`,
        author: me,
        stamp: [1, me],
        kind: 'ink',
        points: [100, 100, 160, 120],
        color: '#e5484d',
        width: 4,
      },
      {
        id: `${me}.2`,
        author: me,
        stamp: [2, me],
        kind: 'text',
        x: 300,
        y: 200,
        size: 21,
        text: 'hello',
        color: '#e5484d',
      },
    ],
  });
  const get = (id: string) => (wb.items() as unknown as Item[]).find((i) => i.id === id)!;
  const button = (label: string) =>
    root.querySelector<HTMLButtonElement>(`.selbar [aria-label="${label}"]`)!;
  const done = () => {
    wb.destroy();
    room.close();
  };
  return { me, wb, root, get, button, done };
}

describe('the bar over a selected line or text', () => {
  it('changes the width and colour of a line', async () => {
    const t = await mount();
    try {
      t.wb.selectItems([`${t.me}.1`]);
      expect(t.button('Line width: Normal').getAttribute('aria-pressed')).toBe('true');
      t.button('Line width: Thick').click();
      expect(t.get(`${t.me}.1`)).toMatchObject({ width: 8 });
      t.button('Colour: blue').click();
      expect(t.get(`${t.me}.1`)).toMatchObject({ color: '#3e63dd' });
    } finally {
      t.done();
    }
  });

  it('changes the size, font and colour of a text', async () => {
    const t = await mount();
    try {
      t.wb.selectItems([`${t.me}.2`]);
      t.button('Text size: Large').click();
      expect(t.get(`${t.me}.2`)).toMatchObject({ size: 33 });
      t.button('Font: Monospace').click();
      expect(t.get(`${t.me}.2`)).toMatchObject({ font: 'mono' });
      expect(t.root.querySelector('.text-item text')!.getAttribute('font-family')).toContain(
        'mono',
      );
      t.button('Font: Sans serif').click();
      expect(t.get(`${t.me}.2`)).not.toHaveProperty('font');
      t.button('Colour: green').click();
      expect(t.get(`${t.me}.2`)).toMatchObject({ color: '#30a46c' });
    } finally {
      t.done();
    }
  });
});

describe('cleanItem for a text', () => {
  const text = {
    id: 'a.1',
    author: 'a',
    stamp: [1, 'a'],
    kind: 'text',
    x: 1,
    y: 1,
    size: 21,
    text: 'x',
    color: '#000000',
  };

  it('keeps a known font and drops the default or an unknown one', () => {
    expect(cleanItem({ ...text, font: 'serif' })).toMatchObject({ font: 'serif' });
    expect(cleanItem({ ...text, font: 'sans' })).not.toHaveProperty('font');
    expect(cleanItem({ ...text, font: 'Wingdings' })).not.toHaveProperty('font');
  });
});
