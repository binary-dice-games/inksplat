// MIT License © 2026 Binary Dice Games
/**
 * @file Which display is shared, and where the windows go (spec/08_remote_support/DESIGN.md
 * section 3.3), without Electron so it is unit tested.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the app needs of an Electron `Display`. */
export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

/** What the app needs of a `desktopCapturer` source. */
export interface SourceInfo {
  id: string;
  display_id: string;
}

/**
 * The capture source of `display`: the one whose `display_id` is the display's id; where the
 * system gives no ids (some Linux setups), the one in the same place in the list; with a single
 * display and a single source, that one; else null.
 */
export function sourceFor<S extends SourceInfo>(
  display: DisplayInfo,
  displays: readonly DisplayInfo[],
  sources: readonly S[],
): S | null {
  const byId = sources.find((s) => s.display_id !== '' && s.display_id === String(display.id));
  if (byId) {
    return byId;
  }
  if (sources.every((s) => s.display_id === '') && sources.length === displays.length) {
    const i = displays.findIndex((d) => d.id === display.id);
    return i >= 0 ? (sources[i] ?? null) : null;
  }
  return null;
}

/** The display after `current` in `displays`, going round; `current` itself when it is alone. */
export function nextDisplay(current: DisplayInfo, displays: readonly DisplayInfo[]): DisplayInfo {
  const i = displays.findIndex((d) => d.id === current.id);
  return displays[(i + 1) % displays.length] ?? current;
}

/** The bar's place: the top right corner of the work area, `margin` pixels in. */
export function barBounds(
  workArea: Rect,
  size: { width: number; height: number },
  margin = 12,
): Rect {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + margin,
    width,
    height,
  };
}

/** `r` moved (not resized) so that it lies inside `area`. */
export function clampInto(r: Rect, area: Rect): Rect {
  const width = Math.min(r.width, area.width);
  const height = Math.min(r.height, area.height);
  return {
    x: Math.min(Math.max(r.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(r.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

/** Whether `r` lies wholly inside `area`. */
export function inside(r: Rect, area: Rect): boolean {
  return (
    r.x >= area.x &&
    r.y >= area.y &&
    r.x + r.width <= area.x + area.width &&
    r.y + r.height <= area.y + area.height
  );
}
