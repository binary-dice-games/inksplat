// MIT License © 2026 Binary Dice Games
// Assembles the GitHub Pages site.
//
//   node scripts/build-site.mjs [outDir] [--base /inksplat/]
//
// The site holds the viewer app at the root and again under /v<N>/ (N is the major
// of the wire protocol, so a link made with protocol N always finds a
// matching viewer and presenter page), a 404 page that keeps an invite in the address, the privacy
// policy, the tutorial (`tutorial.html` and its images in `tutorial/`), and any older viewers kept in site-archive/ (one folder per protocol
// major, for example site-archive/v1/), copied as they are. GitHub Pages replaces
// the whole site on each deploy, which is why older majors are kept in the repo.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_FILES, PDF_FILES, buildViewer } from './build-viewer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteSrc = join(root, 'viewer', 'src', 'site');

/** The protocol major of this build, read from the defaults (`inksplat/1` gives 1). */
export function protocolMajor() {
  const source = readFileSync(join(root, 'packages', 'defaults', 'src', 'index.ts'), 'utf8');
  const match = /export const PROTOCOL = 'inksplat\/(\d+)'/.exec(source);
  if (!match) {
    throw new Error('PROTOCOL not found in packages/defaults');
  }
  return Number(match[1]);
}

/** A base path with a slash at both ends (`/inksplat/`), or `/` for the root. */
export function normalizeBase(base) {
  if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(base.endsWith('/') ? base : `${base}/`)) {
    throw new Error(`bad base path: ${base}`);
  }
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * @param {string} out directory to build into (emptied first)
 * @param {{base?: string, archive?: string}} [options]
 * @returns {Promise<{versionDir: string}>}
 */
export async function buildSite(out, { base = '/', archive = join(root, 'site-archive') } = {}) {
  const basePath = normalizeBase(base);
  const versionDir = `v${protocolMajor()}`;
  rmSync(out, { recursive: true, force: true });
  await buildViewer(out);

  // The same viewer under its protocol major.
  mkdirSync(join(out, versionDir), { recursive: true });
  copyFileSync(join(out, 'index.html'), join(out, versionDir, 'index.html'));
  copyFileSync(join(out, 'viewer.js'), join(out, versionDir, 'viewer.js'));
  // Its presenter page goes with it: both sides of a link then speak the same protocol.
  copyFileSync(join(out, 'present.html'), join(out, versionDir, 'present.html'));
  copyFileSync(join(out, 'present.js'), join(out, versionDir, 'present.js'));
  for (const name of [...PDF_FILES.map(([, n]) => n), ...ASSET_FILES]) {
    copyFileSync(join(out, name), join(out, versionDir, name));
  }

  // Older majors that are kept in the repo (never overwriting the current one).
  if (existsSync(archive)) {
    cpSync(archive, out, { recursive: true, filter: (src) => !src.endsWith(`${versionDir}`) });
  }

  const page = (name) => readFileSync(join(siteSrc, name), 'utf8').replaceAll('{{base}}', basePath);
  writeFileSync(join(out, '404.html'), page('404.html'));
  copyFileSync(join(siteSrc, 'redirect.js'), join(out, 'redirect.js'));
  copyFileSync(join(siteSrc, 'privacy.html'), join(out, 'privacy.html'));
  // The home page links the policy next to itself, so the versioned copy gets one too.
  copyFileSync(join(siteSrc, 'privacy.html'), join(out, versionDir, 'privacy.html'));
  // The tutorial and its screenshots and animations, next to both home pages.
  for (const dir of [out, join(out, versionDir)]) {
    copyFileSync(join(siteSrc, 'tutorial.html'), join(dir, 'tutorial.html'));
    cpSync(join(siteSrc, 'tutorial'), join(dir, 'tutorial'), { recursive: true });
  }
  writeFileSync(join(out, '.nojekyll'), '');
  return { versionDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf('--base');
  const base = baseAt >= 0 ? args[baseAt + 1] : '/';
  const outArg = args.find((a, i) => !a.startsWith('--') && i !== baseAt + 1);
  const out = resolve(outArg ?? join(root, 'site'));
  const { versionDir } = await buildSite(out, { base });
  console.log(`site built in ${out} (viewer at / and /${versionDir}/)`);
}
