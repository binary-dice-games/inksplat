// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildViewer, meetMeta, meetVariant } from '../../scripts/build-viewer.mjs';

describe('the Meet pages of the build', () => {
  let out: string;
  const read = (name: string): string => readFileSync(join(out, name), 'utf8');
  const meetPages = ['meet-host.html', 'meet-guest.html', 'meet-stage.html', 'side-panel.html'];

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'inksplat-meet-'));
    process.env.INKSPLAT_MEET_PROJECT = '424242';
    await buildViewer(out);
  });
  afterAll(() => {
    delete process.env.INKSPLAT_MEET_PROJECT;
    rmSync(out, { recursive: true, force: true });
  });

  it('writes the four Meet pages and their scripts', () => {
    for (const name of meetPages) {
      const html = read(name);
      expect(html).toContain('name="inksplat-meet"');
      expect(html).toContain('name="inksplat-meet-project" content="424242"');
      expect(html).toContain('https://www.gstatic.com');
    }
    expect(read('meet-stage.js').length).toBeGreaterThan(1000);
    expect(read('side-panel.js').length).toBeGreaterThan(1000);
  });

  it('keeps the standalone pages free of Meet and of third-party scripts', () => {
    for (const name of ['index.html', 'present.html']) {
      const html = read(name);
      expect(html).not.toContain('gstatic');
      expect(html).not.toContain('inksplat-meet');
      expect(html).toContain("script-src 'self';");
    }
  });

  it('leaves no placeholder behind', () => {
    for (const name of meetPages) {
      expect(read(name)).not.toContain('{{meet');
    }
  });

  it('writes the project number only when it is a number', () => {
    expect(meetMeta('')).not.toContain('project');
    expect(meetMeta('12x')).not.toContain('project');
    expect(meetMeta('7')).toContain('content="7"');
  });

  it('refuses a page it cannot make a variant of', () => {
    expect(() => meetVariant('<html></html>', '')).toThrow();
  });
});
