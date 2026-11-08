// MIT License © 2026 Binary Dice Games
// Builds inksplat Support (spec/08_remote_support) into a directory: the main process, the
// preloads, the three pages and their scripts.
//
//   node support-app/scripts/build.mjs [outDir]      default: support-app/dist
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(app, 'src');
const root = resolve(app, '..');

/** The app's version (support-app/package.json). */
export function appVersion() {
  return JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;
}

/**
 * Builds the app into `out` (emptied first). `builtAt` (ms since 1970) is the build date the
 * app's age check uses; default now.
 * @param {string} out
 * @param {{builtAt?: number}} [options]
 */
export async function buildSupportApp(out, { builtAt = Date.now() } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const common = {
    bundle: true,
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
      __BUILD_DATE__: String(Math.floor(builtAt)),
    },
  };
  // The main process and the preloads: CommonJS for Electron, `electron` from Electron itself.
  // A sandboxed preload can require only `electron`, so nothing else is left outside the bundle.
  await build({
    ...common,
    entryPoints: [
      { in: join(src, 'main', 'main.ts'), out: 'main' },
      { in: join(src, 'preload', 'control.ts'), out: 'preload-control' },
      { in: join(src, 'preload', 'session.ts'), out: 'preload-session' },
      { in: join(src, 'preload', 'overlay.ts'), out: 'preload-overlay' },
    ],
    outdir: out,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  });
  // The pages' scripts.
  await build({
    ...common,
    entryPoints: [
      { in: join(src, 'control', 'main.ts'), out: 'control' },
      { in: join(src, 'session', 'main.ts'), out: 'session' },
      { in: join(src, 'overlay', 'main.ts'), out: 'overlay' },
    ],
    outdir: out,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  });
  for (const page of ['control.html', 'overlay.html', 'session.html']) {
    copyFileSync(join(src, 'pages', page), join(out, page));
  }
  copyFileSync(join(root, 'viewer', 'src', 'assets', 'icon.png'), join(out, 'icon.png'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(app, 'dist'));
  await buildSupportApp(out);
  console.log(`inksplat Support built in ${out}`);
}
