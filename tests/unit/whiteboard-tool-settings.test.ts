// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  HEAD_TYPES,
  THREAD_DASHES,
  THREAD_WIDTHS,
  cleanItem,
  createWhiteboard,
  headsOf,
  threadEnds,
} from '@inksplat/collab-whiteboard';
import type { ArrowItem, TextItem } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';

HTMLCanvasElement.prototype.getContext = () => null;

const identity = {
  transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  onChange: () => () => {},
};

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

function pointer(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

interface Inside {
  tool: string;
  style: Record<string, unknown>;
  cursorFor(tool: string): string;
}

async function mount() {
  const room = new TestRoom();
  const host = await room.start();
  const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
  const root = wb.element.shadowRoot!;
  Object.defineProperty(root, 'elementsFromPoint', { value: () => [] }); // nothing under the pointer
  const tool = (key: string) =>
    root.querySelector<HTMLButtonElement>(`.toolbar button[data-key="${key}"]`)!;
  const pop = () => root.querySelector<HTMLElement>('.pop')!;
  const option = (label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('.pop button')].find(
      (b) => b.getAttribute('aria-label') === label,
    )!;
  const close = () => {
    wb.destroy();
    room.close();
  };
  return { wb, root, tool, pop, option, close, inside: wb as unknown as Inside };
}

const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };
const thread = { ...base, kind: 'arrow', from: 'ana.2', to: 'ana.3', color: '#e5484d' };

describe('the looks of a thread', () => {
  it('keeps a known width, stroke and kind of head, and drops the usual ones or unknown ones', () => {
    expect(
      cleanItem({
        ...thread,
        heads: 'both',
        startHead: 'dot',
        endHead: 'arrow',
        width: 4.6,
        dash: 'dotted',
      }),
    ).toMatchObject({ startHead: 'dot', endHead: 'arrow', width: 4.6, dash: 'dotted' });
    const plain = cleanItem({
      ...thread,
      heads: 'end',
      startHead: 'dot',
      endHead: 'triangle',
      width: 2.6,
      dash: 'solid',
    })!;
    expect(plain).not.toHaveProperty('startHead'); // that end has no head
    expect(plain).not.toHaveProperty('endHead'); // the usual one
    expect(plain).not.toHaveProperty('width');
    expect(plain).not.toHaveProperty('dash');
    const odd = cleanItem({ ...thread, heads: 'both', endHead: 'spear', width: 7, dash: 'wavy' })!;
    expect(odd).toMatchObject({ heads: 'both' });
    expect(odd).not.toHaveProperty('endHead');
    expect(odd).not.toHaveProperty('width');
    expect(odd).not.toHaveProperty('dash');
  });

  it('gives the head at each end, and the fields of a thread with given ends', () => {
    expect(threadEnds({ heads: 'start', startHead: 'bar', endHead: 'dot' })).toEqual({
      start: 'bar',
      end: 'none',
    });
    expect(threadEnds({ heads: 'both' })).toEqual({ start: 'triangle', end: 'triangle' });
    expect(headsOf('none', 'diamond')).toEqual({
      heads: 'end',
      startHead: undefined,
      endHead: 'diamond',
    });
    expect(headsOf('arrow', 'arrow').heads).toBe('both');
    expect(headsOf('none', 'none').heads).toBe('none');
    for (const type of HEAD_TYPES) {
      expect(threadEnds(headsOf(type, 'none'))).toEqual({ start: type, end: 'none' });
    }
  });

  it('draws each kind of head, the width and the stroke', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 300, y: 100 })!;
      t.wb.setStyle({
        threadWidth: THREAD_WIDTHS[0],
        dash: 'dotted',
        startHead: 'bar',
        endHead: 'arrow',
      });
      t.wb.addArrow(a, b);
      const paper = t.root.querySelector('.arrow-item .paper')!;
      expect(paper.getAttribute('stroke-width')).toBe(String(THREAD_WIDTHS[0]));
      expect(paper.getAttribute('stroke-dasharray')).toMatch(/^0 /); // dots
      // An open arrow and a bar are lines (polylines) in the thread's colour.
      expect(t.root.querySelectorAll('.arrow-item g:not(.shadow) > polyline')).toHaveLength(2);
      for (const dash of THREAD_DASHES) {
        t.wb.setStyle({ dash });
        expect(t.inside.style.dash).toBe(dash);
      }
    } finally {
      t.close();
    }
  });

  it('keeps the looks of a thread in both parts when it is split', async () => {
    const t = await mount();
    try {
      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 300, y: 100 })!;
      t.wb.setStyle({
        threadWidth: THREAD_WIDTHS[2],
        dash: 'dashed',
        startHead: 'dot',
        endHead: 'diamond',
      });
      const id = t.wb.addArrow(a, b)!;
      t.wb.splitThread(id, { x: 200, y: 140 });
      const threads = t.wb.items().filter((i): i is ArrowItem => i.kind === 'arrow');
      expect(threads).toHaveLength(2);
      expect(threads[0]).toMatchObject({
        heads: 'start',
        startHead: 'dot',
        width: 4.6,
        dash: 'dashed',
      });
      expect(threads[0]).not.toHaveProperty('endHead');
      expect(threads[1]).toMatchObject({
        heads: 'end',
        endHead: 'diamond',
        width: 4.6,
        dash: 'dashed',
      });
      expect(threads[1]).not.toHaveProperty('startHead');
    } finally {
      t.close();
    }
  });
});

describe('the settings of the thread and text tools', () => {
  it('set the width, stroke and each head of new threads in one panel that stays open', async () => {
    const t = await mount();
    try {
      t.tool('8').click();
      const groups = [...t.pop().querySelectorAll('.group')].map((g) =>
        g.getAttribute('aria-label'),
      );
      expect(groups).toEqual(['Line width', 'Line style', 'Start head', 'End head']);
      expect(t.pop().querySelectorAll('button')).toHaveLength(3 + 3 + 6 + 6);
      const rows = [...t.pop().querySelectorAll<HTMLElement>('.row')].map(
        (r) => r.style.gridTemplateColumns,
      );
      expect(rows).toEqual([
        'repeat(3, 34px)',
        'repeat(3, 34px)',
        'repeat(6, 34px)',
        'repeat(6, 34px)',
      ]);
      // Each group has one choice pressed.
      for (const g of t.pop().querySelectorAll('.group')) {
        expect(g.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
      }
      t.option('Line width: Thick').click();
      expect(t.pop().hidden).toBe(false); // still open
      t.option('Line style: Dotted').click();
      t.option('Start head: Diamond').click();
      t.option('End head: Arrow').click();
      expect(t.option('End head: Arrow').getAttribute('aria-pressed')).toBe('true');
      expect(t.inside.style).toMatchObject({
        threadWidth: 4.6,
        dash: 'dotted',
        heads: 'both',
        startHead: 'diamond',
        endHead: 'arrow',
      });
      t.option('End head: None').click();
      expect(t.inside.style.heads).toBe('start');
      // The tool button closes it again.
      t.tool('8').click();
      expect(t.pop().hidden).toBe(true);

      const a = t.wb.addPin({ x: 100, y: 100 })!;
      const b = t.wb.addPin({ x: 300, y: 100 })!;
      t.wb.addArrow(a, b);
      expect(t.wb.items().find((i) => i.kind === 'arrow')).toMatchObject({
        heads: 'start',
        startHead: 'diamond',
        width: 4.6,
        dash: 'dotted',
      });
    } finally {
      t.close();
    }
  });

  it("keeps the kind of an end's head when the key goes through the heads", async () => {
    const t = await mount();
    try {
      t.wb.setStyle({ endHead: 'dot', startHead: 'bar' });
      expect(t.inside.style.heads).toBe('both');
      t.wb.setStyle({ startHead: 'none' }); // the kind is kept for later
      expect(t.inside.style).toMatchObject({ heads: 'end', startHead: 'bar' });
      t.wb.setTool('arrow');
      t.wb.chooseSlot(8); // end -> both
      expect(t.inside.style).toMatchObject({ heads: 'both', startHead: 'bar', endHead: 'dot' });
    } finally {
      t.close();
    }
  });

  it('set the size and font of new texts', async () => {
    const t = await mount();
    try {
      t.tool('3').click();
      const groups = [...t.pop().querySelectorAll('.group')].map((g) =>
        g.getAttribute('aria-label'),
      );
      expect(groups).toEqual(['Text size', 'Font']);
      t.option('Text size: Large').click();
      expect(t.pop().hidden).toBe(false);
      t.option('Font: Handwriting').click();
      expect(t.inside.style).toMatchObject({ size: 33, font: 'hand' });
      t.tool('3').click(); // closes the panel

      const board = t.root.querySelector('svg')!;
      pointer(board, 'pointerdown', 200, 200);
      pointer(board, 'pointerup', 200, 200);
      const ta = t.root.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(ta.style.fontFamily).toContain('Comic Sans');
      ta.value = 'hello';
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      const text = t.wb.items().find((i): i is TextItem => i.kind === 'text')!;
      expect(text).toMatchObject({ text: 'hello', size: 33, font: 'hand' });
    } finally {
      t.close();
    }
  });
});

describe('the cursor of the tool in hand', () => {
  it('shows a picture of the tool beside a crosshair, and the page cursor for the pointer', async () => {
    const t = await mount();
    try {
      expect(t.inside.cursorFor('pointer')).toBe('');
      for (const tool of ['pen', 'text', 'sticker', 'eraser', 'note', 'pin', 'arrow']) {
        const cursor = t.inside.cursorFor(tool);
        expect(cursor, tool).toMatch(/^url\("data:image\/svg\+xml,.*"\) 7 7, crosshair$/);
      }
      // It follows the options and the colour in hand.
      const before = t.inside.cursorFor('arrow');
      t.wb.setStyle({ endHead: 'dot' });
      expect(t.inside.cursorFor('arrow')).not.toBe(before);
      t.wb.setStyle({ color: '#3e63dd' });
      expect(decodeURIComponent(t.inside.cursorFor('pen'))).toContain('#3e63dd');
      // White ink shows dark on the white badge.
      t.wb.setStyle({ color: '#ffffff' });
      expect(decodeURIComponent(t.inside.cursorFor('pen'))).toContain('color="#1c2024"');
      t.wb.setStyle({ pointerMode: 'laser' });
      expect(t.inside.cursorFor('pointer')).toContain('data:image/svg+xml');
    } finally {
      t.close();
    }
  });
});
