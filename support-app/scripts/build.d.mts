// MIT License © 2026 Binary Dice Games
/** The app's version (support-app/package.json). */
export function appVersion(): string;
/** Builds inksplat Support into `out` (emptied first). */
export function buildSupportApp(out: string, options?: { builtAt?: number }): Promise<void>;
