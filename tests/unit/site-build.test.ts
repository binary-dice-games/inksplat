// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, normalizeBase, protocolMajor } from '../../scripts/build-site.mjs';
import { smokeSite } from '../../scripts/smoke-site.mjs';

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'inksplat-release-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('the Pages site', () => {
  let out: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    out = join(work, 'site');
    // An older viewer kept in the repo for an older protocol major.
    const archive = join(work, 'archive');
    mkdirSync(join(archive, 'v0'), { recursive: true });
    writeFileSync(join(archive, 'v0', 'index.html'), 'old viewer');
    await buildSite(out, { base: '/inksplat/', archive });
    // Serves the site like GitHub Pages: unknown paths get 404.html with status 404.
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname.replace(/^\/inksplat\//, '');
      const file = join(out, path === '' || path.endsWith('/') ? `${path}index.html` : path);
      try {
        const body = readFileSync(file);
        res.writeHead(200).end(body);
      } catch {
        res.writeHead(404).end(readFileSync(join(out, '404.html')));
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/inksplat/`;
  });
  afterAll(() => server?.close());

  it('has the viewer at the root and under its protocol major, and keeps older majors', () => {
    expect(protocolMajor()).toBe(2);
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    expect(readFileSync(join(out, 'v2', 'index.html'), 'utf8')).toBe(index);
    expect(readFileSync(join(out, 'v0', 'index.html'), 'utf8')).toBe('old viewer');
    expect(readFileSync(join(out, '.nojekyll'), 'utf8')).toBe('');
  });

  it('ships the presenter page, also under the protocol major, with small bundles', () => {
    for (const dir of ['', `v${protocolMajor()}/`]) {
      expect(readFileSync(join(out, dir, 'present.html'), 'utf8')).toContain('present.js');
      for (const bundle of ['viewer.js', 'present.js']) {
        const code = readFileSync(join(out, dir, bundle));
        expect(gzipSync(code).length, `${dir}${bundle}`).toBeLessThan(150 * 1024);
      }
    }
  });

  it('ships pdf.js next to the pages, under the protocol major too, for the previews of PDFs', () => {
    for (const dir of ['', `v${protocolMajor()}/`]) {
      for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'pdfjs-LICENSE.txt']) {
        expect(readFileSync(join(out, dir, name)).length, `${dir}${name}`).toBeGreaterThan(1000);
      }
      expect(readFileSync(join(out, dir, 'pdfjs-LICENSE.txt'), 'utf8')).toMatch(/Apache License/);
    }
    // pdf.js is not part of the bundles: the pages load it on demand.
    expect(readFileSync(join(out, 'present.js'), 'utf8')).not.toContain('GlobalWorkerOptions =');
  });

  it('ships the home page images, the privacy policy and the version, also under the major', () => {
    for (const dir of ['', `v${protocolMajor()}/`]) {
      for (const name of ['logo.png', 'logo-dark.png', 'icon.png']) {
        const png = readFileSync(join(out, dir, name));
        expect(png.subarray(1, 4).toString('latin1'), `${dir}${name}`).toBe('PNG');
      }
      expect(readFileSync(join(out, dir, 'privacy.html'), 'utf8')).toMatch(/privacy/i);
    }
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect(index).toContain(`Version ${version}`);
    expect(index).toContain('protocol inksplat/2.');
    expect(index).not.toMatch(/\{\{\w[\w-]*\}\}/);
    expect(index).toContain('<a class="button primary" href="present.html">Start presenting</a>');
  });

  it('ships the tutorial with every picture it shows, also under the major', () => {
    for (const dir of ['', `v${protocolMajor()}/`]) {
      const page = readFileSync(join(out, dir, 'tutorial.html'), 'utf8');
      const images = [...page.matchAll(/src="(tutorial\/[^"]+)"/g)].map((m) => m[1]!);
      expect(images.length).toBeGreaterThan(10);
      for (const image of images) {
        const head = readFileSync(join(out, dir, image))
          .subarray(0, 4)
          .toString('latin1');
        expect(head, `${dir}${image}`).toMatch(/^(\x89PNG|GIF8)/);
      }
      expect(readFileSync(join(out, dir, 'index.html'), 'utf8')).toContain('href="tutorial.html"');
    }
  });

  it('points the 404 page at the site base', () => {
    const page = readFileSync(join(out, '404.html'), 'utf8');
    expect(page).toContain('src="/inksplat/redirect.js"');
    expect(page).toContain('data-base="/inksplat/"');
    expect(page).not.toContain('{{base}}');
  });

  it('passes the smoke check when served', async () => {
    expect(await smokeSite(base)).toEqual([]);
  });

  it('fails the smoke check when something is missing', async () => {
    rmSync(join(out, 'privacy.html'));
    try {
      const problems = await smokeSite(base);
      expect(problems.join('\n')).toMatch(/privacy policy: status 404/);
    } finally {
      writeFileSync(join(out, 'privacy.html'), 'privacy policy');
    }
  });

  it('reports a site that cannot be reached', async () => {
    const problems = await smokeSite('http://127.0.0.1:1/');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/cannot fetch/);
  });

  it('accepts only sane base paths', () => {
    expect(normalizeBase('/inksplat')).toBe('/inksplat/');
    expect(normalizeBase('/')).toBe('/');
    expect(() => normalizeBase('inksplat')).toThrow();
    expect(() => normalizeBase('/a b/')).toThrow();
    expect(() => normalizeBase('//evil.example/')).toThrow();
  });
});
