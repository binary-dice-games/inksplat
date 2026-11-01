// MIT License © 2026 Binary Dice Games
/**
 * @file Keeps the zoomed content (the screen or the sheet) on a GPU layer of its own while it is
 * zoomed or panned, for the viewer and the presenter page.
 *
 * On its own layer, each step of a zoom or a pan only moves and scales what was drawn, instead of
 * drawing the whole content again at the new size (a few times a 4K screen). But a layer is not
 * drawn again when its scale changes, so it would stay blurry once zoomed in: the layer goes when
 * the movement stops, and the content is then drawn once, sharp, at its final size.
 */
import type { FrameAdapter } from '@inksplat/collab-whiteboard';

/** How long after the last step of a zoom or a pan the content is drawn again at its size. */
export const SETTLE_MS = 250;

/**
 * Puts `element` (the content that `adapter` zooms) on a layer of its own while the adapter's view
 * changes, and takes it off `settleMs` after the last change.
 *
 * @returns a function that stops it (and takes the layer off)
 */
export function layerWhileMoving(
  element: HTMLElement,
  adapter: Pick<FrameAdapter, 'onChange' | 'view'>,
  settleMs = SETTLE_MS,
): () => void {
  const key = () => {
    const v = adapter.view();
    return `${v.scale} ${v.x} ${v.y}`;
  };
  let last = key();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = adapter.onChange(() => {
    const now = key();
    if (now === last) {
      return;
    }
    last = now;
    element.style.willChange = 'transform';
    clearTimeout(timer);
    timer = setTimeout(() => {
      element.style.willChange = '';
    }, settleMs);
  });
  return () => {
    off();
    clearTimeout(timer);
    element.style.willChange = '';
  };
}
