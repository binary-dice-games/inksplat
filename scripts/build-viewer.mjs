// MIT License © 2026 Binary Dice Games
// Builds the viewer app and the presenter page into a directory.
//
//   node scripts/build-viewer.mjs [outDir]      default: viewer/dist (the GitHub Pages bundle)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'viewer', 'src');

/** The pdf.js files that ship next to the pages: [file in `pdfjs-dist`, name in the site]. */
export const PDF_FILES = [
  ['build/pdf.min.mjs', 'pdf.min.mjs'],
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['LICENSE', 'pdfjs-LICENSE.txt'],
];

/** Images the pages use (logo, icon), in `viewer/src/assets/`, copied next to the pages. */
export const ASSET_FILES = ['logo.png', 'logo-dark.png', 'icon.png'];

/**
 * The version shown in the About box: the package version, plus the short commit when the
 * build runs in a git checkout (`0.1.0 (5ac03b7)`), or the package version alone.
 */
export function buildVersion() {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let commit = process.env.GITHUB_SHA?.slice(0, 7);
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      commit = undefined; // not a git checkout, or git is missing
    }
  }
  return commit ? `${version} (${commit})` : version;
}

/** The wire protocol of this build (`inksplat/1`), read from the defaults. */
function protocol() {
  const source = readFileSync(join(root, 'packages', 'defaults', 'src', 'index.ts'), 'utf8');
  const match = /export const PROTOCOL = '([^']+)'/.exec(source);
  if (!match) {
    throw new Error('PROTOCOL not found in packages/defaults');
  }
  return match[1];
}

/**
 * Builds the viewer page and the presenter page (`index.html`, `viewer.js`,
 * `present.html`, `present.js`, the worker `still-refresh-worker.js`) with their
 * images (`ASSET_FILES`).
 * @param {string} out directory to write into
 */
export async function buildViewer(out) {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [
      { in: join(src, 'main.ts'), out: 'viewer' },
      { in: join(src, 'present.ts'), out: 'present' },
      // The still refresh's worker (viewer/src/still-refresh.ts), loaded next to the pages.
      { in: join(src, 'still-refresh-worker.ts'), out: 'still-refresh-worker' },
    ],
    outdir: out,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  // pdf.js, loaded by the pages only when a PDF is dropped on the board (for its preview).
  for (const [from, to] of PDF_FILES) {
    copyFileSync(join(root, 'node_modules', 'pdfjs-dist', from), join(out, to));
  }
  for (const name of ASSET_FILES) {
    copyFileSync(join(src, 'assets', name), join(out, name));
  }
  const viewerHtml = readFileSync(join(src, 'index.html'), 'utf8');
  const link = '<a class="button primary" href="present.html">Start presenting</a>';
  writeFileSync(
    join(out, 'index.html'),
    viewerHtml
      .replace('<!--{{present-link}}-->', link)
      .replace('{{version}}', buildVersion())
      .replace('{{protocol}}', protocol()),
  );
  // The presenter page shares the viewer's stylesheet (the first <style> of index.html).
  const style = /<style>[\s\S]*?<\/style>/.exec(viewerHtml)?.[0];
  if (!style) {
    throw new Error('viewer/src/index.html has no <style> block');
  }
  const page = readFileSync(join(src, 'present.html'), 'utf8');
  writeFileSync(
    join(out, 'present.html'),
    page.replace('<!--{{style}}-->', () => style),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'viewer', 'dist'));
  await buildViewer(out);
  console.log(`viewer built in ${out}`);
}
