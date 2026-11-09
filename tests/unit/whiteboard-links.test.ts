// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LINK_ICON_ORIGIN,
  cleanItem,
  cleanUrl,
  createWhiteboard,
  frameAdapter,
  linkIconOf,
} from '@inksplat/collab-whiteboard';
import type { PreparedFile } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

async function prepare(file: File): Promise<PreparedFile> {
  return { data: PNG, width: 320, height: 400, card: true, name: file.name, blob: null };
}

const stamp = { stamp: [1, 'ana'] as [number, string], id: 'ana.1', author: 'ana' };

describe('web addresses', () => {
  it('keeps http and https links, normalised', () => {
    expect(cleanUrl('https://Example.com/a%20b?x=1')).toBe('https://example.com/a%20b?x=1');
    expect(cleanUrl('  http://example.com  ')).toBe('http://example.com/');
  });

  it('refuses anything else a peer could pin', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
      'example.com',
      'https://',
      'https://a.example/\n\nsecond',
      `https://example.com/${'a'.repeat(2000)}`,
      42,
      null,
    ]) {
      expect(cleanUrl(bad), String(bad)).toBeNull();
    }
  });

  it('is a valid item only with a good address and size', () => {
    const link = { kind: 'link', x: 10, y: 20, size: 200, url: 'https://example.com/', ...stamp };
    expect(cleanItem(link)).toMatchObject({ kind: 'link', url: 'https://example.com/' });
    expect(cleanItem({ ...link, rot: 5 })).toMatchObject({ rot: 5 });
    expect(cleanItem({ ...link, url: 'javascript:alert(1)' })).toBeNull();
    expect(cleanItem({ ...link, size: 5 })).toBeNull();
    expect(cleanItem({ ...link, size: 5000 })).toBeNull();
    expect(cleanItem({ ...link, extra: 'x' })).not.toHaveProperty('extra');
  });
});

describe('site icons', () => {
  it('asks the icon service for the site name only', () => {
    expect(linkIconOf('https://www.example.com/a/secret?token=1#x')).toBe(
      `${LINK_ICON_ORIGIN}/ip3/www.example.com.ico`,
    );
    expect(linkIconOf('http://docs.Python.org/3/')).toBe(
      `${LINK_ICON_ORIGIN}/ip3/docs.python.org.ico`,
    );
  });

  it('never sends a name that is not public', () => {
    for (const url of [
      'http://192.168.1.10/admin',
      'http://[::1]:8080/',
      'http://localhost:3000/',
      'http://intranet/wiki',
      'http://printer.local/',
      'https://build.corp/job/1',
      'javascript:alert(1)',
      null,
    ]) {
      expect(linkIconOf(url), String(url)).toBeNull();
    }
  });

  it('is allowed by the img-src of the pages that show the board', () => {
    for (const page of ['index.html', 'present.html']) {
      const html = readFileSync(
        join(import.meta.dirname, '..', '..', 'viewer', 'src', page),
        'utf8',
      );
      expect(/img-src ([^;"]+)/.exec(html)?.[1]?.split(/\s+/), page).toContain(LINK_ICON_ORIGIN);
    }
  });
});

describe('pinned things', () => {
  async function setup(random = () => 0.5) {
    const room = new TestRoom();
    const host = await room.start();
    const stage = box(800, 450);
    const opened: string[] = [];
    const wb = createWhiteboard(stage, {
      session: host,
      adapter: frameAdapter(stage, () => 16 / 9),
      prepareFile: prepare,
      random,
      openUrl: (url) => opened.push(url),
    });
    const shadow = () => wb.element.shadowRoot!;
    return { room, host, stage, wb, opened, shadow };
  }

  it('tilts a file or a link by a few degrees, never more than 7', async () => {
    const t = await setup();
    try {
      for (const random of [0, 1, 0.25, 0.8]) {
        const seeded = await setup(() => random);
        await seeded.wb.addFile(new File(['x'], 'a.txt'));
        seeded.wb.addLink('https://example.com/');
        const turns = seeded.wb
          .items()
          .map((i) => (i.kind === 'image' || i.kind === 'link' ? i.rot : 0));
        expect(turns).toHaveLength(2);
        for (const rot of turns) {
          expect(Math.abs(rot ?? 0)).toBeLessThanOrEqual(7);
        }
        if (random === 0) {
          expect(turns).toEqual([-7, -7]);
        }
        seeded.wb.destroy();
        seeded.room.close();
      }
      // The middle of the range is no turn at all.
      await t.wb.addFile(new File(['x'], 'a.txt'));
      expect(t.wb.items()[0]).not.toHaveProperty('rot');
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('really varies with the default random numbers', async () => {
    const t = await setup(Math.random);
    try {
      for (let i = 0; i < 12; i++) {
        t.wb.addLink(`https://example.com/${i}`);
      }
      const turns = new Set(t.wb.items().map((i) => (i.kind === 'link' ? i.rot : 0)));
      expect(turns.size).toBeGreaterThan(3);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('draws a link as a card of its address, with the whole address as its tooltip', async () => {
    const t = await setup();
    try {
      const id = t.wb.addLink('https://www.example.com/docs/guide?page=2', { x: 300, y: 200 });
      expect(id).not.toBeNull();
      const node = t.shadow().querySelector('.link-item')!;
      expect(node.textContent).toContain('example.com');
      expect(node.textContent).toContain('/docs/guide?page=2');
      expect(node.textContent).toContain('Click to open');
      expect(node.querySelector('title')?.textContent).toBe(
        'https://www.example.com/docs/guide?page=2',
      );
      t.wb.addLink('http://plain.example/');
      expect(t.shadow().textContent).toContain('not encrypted');
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('shows the site icon once it loads, and the globe when there is none', async () => {
    const t = await setup();
    try {
      t.wb.addLink('https://example.org/page');
      const badge = () => t.shadow().querySelector('.link-item .site-icon');
      const image = badge()!.querySelector('image')!;
      expect(image.getAttribute('href')).toBe(`${LINK_ICON_ORIGIN}/ip3/example.org.ico`);
      expect(badge()!.getAttribute('opacity')).toBe('0');
      image.dispatchEvent(new Event('load'));
      expect(badge()!.getAttribute('opacity')).toBe('1');
      // An icon that fails is dropped, and not asked for again on the next card of the site.
      image.dispatchEvent(new Event('error'));
      expect(badge()).toBeNull();
      t.wb.addLink('https://example.org/other');
      expect(t.shadow().querySelectorAll('.site-icon')).toHaveLength(0);
      // A local address keeps the globe; saved pictures never point outside.
      t.wb.addLink('https://example.net/');
      t.wb.addLink('http://192.168.0.1/');
      expect(t.shadow().querySelectorAll('.site-icon')).toHaveLength(1);
      expect(t.wb.toSvg()).not.toContain(LINK_ICON_ORIGIN);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('keeps the globe with linkIcons off', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const stage = box(800, 450);
    const wb = createWhiteboard(stage, {
      session: host,
      adapter: frameAdapter(stage, () => 16 / 9),
      linkIcons: false,
    });
    try {
      wb.addLink('https://example.org/page');
      expect(wb.element.shadowRoot!.querySelector('.link-item')).not.toBeNull();
      expect(wb.element.shadowRoot!.querySelector('.site-icon')).toBeNull();
    } finally {
      wb.destroy();
      room.close();
    }
  });

  it('refuses a bad address and a read-only board', async () => {
    const t = await setup();
    try {
      expect(() => t.wb.addLink('javascript:alert(1)')).toThrow(/web address/);
      t.wb.readOnly = true;
      expect(t.wb.addLink('https://example.com/')).toBeNull();
      expect(t.wb.items()).toHaveLength(0);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('opens the page when the card is clicked with the pointer tool, not with other tools', async () => {
    const t = await setup();
    try {
      t.wb.addLink('https://example.com/page');
      const node = t.shadow().querySelector('.link-item')!;
      Object.defineProperty(t.shadow(), 'elementsFromPoint', { value: () => [node] });
      const board = t.shadow().querySelector('svg')!;
      const click = () => board.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      click();
      expect(t.opened).toEqual(['https://example.com/page']);
      t.wb.setTool('pen');
      click();
      expect(t.opened).toHaveLength(1);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('pins an address that is pasted or dropped, and leaves notes and other text alone', async () => {
    const t = await setup();
    try {
      const paste = (text: string, target: EventTarget = window) => {
        const ev = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', {
          value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
        });
        target.dispatchEvent(ev);
        return ev;
      };
      expect(paste('just some words').defaultPrevented).toBe(false);
      const field = document.createElement('textarea');
      document.body.append(field);
      expect(paste('https://example.com/typed', field).defaultPrevented).toBe(false);
      expect(t.wb.items()).toHaveLength(0);
      expect(paste('https://example.com/pasted').defaultPrevented).toBe(true);
      expect(t.wb.items()).toMatchObject([{ kind: 'link', url: 'https://example.com/pasted' }]);

      const drop = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 60,
        clientY: 50,
      });
      Object.defineProperty(drop, 'dataTransfer', {
        value: {
          types: ['text/uri-list', 'text/plain'],
          files: [],
          getData: (type: string) =>
            type === 'text/uri-list' ? '# a comment\r\nhttps://example.com/dropped\r\n' : '',
        },
      });
      t.stage.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      expect(t.wb.items().map((i) => (i.kind === 'link' ? i.url : ''))).toEqual([
        'https://example.com/pasted',
        'https://example.com/dropped',
      ]);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('shows the link to the others, who can click it too', async () => {
    const t = await setup();
    try {
      const ana = await t.room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaStage = box(800, 450);
      const opened: string[] = [];
      const anaBoard = createWhiteboard(anaStage, {
        session: ana,
        adapter: frameAdapter(anaStage, () => 16 / 9),
        openUrl: (url) => opened.push(url),
      });
      t.wb.addLink('https://example.com/shared');
      await until(() => anaBoard.items().length === 1, 'the link arrived');
      const node = anaBoard.element.shadowRoot!.querySelector('.link-item')!;
      Object.defineProperty(anaBoard.element.shadowRoot!, 'elementsFromPoint', {
        value: () => [node],
      });
      anaBoard.element
        .shadowRoot!.querySelector('svg')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(opened).toEqual(['https://example.com/shared']);
      anaBoard.destroy();
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });
});
