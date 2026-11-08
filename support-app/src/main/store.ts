// MIT License © 2026 Binary Dice Games
/**
 * @file What the app keeps between runs (spec/08_remote_support/DESIGN.md section 7.3 R15): the
 * person's name, and nothing else. Kept in `settings.json` in the app's data folder.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAME_MAX, cleanText } from '../shared/protocol';

export interface Stored {
  name: string;
}

/** The stored settings of `dir`, or `fallbackName` when there are none. */
export function loadStored(dir: string, fallbackName: string): Stored {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as unknown;
    const name = cleanText((raw as Record<string, unknown> | null)?.name, NAME_MAX);
    return { name: name || cleanText(fallbackName, NAME_MAX) || 'Me' };
  } catch {
    return { name: cleanText(fallbackName, NAME_MAX) || 'Me' };
  }
}

/** Stores `stored` in `dir`; a failure only loses the name. */
export function saveStored(dir: string, stored: Stored): void {
  try {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ name: stored.name }));
  } catch {
    // not kept
  }
}
