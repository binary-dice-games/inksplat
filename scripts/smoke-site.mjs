// MIT License © 2026 Binary Dice Games
// Checks that a deployed (or locally served) site works.
//
//   node scripts/smoke-site.mjs <site url, ending with />
//
// Fetches the viewer page and its script, the versioned copy, the privacy policy, the tutorial and
// a missing page (which must be the 404 page). Exits 1 with the reasons if anything
// is wrong. The check is meant to run right after a deploy.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { protocolMajor } from './build-site.mjs';

/**
 * @param {string} base the site's address, ending with `/`
 * @param {(url: string) => Promise<Response>} [get] how to fetch (tests pass their own)
 * @returns {Promise<string[]>} the problems found; empty when the site is fine
 */
export async function smokeSite(base, get = (url) => fetch(url, { redirect: 'manual' })) {
  const problems = [];
  const major = `v${protocolMajor()}/`;
  const check = async (path, { status = 200, contains, label = path } = {}) => {
    let res;
    try {
      res = await get(new URL(path, base).toString());
    } catch (e) {
      problems.push(`${label}: cannot fetch (${e instanceof Error ? e.message : e})`);
      return;
    }
    if (res.status !== status) {
      problems.push(`${label}: status ${res.status}, expected ${status}`);
      return;
    }
    if (contains) {
      const text = await res.text();
      for (const needle of [contains].flat()) {
        if (!text.includes(needle)) {
          problems.push(`${label}: does not contain ${JSON.stringify(needle)}`);
        }
      }
    }
  };
  await check('', { contains: ['<title>inksplat</title>', 'viewer.js'], label: 'viewer page' });
  await check('viewer.js', { contains: 'inksplat/', label: 'viewer script' });
  await check(major, { contains: 'viewer.js', label: `versioned viewer /${major}` });
  await check('present.html', {
    contains: ['present.js', 'Start session'],
    label: 'presenter page',
  });
  await check('present.js', { contains: 'inksplat/', label: 'presenter script' });
  await check(`${major}present.html`, {
    contains: 'present.js',
    label: `versioned presenter /${major}`,
  });
  await check('privacy.html', { contains: 'privacy policy', label: 'privacy policy' });
  await check('tutorial.html', { contains: 'How to use inksplat', label: 'tutorial' });
  await check('no-such-page-for-smoke-test', {
    status: 404,
    contains: 'redirect.js',
    label: '404 page',
  });
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base || !/^https?:\/\/.+\/$/.test(base)) {
    console.error('usage: node scripts/smoke-site.mjs <site url ending with />');
    process.exit(2);
  }
  const problems = await smokeSite(base);
  if (problems.length) {
    console.error(`site check failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`site ok: ${base}`);
}
