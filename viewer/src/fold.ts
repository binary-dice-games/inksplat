// MIT License © 2026 Binary Dice Games
/**
 * @file Folding the whiteboard toolbar away so it does not hide the video, for
 * the viewer and the presenter page.
 */
import type { Whiteboard } from '@inksplat/collab-whiteboard';

/**
 * Shows or hides the toolbar (its colour/sticker chooser and its tool hint) of `board`, and returns to the
 * pointer tool when hiding. It is hidden with `display: none`, not the `hidden` attribute,
 * because the board stops redrawing a hidden toolbar. The toolbar lives in the board's shadow
 * root, which the board has no API for.
 */
export function setToolbarFolded(board: Whiteboard | null, folded: boolean): void {
  const root = board?.element.shadowRoot;
  for (const selector of ['.toolbar', '.pop', '.tip']) {
    const el = root?.querySelector<HTMLElement>(selector);
    if (el) {
      el.style.display = folded ? 'none' : '';
    }
  }
  if (folded) {
    board?.setTool('pointer');
  }
}
