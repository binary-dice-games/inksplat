// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { PresenterSite } from '../support/presenter-site';
import { fakeMeetInit } from '../support/fake-meet';

// The Google Meet add-on (spec/08_meet_addon): the real built pages in Chrome, with a fake Meet
// SDK that shares the activity starting state and a co-doing broadcast between the pages of one
// browser context. No tracker and no link: the peers find each other through the broadcast.

let site: PresenterSite;

beforeAll(async () => {
  process.env.INKSPLAT_MEET_PROJECT = '424242';
  site = await PresenterSite.start();
});

afterAll(async () => {
  delete process.env.INKSPLAT_MEET_PROJECT;
  await site?.close();
});

let n = 0;

/** A fake call: one browser context, whose pages share the fake Meet. */
async function call(): Promise<BrowserContext> {
  const ctx = await site.context();
  await ctx.addInitScript({ content: fakeMeetInit().script(`call-${process.pid}-${n++}`) });
  return ctx;
}

async function open(ctx: BrowserContext, path: string): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`${site.origin}/${path}?meet_sdk=fake`);
  return page;
}

/** The starter: the side panel starts the activity and the main stage becomes the host page. */
async function start(ctx: BrowserContext): Promise<Page> {
  const page = await open(ctx, 'side-panel.html');
  await page.click('#start');
  await page.waitForURL(/meet-host\.html/, { timeout: 30000 });
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  return page;
}

/** A participant who opens the add-on: the stage router sends them to the guest page. */
async function join(ctx: BrowserContext): Promise<Page> {
  const page = await open(ctx, 'meet-stage.html');
  await page.waitForURL(/meet-guest\.html/, { timeout: 30000 });
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  return page;
}

describe('inksplat in a Google Meet call', () => {
  it('links the starter and the others with no link, code or tracker', async () => {
    const ctx = await call();
    const host = await start(ctx);
    const [ana, bob] = await Promise.all([join(ctx), join(ctx)]);
    expect(site.tracker.peers()).toBe(0);
    await host.waitForFunction(
      () => document.body.textContent?.includes('Meet participant'),
      undefined,
      {
        timeout: 15000,
      },
    );
    expect(await ana.isVisible('#app')).toBe(true);
    expect(await bob.isVisible('#app')).toBe(true);
  }, 90000);

  it('lets someone who opens the add-on later join the running session', async () => {
    const ctx = await call();
    await start(ctx);
    const first = await join(ctx);
    const late = await join(ctx);
    expect(await first.isVisible('#app')).toBe(true);
    expect(await late.isVisible('#app')).toBe(true);
  }, 90000);

  it('shows the host no invite link and no way to start again', async () => {
    const ctx = await call();
    const host = await start(ctx);
    expect(await host.isVisible('#link')).toBe(false);
    expect(await host.isVisible('#again')).toBe(false);
  }, 60000);

  it('ends the session for the others when the host leaves', async () => {
    const ctx = await call();
    const host = await start(ctx);
    const guest = await join(ctx);
    await host.close();
    await guest.waitForFunction(
      () => document.getElementById('waitTitle')?.textContent === 'Session over',
      undefined,
      {
        timeout: 30000,
      },
    );
  }, 90000);

  it('says to open it from a call when there is no Meet', async () => {
    const ctx = await site.context();
    const page = await ctx.newPage();
    await page.goto(`${site.origin}/meet-stage.html`);
    await page.waitForFunction(
      () => document.getElementById('text')?.textContent?.includes('Google Meet'),
      undefined,
      {
        timeout: 15000,
      },
    );
    expect(await page.textContent('#text')).toMatch(/Activities/);
  }, 60000);

  it('tells a joiner nobody has started it', async () => {
    const ctx = await call();
    const page = await open(ctx, 'meet-stage.html');
    await page.waitForFunction(
      () => document.getElementById('text')?.textContent?.includes('not been started'),
      undefined,
      {
        timeout: 15000,
      },
    );
  }, 60000);
});
