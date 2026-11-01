// MIT License © 2026 Binary Dice Games
/**
 * @file The background of a canvas, for the viewer and the presenter page: the screen (the
 * active stream, letterboxed on black in the board frame) or a sheet in the shape of the frame
 * with one of a few backgrounds (whiteboard, blackboard, wall, cork). Each canvas has its own background (the stage's `backgrounds`). The backgrounds are drawn with CSS and inline SVG, so there are no image files;
 * on the page the SVG tiles are drawn once into bitmaps, so zooming does not draw their filters again.
 */
import { letterbox } from '@inksplat/collab-whiteboard';
import { canvasBackground } from '@inksplat/defaults';
import type { Background, Stage } from '@inksplat/defaults';

/**
 * A square tile of SVG drawn with filters, `size` CSS pixels wide, repeated over the sheet.
 * `svg(px)` gives its document drawn `px` pixels wide (the filters work in its own units, so the
 * pattern is the same at any width).
 */
interface Tile {
  readonly size: number;
  svg(px: number): string;
}

/** One layer of a background: plain CSS (a gradient) or a tile. */
type Layer = string | Tile;

/** A tile from `body` (SVG elements, with their filters in `defs`). */
function tile(defs: string, body: string, size: number): Tile {
  return {
    size,
    svg: (px) =>
      `<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 ${size} ${size}'>` +
      `<defs>${defs}</defs>${body}</svg>`,
  };
}

/** A tile as a CSS image (the SVG itself, drawn by the browser at whatever scale it is shown). */
function tileUrl(t: Tile): string {
  return `url("data:image/svg+xml,${encodeURIComponent(t.svg(t.size))}")`;
}

/** Noise as a tile: `rgb` is the colour of the grain, `alpha` how strong it is. */
function grain(rgb: [number, number, number], alpha: number, frequency: number, size = 240): Tile {
  const [r, g, b] = rgb.map((c) => c / 255);
  const defs =
    `<filter id='n' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${alpha * 2.2} ${-alpha * 0.6}'/>` +
    `</filter>`;
  return tile(defs, `<rect width='100%' height='100%' filter='url(#n)'/>`, size);
}

/**
 * Relief of a rough surface: fractal noise lit from the upper left, as light and shade to
 * multiply over a colour (`frequency` is the size of the grain, `depth` how rough it is).
 */
function relief(frequency: number, depth: number, seed: number, size = 300): Tile {
  const defs =
    `<filter id='r' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='4' seed='${seed}' stitchTiles='stitch' result='t'/>` +
    `<feDiffuseLighting in='t' lighting-color='#ffffff' surfaceScale='${depth}' diffuseConstant='1.15'>` +
    `<feDistantLight azimuth='225' elevation='58'/></feDiffuseLighting></filter>`;
  return tile(defs, `<rect width='100%' height='100%' filter='url(#r)'/>`, size);
}

/**
 * Specks scattered over a surface: noise cut at a threshold, so only its peaks remain, in the
 * colour `rgb`. A lower `cut` (0 to 1) leaves more of them.
 */
function specks(
  rgb: [number, number, number],
  frequency: number,
  cut: number,
  opacity: number,
  seed: number,
  size = 300,
): Tile {
  const [r, g, b] = rgb.map((c) => c / 255);
  const steps = Array.from({ length: 12 }, (_, i) => (i / 11 >= cut ? opacity : 0)).join(' ');
  const defs =
    `<filter id='s' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='2' seed='${seed}' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 1 0 0 0 0'/>` +
    `<feComponentTransfer><feFuncA type='discrete' tableValues='${steps}'/></feComponentTransfer>` +
    `</filter>`;
  return tile(defs, `<rect width='100%' height='100%' filter='url(#s)'/>`, size);
}

/** The layers of each background, top first, and the rest of its look. */
const BACKGROUND_LAYERS: Readonly<
  Record<
    Background,
    { layers: Layer[]; border: string; label: string; blend?: string; shadow?: string }
  >
> = {
  whiteboard: {
    label: 'Whiteboard',
    layers: [
      'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 40%, rgba(200,210,220,0.25) 100%)',
      grain([120, 130, 140], 0.05, 0.9),
      '#f6f7f8',
    ],
    border: '10px solid #b9bec6',
  },
  blackboard: {
    label: 'Blackboard',
    layers: [
      'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.1), rgba(255,255,255,0) 55%)',
      'radial-gradient(ellipse at 75% 80%, rgba(255,255,255,0.06), rgba(255,255,255,0) 50%)',
      grain([255, 255, 255], 0.07, 0.6),
      '#2f3d36',
    ],
    border: '14px solid #7a5230',
  },
  wall: {
    // Painted plaster: a rough surface lit from one side, soft patches of paint, light falling off
    // towards the corners.
    label: 'Wall',
    layers: [
      'radial-gradient(ellipse at 50% 35%, rgba(255,255,255,0) 45%, rgba(90,70,50,0.28) 130%)',
      grain([150, 130, 100], 0.22, 0.006, 500),
      relief(0.55, 1.8, 7),
      '#f1e7d3',
    ],
    blend: 'normal, normal, multiply, normal',
    border: '0 none',
    shadow: 'inset 0 0 60px rgba(60,40,20,0.35)',
  },
  cork: {
    // Cork: a granular surface in light and dark brown, a few lighter and darker flecks, and a wooden frame.
    label: 'Cork board',
    layers: [
      specks([70, 42, 20], 0.22, 0.72, 0.75, 11),
      specks([214, 176, 126], 0.16, 0.8, 0.5, 5),
      grain([100, 70, 40], 0.55, 0.01, 500),
      relief(0.3, 2.2, 3),
      '#bd9467',
    ],
    blend: 'normal, normal, normal, multiply, normal',
    border: '16px solid #8b5e34',
    shadow: 'inset 0 0 22px rgba(40,20,0,0.55)',
  },
};

/** The CSS of each background (`background` and the frame around the sheet). */
export const BACKGROUND_STYLES: Readonly<
  Record<
    Background,
    { background: string; border: string; label: string; blend?: string; shadow?: string }
  >
> = Object.fromEntries(
  Object.entries(BACKGROUND_LAYERS).map(([name, { layers, ...rest }]) => [
    name,
    { ...rest, background: layers.map((l) => (typeof l === 'string' ? l : tileUrl(l))).join(', ') },
  ]),
) as Record<
  Background,
  { background: string; border: string; label: string; blend?: string; shadow?: string }
>;

/**
 * How many pixels a bitmap tile has per CSS pixel: twice the screen's, at most 4 (a 4K screen),
 * so zoomed in 8 times a pixel of a tile covers 4 of the screen's at most (16 MB for the largest
 * tile). Zoomed in, the tiles are enlarged from these bitmaps instead of being drawn again from
 * their filters, which at a few times the size of a 4K screen took far too long for every step of
 * the zoom (and again in the magnifier's lens).
 */
function bitmapScale(): number {
  return Math.min(4, Math.max(2, Math.ceil(2 * (globalThis.devicePixelRatio || 1))));
}

/** The background shown with bitmap tiles: its `background` and `background-size` CSS. */
export interface BitmapBackground {
  readonly background: string;
  readonly size: string;
}

const bitmaps = new Map<Background, Promise<BitmapBackground | null>>();

/** Draws a tile once into a PNG at {@link bitmapScale}; its blob URL. */
async function tileBitmap(t: Tile): Promise<string> {
  const px = t.size * bitmapScale();
  const image = new Image(px, px);
  image.src = `data:image/svg+xml,${encodeURIComponent(t.svg(px))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext('2d');
  if (!g) {
    throw new Error('no 2D canvas');
  }
  g.drawImage(image, 0, 0, px, px);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (!blob) {
    throw new Error('the tile could not be encoded');
  }
  return URL.createObjectURL(blob);
}

/**
 * The background `name` with its tiles drawn once into bitmaps (made on the first call and kept
 * for the page's life), or null where that cannot be done (no canvas): then the SVG tiles stay.
 * The tiles are drawn from their SVG once, in the background, while the SVG tiles are shown.
 */
export function bitmapBackground(name: Background): Promise<BitmapBackground | null> {
  let made = bitmaps.get(name);
  if (!made) {
    const { layers } = BACKGROUND_LAYERS[name];
    made = Promise.all(
      layers.map(async (l) =>
        typeof l === 'string'
          ? { image: l, size: 'auto' }
          : { image: `url("${await tileBitmap(l)}")`, size: `${l.size}px ${l.size}px` },
      ),
    ).then(
      (parts) => ({
        background: parts.map((p) => p.image).join(', '),
        size: parts.map((p) => p.size).join(', '),
      }),
      () => {
        // Tried again next time (a later call may well succeed).
        bitmaps.delete(name);
        return null;
      },
    );
    bitmaps.set(name, made);
  }
  return made;
}

/** The bitmap backgrounds made so far, by name (to set them without waiting). */
const ready = new Map<Background, BitmapBackground>();

/**
 * Shows the canvas `canvas` (0 for the first) with its background ({@link canvasBackground}):
 * for `screen` the `video` is laid over the frame (the largest box of `aspect` that fits in
 * `box`; the video keeps its own shape inside it, on black) and the sheet is hidden; for the
 * others the video is hidden and `page` is laid out over the frame with that background.
 *
 * @param aspect the width / height of the frame, as the board uses it
 */
export function showSheet(
  elements: { video: HTMLElement; page: HTMLElement; box: HTMLElement },
  stage: Stage | null,
  aspect: number,
  canvas = 0,
): void {
  const { video, page, box } = elements;
  const background = canvasBackground(stage, canvas);
  const screen = background === 'screen';
  video.hidden = !screen;
  page.hidden = screen;
  const r = letterbox(box.clientWidth, box.clientHeight, aspect);
  const rect = {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  };
  if (screen) {
    Object.assign(video.style, { ...rect, right: 'auto', bottom: 'auto', background: '#000' });
    return;
  }
  const style = BACKGROUND_STYLES[background];
  Object.assign(page.style, {
    ...rect,
    boxShadow: style.shadow ?? '',
    border: style.border,
    boxSizing: 'border-box',
  });
  page.dataset.background = background;
  const bitmap = ready.get(background);
  paintSheet(page, background, bitmap);
  if (!bitmap) {
    // The SVG tiles until the bitmaps are made, then those (if the sheet still shows it).
    void bitmapBackground(background).then((made) => {
      if (made) {
        ready.set(background, made);
        if (page.dataset.background === background && !page.hidden) {
          paintSheet(page, background, made);
        }
      }
    });
  }
}

/** Sets the background layers of the sheet: the bitmap tiles if given, else the SVG ones. */
function paintSheet(page: HTMLElement, name: Background, bitmap?: BitmapBackground): void {
  const style = BACKGROUND_STYLES[name];
  // The blend modes after the shorthand, which resets them.
  page.style.background = bitmap?.background ?? style.background;
  page.style.backgroundSize = bitmap?.size ?? '';
  page.style.backgroundBlendMode = style.blend ?? '';
}
