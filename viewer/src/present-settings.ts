// MIT License © 2026 Binary Dice Games
/**
 * @file Settings of the presenter page (spec/06_static_presenter): the
 * session settings plus the mouse pointer choice, the tool hints and the folding
 * of the tools and the panel, kept in `localStorage`. Everything read back is validated.
 */
import { cleanSettings } from './settings';
import type { Settings } from './settings';
import type { CursorMode } from './display-capture';

export interface PresenterPrefs {
  settings: Settings;
  cursor: CursorMode;
  /** The whiteboard toolbar is folded away. */
  toolsCollapsed: boolean;
  /** The controls panel is folded away. */
  panelCollapsed: boolean;
  /** A hint on how to use each tool shows for a moment when it is picked. */
  toolHints: boolean;
}

const KEY = 'inksplat.presenter.prefs';

/** Prefs from any stored value: every field validated, missing or invalid ones defaulted. */
export function cleanPrefs(input: unknown): PresenterPrefs {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return {
    settings: cleanSettings(o.settings),
    cursor: o.cursor === 'motion' || o.cursor === 'never' ? o.cursor : 'always',
    toolsCollapsed: o.toolsCollapsed === true,
    panelCollapsed: o.panelCollapsed === true,
    toolHints: o.toolHints !== false,
  };
}

/** The saved prefs, or the defaults when nothing usable is stored. */
export function loadPrefs(): PresenterPrefs {
  try {
    return cleanPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanPrefs(undefined); // private window, blocked storage or damaged value
  }
}

/** Stores the prefs; the page keeps working when storage is blocked. */
export function savePrefs(prefs: PresenterPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // not stored
  }
}
