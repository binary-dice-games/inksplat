// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SUPPORT_DOWNLOADS, SUPPORT_SCHEME } from '@inksplat/defaults';

// The installers' configuration (spec/08_remote_support/DESIGN.md sections 4.1 and 6.3): the
// link scheme, the file names the landing page links to, the fuses, and nothing that weakens the
// macOS hardened runtime. The packaged binary itself is checked by tests/e2e/support-package.

const APP = resolve(import.meta.dirname, '../../support-app');
const config = JSON.parse(readFileSync(join(APP, 'electron-builder.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));

describe('the installers', () => {
  it('register the link scheme of the landing page', () => {
    expect(config.protocols).toEqual([
      { name: 'inksplat Support link', schemes: [SUPPORT_SCHEME] },
    ]);
  });

  it('are named as the landing page links to them', () => {
    const name = (pattern: string, ext: string) => pattern.replace('${ext}', ext);
    expect(name(config.win.artifactName, 'exe')).toBe(SUPPORT_DOWNLOADS.windows);
    expect(name(config.mac.artifactName, 'dmg')).toBe(SUPPORT_DOWNLOADS.mac);
    expect(name(config.linux.artifactName, 'AppImage')).toBe(SUPPORT_DOWNLOADS.linux);
    expect(name(config.linux.artifactName, 'deb')).toBe(SUPPORT_DOWNLOADS.linuxDeb);
  });

  it('turn off the Node entry points and check the archive', () => {
    expect(config.electronFuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    });
    expect(config.asar).toBe(true);
    expect(config.files).toContain('!**/node_modules/**');
  });

  it('install per user without admin rights on Windows, and check the publisher of updates', () => {
    expect(config.nsis).toMatchObject({ perMachine: false, allowElevation: false });
    expect(config.win.verifyUpdateCodeSignature).toBe(true);
    expect(config.win.signtoolOptions.publisherName).toEqual(['Binary Dice Games']);
  });

  it('keep the hardened runtime on macOS with JIT as its only exception', () => {
    expect(config.mac.hardenedRuntime).toBe(true);
    expect(config.mac.extendInfo.NSScreenCaptureUsageDescription).toMatch(/allow/);
    const plist = readFileSync(join(APP, config.mac.entitlements), 'utf8');
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    expect(keys).toEqual(['com.apple.security.cs.allow-jit']);
  });

  it('use the Electron the app is tested with, and ship no runtime dependencies', () => {
    expect(config.electronVersion).toBe(pkg.devDependencies.electron);
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(config.extraMetadata.dependencies).toEqual({});
  });
});
