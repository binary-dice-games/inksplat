// MIT License © 2026 Binary Dice Games
/**
 * @file The app's pages, served from its own files on `app://support/` (spec/08_remote_support
 * DESIGN.md section 4.1): no remote content, no `file://`, and a strict Content Security Policy
 * on every page. Only the files listed here are served.
 */
import { net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILES, SCHEME, contentSecurityPolicy, servedName } from './pages';

export { ORIGIN, SCHEME, servedName } from './pages';

/** Must run before the app is ready: `app:` is a secure, standard scheme. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/** Serves the pages of `dir` on `app://support/`. */
export function serveApp(dir: string, dev: boolean): void {
  protocol.handle(SCHEME, async (request) => {
    const name = servedName(request.url);
    if (!name) {
      return new Response('not found', { status: 404 });
    }
    const file = await net.fetch(pathToFileURL(join(dir, name)).toString());
    const headers: Record<string, string> = {
      'content-type': FILES[name]!,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    };
    if (name.endsWith('.html')) {
      headers['content-security-policy'] = contentSecurityPolicy(name, dev);
    }
    return new Response(await file.arrayBuffer(), { status: 200, headers });
  });
}
