// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMBED_ORIGINS,
  createWhiteboard,
  embedOf,
  frameAdapter,
  pinPoint,
} from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';

const ROOT = join(import.meta.dirname, '..', '..');

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

describe('embedOf', () => {
  it('turns YouTube links of every shape into the privacy-enhanced player', () => {
    const player = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(embedOf(url), url).toEqual({ src: player, ratio: 9 / 16, site: 'YouTube' });
    }
    expect(embedOf('https://www.youtube.com/shorts/abcdEFGH123')).toMatchObject({
      src: 'https://www.youtube-nocookie.com/embed/abcdEFGH123',
      ratio: 16 / 9,
    });
  });

  it('keeps the start time and the playlist of a YouTube link', () => {
    expect(embedOf('https://youtu.be/dQw4w9WgXcQ?t=90')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90',
    );
    expect(embedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90',
    );
    expect(embedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?list=PL123456',
    );
    expect(embedOf('https://www.youtube.com/playlist?list=PL123456')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/videoseries?list=PL123456',
    );
  });

  it('knows Vimeo, Loom, Google Drive and Figma', () => {
    expect(embedOf('https://vimeo.com/76979871')?.src).toBe(
      'https://player.vimeo.com/video/76979871',
    );
    expect(embedOf('https://vimeo.com/76979871/abc123def0')?.src).toBe(
      'https://player.vimeo.com/video/76979871?h=abc123def0',
    );
    expect(embedOf('https://player.vimeo.com/video/76979871?h=abc123def0')?.src).toBe(
      'https://player.vimeo.com/video/76979871?h=abc123def0',
    );
    const loom = '0123456789abcdef0123456789abcdef';
    expect(embedOf(`https://www.loom.com/share/${loom}?sid=x`)).toEqual({
      src: `https://www.loom.com/embed/${loom}`,
      ratio: 9 / 16,
      site: 'Loom',
    });
    expect(embedOf('https://drive.google.com/file/d/1AbC-dEf_G/view?usp=sharing')?.src).toBe(
      'https://drive.google.com/file/d/1AbC-dEf_G/preview',
    );
    expect(embedOf('https://www.figma.com/file/AbCdEf123456/My-file?node-id=1-2')).toEqual({
      src: 'https://embed.figma.com/design/AbCdEf123456?embed-host=inksplat&node-id=1-2',
      ratio: 3 / 4,
      site: 'Figma',
    });
  });

  it('shows Google Maps places, searches and points as the keyless embedded map', () => {
    const map = (q: string, z = '') =>
      `https://www.google.com/maps?q=${q}${z ? `&z=${z}` : ''}&output=embed`;
    expect(
      embedOf('https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1'),
    ).toEqual({ src: map('Eiffel+Tower', '17'), ratio: 3 / 4, site: 'Google Maps' });
    expect(embedOf('https://www.google.com/maps/@40.4168,-3.7038,14z')?.src).toBe(
      map('40.4168%2C-3.7038', '14'),
    );
    expect(embedOf('https://www.google.de/maps/search/caf%C3%A9+near+me/@52.5,13.4,13z')?.src).toBe(
      map('caf%C3%A9+near+me', '13'),
    );
    expect(embedOf('https://maps.google.com/?q=Madrid')?.src).toBe(map('Madrid'));
    expect(embedOf('https://www.google.com/maps/search/?api=1&query=Big+Ben')?.src).toBe(
      map('Big+Ben'),
    );
    // A search can hold any text: it is only ever a query value of the fixed address.
    expect(embedOf('https://www.google.com/maps?q=%22%3E%3Cscript%3E&z=99')?.src).toBe(
      map('%22%3E%3Cscript%3E'),
    );
  });

  it('shows the view of an OpenStreetMap link, with its marker', () => {
    const e = embedOf(
      'https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945#map=17/48.8584/2.2945',
    )!;
    expect(e.site).toBe('OpenStreetMap');
    const src = new URL(e.src);
    expect(src.origin + src.pathname).toBe('https://www.openstreetmap.org/export/embed.html');
    expect(src.searchParams.get('marker')).toBe('48.8584,2.2945');
    const [w, s, east, n] = src.searchParams.get('bbox')!.split(',').map(Number);
    expect(w).toBeLessThan(2.2945);
    expect(east).toBeGreaterThan(2.2945);
    expect(s).toBeLessThan(48.8584);
    expect(n).toBeGreaterThan(48.8584);
    expect(
      new URL(
        embedOf('https://www.openstreetmap.org/#map=15/48.8584/2.2945')!.src,
      ).searchParams.has('marker'),
    ).toBe(false);
  });

  it('knows Google Docs, Slides and Sheets, shared and published', () => {
    expect(embedOf('https://docs.google.com/document/d/1AbCdEfGhIj/edit?usp=sharing')).toEqual({
      src: 'https://docs.google.com/document/d/1AbCdEfGhIj/preview',
      ratio: 1.3,
      site: 'Google Docs',
    });
    expect(embedOf('https://docs.google.com/document/u/1/d/1AbCdEfGhIj/edit')?.src).toBe(
      'https://docs.google.com/document/d/1AbCdEfGhIj/preview',
    );
    expect(embedOf('https://docs.google.com/presentation/d/1AbCdEfGhIj/edit#slide=id.p')).toEqual({
      src: 'https://docs.google.com/presentation/d/1AbCdEfGhIj/embed?start=false&loop=false',
      ratio: 569 / 960,
      site: 'Google Slides',
    });
    expect(embedOf('https://docs.google.com/presentation/d/e/2PACX-1vAbC_dEf/pub')?.src).toBe(
      'https://docs.google.com/presentation/d/e/2PACX-1vAbC_dEf/embed?start=false&loop=false',
    );
    expect(embedOf('https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit#gid=123')).toEqual({
      src: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/htmlview?widget=true&headers=false&gid=123',
      ratio: 3 / 4,
      site: 'Google Sheets',
    });
  });

  it('knows Spotify and Dailymotion', () => {
    expect(embedOf('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x')).toEqual({
      src: 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
      ratio: 0.38,
      site: 'Spotify',
    });
    expect(embedOf('https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M',
      ratio: 0.88,
      site: 'Spotify',
    });
    for (const url of [
      'https://www.dailymotion.com/video/x8abc12',
      'https://dai.ly/x8abc12',
      'https://www.dailymotion.com/embed/video/x8abc12',
    ]) {
      expect(embedOf(url), url).toEqual({
        src: 'https://geo.dailymotion.com/player.html?video=x8abc12',
        ratio: 9 / 16,
        site: 'Dailymotion',
      });
    }
  });

  it('leaves every other address a plain card', () => {
    for (const url of [
      'https://example.com/',
      'https://www.youtube.com/',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/watch?v=',
      'https://www.youtube.com/watch?v=%22%3E%3Cscript%3E',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://evil.example/www.youtube.com/watch?v=dQw4w9WgXcQ',
      'http://vimeo.com/channels/staffpicks',
      'https://www.loom.com/share/not-hex',
      'https://drive.google.com/drive/folders/1AbC',
      'https://www.figma.com/community',
      'https://www.google.com/maps/dir/Madrid/Toledo',
      'https://www.google.com/maps',
      'https://maps.app.goo.gl/abcdef',
      'https://www.google.com/search?q=maps',
      'https://www.google.evil.example/maps?q=x',
      'https://www.openstreetmap.org/node/123',
      'https://www.openstreetmap.org/#map=15/123/2',
      'https://docs.google.com/forms/d/1AbCdEfGhIj/viewform',
      'https://docs.google.com/document/d/bad!id/edit',
      'https://open.spotify.com/user/someone',
      'https://open.spotify.com/track/short',
      'https://www.dailymotion.com/someone',
      'javascript:alert(1)',
      'not a url',
      null,
    ]) {
      expect(embedOf(url), String(url)).toBeNull();
    }
  });

  it('only ever points at the allowed origins', () => {
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://vimeo.com/1',
      'https://www.loom.com/share/0123456789abcdef',
      'https://drive.google.com/file/d/abcd/view',
      'https://www.figma.com/board/AbCdEf123456',
      'https://www.google.com/maps/@1,2,3z',
      'https://www.openstreetmap.org/#map=3/1/2',
      'https://docs.google.com/spreadsheets/d/abcdef/edit',
      'https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT',
      'https://dai.ly/x8abc12',
    ]) {
      expect(EMBED_ORIGINS).toContain(new URL(embedOf(url)!.src).origin);
    }
  });

  it('is allowed by the frame-src of the pages that show the board, and nothing else is', () => {
    for (const page of ['index.html', 'present.html']) {
      const html = readFileSync(join(ROOT, 'viewer', 'src', page), 'utf8');
      const sources = /frame-src ([^;"]+)/.exec(html)?.[1]?.trim().split(/\s+/);
      expect(sources, page).toEqual([...EMBED_ORIGINS]);
    }
  });
});

describe('embedded players on the board', () => {
  const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  async function setup(options: { embeds?: boolean } = {}) {
    const room = new TestRoom();
    const host = await room.start();
    const stage = box(800, 450);
    const opened: string[] = [];
    const wb = createWhiteboard(stage, {
      session: host,
      adapter: frameAdapter(stage, () => 16 / 9),
      random: () => 0.5,
      openUrl: (url) => opened.push(url),
      ...options,
    });
    const shadow = wb.element.shadowRoot!;
    const frames = () => [...shadow.querySelectorAll<HTMLElement>('.embeds .embed')];
    const first = () => shadow.querySelector<HTMLElement>('.embeds .embed')!;
    const click = (node: Element) => {
      Object.defineProperty(shadow, 'elementsFromPoint', {
        value: () => [node],
        configurable: true,
      });
      shadow.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    const close = () => {
      wb.destroy();
      room.close();
    };
    return { wb, shadow, frames, first, click, opened, close };
  }

  it('shows the player in a sandboxed frame, a plain link as a card', async () => {
    const t = await setup();
    try {
      t.wb.addLink('https://example.com/page');
      expect(t.frames()).toHaveLength(0);
      const id = t.wb.addLink(VIDEO, { x: 400, y: 300 })!;
      expect(t.frames()).toHaveLength(1);
      const frame = t.first().querySelector('iframe')!;
      expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
      expect(frame.getAttribute('sandbox')).toBe(
        'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
      );
      expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
      expect(frame.title).toBe(`YouTube: ${VIDEO}`);
      // The card is drawn as a player whose screen the frame is put under.
      const node = t.shadow.querySelector(`.link-item[data-id="${id}"]`)!;
      expect(node.querySelector('.embed-frame')).not.toBeNull();
      expect(node.textContent).toContain('YouTube');
      expect(t.first().style.width).toBe('400px');
      expect(t.first().style.transform).toMatch(/^translate\(.*\) matrix\(.*\) translate\(/);
    } finally {
      t.close();
    }
  });

  it('keeps the same frame while the card moves, and drops it when the card goes', async () => {
    const t = await setup();
    try {
      const id = t.wb.addLink(VIDEO)!;
      const frame = t.first();
      const before = frame.style.transform;
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(id: string, fields: object): unknown };
      };
      inner.local(() => inner.model.change(id, { x: 100, y: 120 }));
      expect(t.first()).toBe(frame);
      expect(frame.style.transform).not.toBe(before);
      t.wb.setPage(1);
      expect(t.frames()).toHaveLength(0);
      t.wb.setPage(0);
      expect(t.frames()).toHaveLength(1);
      t.wb.clear();
      expect(t.frames()).toHaveLength(0);
    } finally {
      t.close();
    }
  });

  it('takes the pointer after a click, until a press outside or Esc', async () => {
    const t = await setup();
    try {
      const id = t.wb.addLink(VIDEO)!;
      const node = t.shadow.querySelector(`.link-item[data-id="${id}"]`)!;
      t.click(node);
      expect(t.opened).toEqual([]);
      expect(t.first().classList.contains('active')).toBe(true);
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(t.first().classList.contains('active')).toBe(false);
      t.click(node);
      expect(t.first().classList.contains('active')).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(t.first().classList.contains('active')).toBe(false);
      t.click(node);
      t.wb.setTool('pen');
      expect(t.first().classList.contains('active')).toBe(false);
    } finally {
      t.close();
    }
  });

  it('opens the page in a new tab from the bar of the selected player', async () => {
    const t = await setup();
    try {
      const id = t.wb.addLink(VIDEO)!;
      t.wb.selectItems([id]);
      const open = t.shadow.querySelector<HTMLButtonElement>(
        '.selbar button[aria-label="Open the page in a new tab"]',
      )!;
      expect(open).not.toBeNull();
      open.click();
      expect(t.opened).toEqual([VIDEO]);
    } finally {
      t.close();
    }
  });

  it('puts the pin of a player above its screen, in the band', async () => {
    const t = await setup();
    try {
      const id = t.wb.addLink(VIDEO, { x: 400, y: 300 })!;
      const item = t.wb.items().find((i) => i.id === id)!;
      const screen = t.shadow.querySelector(`.link-item[data-id="${id}"] .embed-frame`)!;
      const pin = pinPoint(item)!;
      expect(pin.y).toBeLessThan(Number(screen.getAttribute('y')));
    } finally {
      t.close();
    }
  });

  it('draws only the still player with embeds off, which opens the page when clicked', async () => {
    const t = await setup({ embeds: false });
    try {
      const id = t.wb.addLink(VIDEO)!;
      expect(t.frames()).toHaveLength(0);
      const node = t.shadow.querySelector(`.link-item[data-id="${id}"]`)!;
      expect(node.querySelector('.embed-frame')).not.toBeNull();
      expect(t.shadow.querySelector('svg')!.classList.contains('live-embeds')).toBe(false);
      t.click(node);
      expect(t.opened).toEqual([VIDEO]);
    } finally {
      t.close();
    }
  });

  it('exports the player as its still screen', async () => {
    const t = await setup();
    try {
      t.wb.addLink(VIDEO);
      const svg = t.wb.toSvg();
      expect(svg).toContain('embed-frame');
      expect(svg).toContain('fill="#000000"');
      expect(svg).not.toContain('iframe');
    } finally {
      t.close();
    }
  });
});
