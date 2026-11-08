// MIT License © 2026 Binary Dice Games
/**
 * @file The app's pages and their Content Security Policy (spec/08_remote_support/DESIGN.md
 * section 4.1), without Electron so they are unit tested; `scheme.ts` serves them.
 */

export const SCHEME = 'app';
export const ORIGIN = 'app://support';

/** The files the app serves, by name, with their type. */
export const FILES: Record<string, string> = {
  'control.html': 'text/html; charset=utf-8',
  'overlay.html': 'text/html; charset=utf-8',
  'session.html': 'text/html; charset=utf-8',
  'control.js': 'text/javascript; charset=utf-8',
  'overlay.js': 'text/javascript; charset=utf-8',
  'session.js': 'text/javascript; charset=utf-8',
  'icon.png': 'image/png',
};

/**
 * The Content Security Policy of `page`. Only the session page connects anywhere, to trackers
 * over `wss:` (a development build also to loopback `ws:`, for the tests' tracker); WebRTC is
 * not governed by CSP.
 */
export function contentSecurityPolicy(page: string, dev: boolean): string {
  const connect =
    page === 'session.html' ? `wss:${dev ? ' ws://127.0.0.1:* ws://localhost:*' : ''}` : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    'media-src blob: mediastream:',
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The page name in an `app://support/<name>` URL, or null when it is not one the app serves. */
export function servedName(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:` || u.host !== 'support') {
    return null;
  }
  const name = u.pathname.replace(/^\//, '');
  return Object.hasOwn(FILES, name) ? name : null;
}
