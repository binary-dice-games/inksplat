// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildSupportApp } from '../../support-app/scripts/build.mjs';

// The packaged app (spec/08_remote_support/DESIGN.md sections 4.1, 7.3 R14, plan step 7): an
// unpacked build made by electron-builder from the repository's configuration, checked on the
// real binary: its fuses, what its archive holds, and that another program cannot run code in it
// through ELECTRON_RUN_AS_NODE, NODE_OPTIONS or a debugging port.

const ROOT = resolve(import.meta.dirname, '../..');
const APP = join(ROOT, 'support-app');
const require = createRequire(import.meta.url);
let work: string;
let unpacked: string;

/** The executable of the unpacked build in `out`. */
function executable(out: string): string {
  if (process.platform === 'win32') return join(out, 'win-unpacked', 'inksplat Support.exe');
  if (process.platform === 'darwin') {
    const dir = readdirSync(out).find((d) => d.startsWith('mac'))!;
    return join(out, dir, 'inksplat Support.app', 'Contents', 'MacOS', 'inksplat Support');
  }
  return join(out, 'linux-unpacked', 'inksplat-support');
}

/** The folder of the app's archive in the unpacked build. */
function resources(exe: string): string {
  return process.platform === 'darwin'
    ? join(dirname(exe), '..', 'Resources')
    : join(dirname(exe), 'resources');
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'inksplat-support-package-'));
  // A copy of the app's project, so the build never touches the working tree.
  const project = join(work, 'project');
  mkdirSync(join(project, 'resources'), { recursive: true });
  for (const f of ['package.json', 'electron-builder.json', 'resources/entitlements.mac.plist']) {
    copyFileSync(join(APP, f), join(project, f));
  }
  await buildSupportApp(join(project, 'dist'));
  const out = join(work, 'release');
  const cli = require.resolve('electron-builder/cli.js');
  const electronDist = dirname(require('electron') as unknown as string);
  const r = spawnSync(
    process.execPath,
    [
      cli,
      '--projectDir',
      project,
      '--config',
      'electron-builder.json',
      '--dir',
      '--publish',
      'never',
      `-c.directories.output=${out}`,
      `-c.electronDist=${electronDist}`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      timeout: 600000,
    },
  );
  if (r.status !== 0) {
    throw new Error(`electron-builder failed:\n${r.stdout}\n${r.stderr}`);
  }
  unpacked = executable(out);
}, 660000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

/** Runs the packaged app with `args` and `env`; resolves with its exit code (null: killed). */
function run(args: string[], env: Record<string, string>, ms = 15000): Promise<number | null> {
  return new Promise((done) => {
    const p = spawn(unpacked, args, { env: { ...process.env, ...env }, stdio: 'ignore' });
    const timer = setTimeout(() => p.kill(), ms);
    p.on('exit', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
}

describe('the packaged app', () => {
  it('has the fuses of DESIGN 4.1', async () => {
    const fuses = require('@electron/fuses') as {
      getCurrentFuseWire(p: string): Promise<Record<number, number>>;
      FuseV1Options: Record<number, string>;
    };
    const wire = await fuses.getCurrentFuseWire(unpacked);
    const on: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(wire)) {
      const name = fuses.FuseV1Options[Number(k)];
      if (name) on[name] = String.fromCharCode(v) === '1';
    }
    expect(on).toMatchObject({
      RunAsNode: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      EnableEmbeddedAsarIntegrityValidation: true,
      OnlyLoadAppFromAsar: true,
      GrantFileProtocolExtraPrivileges: false,
    });
  });

  it('holds only the bundled app in its archive, and the update feed of this repository', () => {
    const asar = require('@electron/asar') as { listPackage(p: string): string[] };
    const res = resources(unpacked);
    const files = asar.listPackage(join(res, 'app.asar')).map((f) => f.replaceAll('\\', '/'));
    expect(files.filter((f) => f.includes('node_modules'))).toEqual([]);
    for (const f of [
      '/dist/main.js',
      '/dist/control.html',
      '/dist/preload-session.js',
      '/package.json',
    ]) {
      expect(files).toContain(f);
    }
    expect(existsSync(join(res, 'app'))).toBe(false);
    const feed = readFileSync(join(res, 'app-update.yml'), 'utf8');
    expect(feed).toMatch(/owner: binary-dice-games/);
    expect(feed).toMatch(/repo: inksplat/);
  });

  it('runs no code from ELECTRON_RUN_AS_NODE or NODE_OPTIONS', async () => {
    const marker = join(work, 'ran');
    const evil = join(work, 'evil.cjs');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`);
    // As Node, `-e` would write the marker. The packaged app is no Node: it starts as itself and,
    // here, stops at once on the switch it refuses.
    await run(
      ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`, '--no-sandbox'],
      {
        ELECTRON_RUN_AS_NODE: '1',
      },
    );
    expect(existsSync(marker)).toBe(false);
    await run(['--no-sandbox'], { NODE_OPTIONS: `--require ${evil}` });
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses to start with a debugging port, which then never opens', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const exit = run([`--remote-debugging-port=${port}`, '--no-sandbox'], {}, 20000);
    // While it runs (it should stop at once), nothing listens on the port.
    const listening = await new Promise<boolean>((done) => {
      setTimeout(() => {
        const s = connect(port, '127.0.0.1');
        s.on('connect', () => {
          s.destroy();
          done(true);
        });
        s.on('error', () => done(false));
      }, 1500);
    });
    expect(listening).toBe(false);
    expect(await exit).toBe(1);
  });
});
