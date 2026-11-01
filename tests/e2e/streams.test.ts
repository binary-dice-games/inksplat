// MIT License © 2026 Binary Dice Games
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Server } from 'node:http';
import { FakeTracker } from '../support/fake-tracker';
import { launchChrome, serveFiles } from '../support/browser';

// Guests' streams over real WebRTC (spec/07_participant_streaming, plan steps 3 and 4): a guest's
// canvas goes up to the host only when asked, and the host relays the stream it picks to every
// other guest, forwarding encoded frames or, when told not to, encoding them again.

interface App {
  ready?: boolean;
  token: string;
  state: string | null;
  errors: string[];
  logs: string[];
  session: {
    host(): unknown;
    setRelay(id: string | null): void;
    relayMode: string;
    me: { id: string };
  };
  ask(id: string, on: boolean): void;
  share(on: boolean): void;
  color(id?: string): string | null;
  inbound(): Promise<string | null>;
  tracks: number;
  encodedBy(): Promise<Record<string, number>>;
}

let browser: Browser;
let tracker: FakeTracker;
let files: { origin: string; server: Server };
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  [browser, tracker, files] = await Promise.all([
    launchChrome(),
    FakeTracker.start(),
    serveFiles(),
  ]);
});

// Each test's pages close when it ends: pages left open keep encoding and slow the next test.
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

afterAll(async () => {
  await browser?.close();
  await tracker?.stop();
  files?.server.close();
});

async function open(params: Record<string, string>): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  const query = new URLSearchParams({ tracker: tracker.url, ...params });
  await page.goto(`${files.origin}/pages/streams.html?${query}`);
  await page.waitForFunction(() => (window as unknown as { app?: App }).app?.ready);
  return page;
}

const app = (page: Page) => page.evaluate.bind(page);

async function joined(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { app: App }).app.session.host() !== null,
    undefined,
    { timeout: 30000, polling: 100 },
  );
}

/** Waits until the video `id` of `page` shows `color`. */
async function shows(page: Page, color: string, id = 'v'): Promise<void> {
  await page.waitForFunction(
    ([c, v]) => (window as unknown as { app: App }).app.color(v) === c,
    [color, id] as const,
    { timeout: 15000, polling: 100 },
  );
}

async function room(forward: boolean) {
  const flag = forward ? '1' : '0';
  const host = await open({ role: 'host', id: 'host-0001', color: '#0000ee', forward: flag });
  const token = await host.evaluate(() => (window as unknown as { app: App }).app.token);
  const guest = (id: string, color: string) =>
    open({ role: 'guest', id, color, token, forward: flag });
  const [ana, bob] = await Promise.all([
    guest('ana-0001', '#ee0000'),
    guest('bob-0001', '#00cc00'),
  ]);
  await Promise.all([joined(ana), joined(bob)]);
  return { host, ana, bob, guest };
}

describe("guests' streams relayed by the host", () => {
  for (const forward of [true, false]) {
    it(`shows the stream the host picks to everyone else (${forward ? 'forwarded' : 're-encoded'})`, async () => {
      const { host, ana, bob, guest } = await room(forward);
      const run = app(host);
      expect(await run(() => (window as unknown as { app: App }).app.session.relayMode)).toBe(
        forward ? 'forward' : 'reencode',
      );
      // The host's own stream goes out by default.
      await Promise.all([shows(ana, 'blue'), shows(bob, 'blue')]);

      // Ana offers her screen; the host asks for it and shows it to everybody else.
      await ana.evaluate(() => (window as unknown as { app: App }).app.share(true));
      await run(() => (window as unknown as { app: App }).app.ask('ana-0001', true));
      await shows(host, 'red', 'up');
      await run(() => (window as unknown as { app: App }).app.session.setRelay('ana-0001'));
      await shows(bob, 'red');

      // Someone joining late gets a picture too.
      const cy = await guest('cy-00001', '#888888');
      await joined(cy);
      await shows(cy, 'red');

      // Bob's turn, then back to the host's own.
      await bob.evaluate(() => (window as unknown as { app: App }).app.share(true));
      await run(() => (window as unknown as { app: App }).app.ask('bob-0001', true));
      await run(() => (window as unknown as { app: App }).app.session.setRelay('bob-0001'));
      await Promise.all([shows(ana, 'green'), shows(cy, 'green')]);
      await run(() => (window as unknown as { app: App }).app.session.setRelay('host-0001'));
      await Promise.all([shows(ana, 'blue'), shows(bob, 'blue'), shows(cy, 'blue')]);
      for (const p of [host, ana, bob, cy]) {
        expect(await p.evaluate(() => (window as unknown as { app: App }).app.errors)).toEqual([]);
      }
    });
  }

  it('sends nothing up before the host asks', async () => {
    const { host, ana } = await room(true);
    await ana.evaluate(() => (window as unknown as { app: App }).app.share(true));
    /** The uplink sender: whether it has the track, whether it may send, and what it sent. */
    const uplink = () =>
      ana.evaluate(async () => {
        type Links = Map<string, { link: { pc: RTCPeerConnection } }>;
        const s = (window as unknown as { app: { session: { links: Links } } }).app.session;
        const pc = s.links.values().next().value!.link.pc;
        const sender = pc.getTransceivers()[1]!.sender;
        let bytes = 0;
        (await sender.getStats()).forEach((r) => {
          if (r.type === 'outbound-rtp') bytes += r.bytesSent;
        });
        const active = sender.getParameters().encodings[0]?.active;
        return { track: sender.track !== null, active, bytes };
      });
    await expect.poll(uplink).toEqual({ track: true, active: false, bytes: 0 });
    await host.evaluate(() => (window as unknown as { app: App }).app.ask('ana-0001', true));
    await expect.poll(async () => (await uplink()).bytes, { timeout: 10000 }).toBeGreaterThan(0);
    await host.evaluate(() => (window as unknown as { app: App }).app.ask('ana-0001', false));
    await expect.poll(async () => (await uplink()).active).toBe(false);
  });

  it('forwards in the best codec each link has, and re-encodes for a viewer without it', async () => {
    const fcodecs = 'video/AV1,video/H264,video/VP8';
    const host = await open({ role: 'host', id: 'host-0001', color: '#0000ee', fcodecs });
    const token = await host.evaluate(() => (window as unknown as { app: App }).app.token);
    const guest = (id: string, color: string, extra: Record<string, string> = {}) =>
      open({ role: 'guest', id, color, token, ...extra });
    const [ana, bob, cy, dan, eve] = await Promise.all([
      guest('ana-0001', '#ee0000'),
      guest('bob-0001', '#00cc00', { noav1: '1' }),
      guest('cy-00001', '#888888'),
      // Dan would rather have VP9 but takes AV1 too: the host picks AV1, whatever his order.
      guest('dan-0001', '#888888', { prefer: 'video/VP9,video/AV1' }),
      // Eve takes nothing the host forwards in: she gets her VP9 and every guest re-encoded.
      guest('eve-0001', '#888888', { only: 'video/VP9' }),
    ]);
    const all = [ana, bob, cy, dan, eve];
    await Promise.all(all.map(joined));
    await Promise.all(all.map((p) => shows(p, 'blue')));
    const inbound = (p: Page) =>
      p.evaluate(() => (window as unknown as { app: App }).app.inbound());
    expect(await inbound(cy)).toBe('video/AV1');
    expect(await inbound(bob)).toBe('video/H264');
    expect(await inbound(dan)).toBe('video/AV1');
    expect(await inbound(eve)).toBe('video/VP9');

    // The host's own stream is encoded once, in AV1, for every viewer on AV1; Bob (H.264) and
    // Eve (VP9) keep an encoder of their own.
    type Host = {
      app: { session: { encoderInfo(): Promise<unknown> }; encodedBy: App['encodedBy'] };
    };
    await expect
      .poll(() => host.evaluate(() => (window as unknown as Host).app.session.encoderInfo()), {
        timeout: 10000,
      })
      .toMatchObject({ codec: 'video/AV1' });
    const encodedBy = () => host.evaluate(() => (window as unknown as Host).app.encodedBy());
    const before = await encodedBy();
    await new Promise((r) => setTimeout(r, 1500));
    const after = await encodedBy();
    const made = (id: string) => after[id]! - before[id]!;
    for (const id of ['ana-0001', 'cy-00001', 'dan-0001']) expect(made(id), id).toBe(0);
    for (const id of ['bob-0001', 'eve-0001']) expect(made(id), id).toBeGreaterThan(5);

    // Ana's AV1 stream: forwarded to Cy, decoded and encoded again in H.264 for Bob.
    await ana.evaluate(() => (window as unknown as { app: App }).app.share(true));
    const run = app(host);
    await run(() => (window as unknown as { app: App }).app.ask('ana-0001', true));
    await run(() => (window as unknown as { app: App }).app.session.setRelay('ana-0001'));
    await Promise.all([bob, cy, dan, eve].map((p) => shows(p, 'red')));
    expect(await inbound(bob)).toBe('video/H264');
    expect(await inbound(cy)).toBe('video/AV1');
    expect(await inbound(dan)).toBe('video/AV1');
    expect(await inbound(eve)).toBe('video/VP9');

    // Bob's turn (his uplink offers AV1: only his downlink lacks it).
    await bob.evaluate(() => (window as unknown as { app: App }).app.share(true));
    await run(() => (window as unknown as { app: App }).app.ask('bob-0001', true));
    await run(() => (window as unknown as { app: App }).app.session.setRelay('bob-0001'));
    await Promise.all([ana, cy, dan, eve].map((p) => shows(p, 'green')));

    // Back to the host's own: everybody on their own encoder.
    await run(() => (window as unknown as { app: App }).app.session.setRelay('host-0001'));
    await Promise.all(all.map((p) => shows(p, 'blue')));
    for (const p of [host, ...all]) {
      expect(await p.evaluate(() => (window as unknown as { app: App }).app.errors)).toEqual([]);
    }
    // Only the link each guest kept announced its video (offers on other links may be answered).
    for (const p of all) {
      expect(await p.evaluate(() => (window as unknown as { app: App }).app.tracks)).toBe(1);
    }
  });
});
