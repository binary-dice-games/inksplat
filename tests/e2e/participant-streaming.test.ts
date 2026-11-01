// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { PresenterSite, fakeDisplay, shareScreen } from '../support/presenter-site';

// Anybody streams (spec/07_participant_streaming) in the built site: the presenter and two
// viewers each have a fake screen of their own colour; viewers offer theirs, the presenter
// previews and shows them, switches between them and its own, and shows none.

let site: PresenterSite;
beforeAll(async () => {
  site = await PresenterSite.start();
}, 180000);
afterAll(() => site?.close());

const RED: [string, string] = ['#e00000', '#d00000'];
const GREEN: [string, string] = ['#00d000', '#00c000'];
const BLUE: [string, string] = ['#0000e0', '#0000d0'];

/** The colour in a corner of the video `id`: red, green, blue, `none` (no frame) or another. */
function colour(page: Page, id = 'video'): Promise<string> {
  return page.evaluate((el) => {
    const v = document.getElementById(el) as HTMLVideoElement;
    if (!v.srcObject || !v.videoWidth) return 'none';
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    g.drawImage(v, 0, 0);
    const [r, gg, b] = g.getImageData(5, 5, 1, 1).data as unknown as number[];
    const hi = (x: number) => x > 150;
    const lo = (x: number) => x < 100;
    if (hi(r!) && lo(gg!) && lo(b!)) return 'red';
    if (lo(r!) && hi(gg!) && lo(b!)) return 'green';
    if (lo(r!) && lo(gg!) && hi(b!)) return 'blue';
    return `${r},${gg},${b}`;
  }, id);
}

const shows = (page: Page, c: string, id = 'video') =>
  expect.poll(() => colour(page, id), { timeout: 20000 }).toBe(c);

async function viewer(link: string, name: string, colours: [string, string]): Promise<Page> {
  const page = await (await site.context()).newPage();
  await fakeDisplay(page, 'window', { width: 640, height: 360 }, colours);
  await site.joinViewer(link, name, page);
  await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
  return page;
}

const showButton = (presenter: Page, who: string) =>
  presenter.locator(`#streams button[aria-label="Show ${who} to everybody"]`);

describe('streams of anybody, picked by the presenter', () => {
  it('previews, shows and switches the streams of viewers and the presenter, and shows none', async () => {
    const presenter = await site.presenterPage();
    const link = await site.startSession(presenter);
    const ana = await viewer(link, 'Ana', RED);
    const bob = await viewer(link, 'Bob', GREEN);
    await expect.poll(() => presenter.locator('#people').textContent()).toBe('2 viewers');

    // Nothing shared yet: canvas 1 shows the black screen.
    expect(await ana.locator('#video').isVisible()).toBe(true);
    expect(await colour(ana)).toBe('none');
    expect(await presenter.locator('#notice').textContent()).toBe('Nothing is being shared');

    // Ana offers her screen: the presenter is told and lists it; nobody sees it yet.
    await shareScreen(ana);
    await expect
      .poll(() => ana.locator('#shareStatus').textContent())
      .toBe('The presenter can show your screen');
    await expect.poll(() => presenter.locator('#toast').textContent()).toMatch(/Ana offers/);
    await expect.poll(() => presenter.locator('#streams li').count()).toBe(2);
    expect(await presenter.locator('#streams li').first().textContent()).toMatch(
      /Ana\s*window 640×360/,
    );

    // A preview: only the presenter sees it, and Ana knows.
    await presenter.locator('#streams button[aria-label="Preview the screen of Ana"]').click();
    await shows(presenter, 'red', 'previewVideo');
    await expect
      .poll(() => ana.locator('#shareStatus').textContent())
      .toBe('The presenter is looking at your screen');
    expect(await colour(bob)).toBe('none');

    // Shown: everybody sees it; Ana sees her own capture.
    await showButton(presenter, 'the screen of Ana').click();
    await Promise.all([shows(bob, 'red'), shows(presenter, 'red'), shows(ana, 'red')]);
    await expect
      .poll(() => ana.locator('#shareStatus').textContent())
      .toBe('On screen for everybody');
    expect(await presenter.locator('#previewVideo').isVisible()).toBe(false); // it is on screen

    // Bob's turn.
    await shareScreen(bob);
    await expect.poll(() => showButton(presenter, 'the screen of Bob').count()).toBe(1);
    await showButton(presenter, 'the screen of Bob').click();
    await Promise.all([shows(ana, 'green'), shows(presenter, 'green'), shows(bob, 'green')]);
    await expect
      .poll(() => ana.locator('#shareStatus').textContent())
      .toBe('The presenter can show your screen');

    // The presenter shares too: a guest is on the screen, so it stays until the presenter picks.
    await fakeColour(presenter, BLUE);
    await shareScreen(presenter);
    await expect
      .poll(() => presenter.locator('#shareStatus').textContent())
      .toBe('Your screen is ready to show');
    await showButton(presenter, 'your screen').click();
    await Promise.all([shows(ana, 'blue'), shows(bob, 'blue'), shows(presenter, 'blue')]);

    // Bob stops: his stream leaves the list; the screen stays on the presenter's.
    await bob.locator('#share').click();
    await expect.poll(() => showButton(presenter, 'the screen of Bob').count()).toBe(0);
    await shows(bob, 'blue');

    // None: black for everybody.
    await showButton(presenter, 'nothing').click();
    await Promise.all([shows(ana, 'none'), shows(bob, 'none'), shows(presenter, 'none')]);

    // Ana leaves while on the screen: it goes black, her stream leaves the list.
    await showButton(presenter, 'the screen of Ana').click();
    await shows(bob, 'red');
    await ana.close();
    await expect
      .poll(() => showButton(presenter, 'the screen of Ana').count(), { timeout: 30000 })
      .toBe(0);
    await shows(bob, 'none');
  });
});

/** Gives the presenter's next capture the colours `c` (its page was opened with the default). */
async function fakeColour(page: Page, c: [string, string]): Promise<void> {
  await page.evaluate((cols) => {
    const md = navigator.mediaDevices;
    const real = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = async (asked) => {
      const stream = await real(asked);
      const [track] = stream.getVideoTracks();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const g = canvas.getContext('2d')!;
      let n = 0;
      setInterval(() => {
        n += 1;
        g.fillStyle = n % 2 ? cols[0] : cols[1];
        g.fillRect(0, 0, 640, 360);
      }, 50);
      const out = canvas.captureStream(15);
      const mine = out.getVideoTracks()[0]!;
      const settings = track!.getSettings();
      mine.getSettings = () => ({ ...settings, width: 640, height: 360 }) as MediaTrackSettings;
      (window as unknown as { shared: MediaStreamTrack }).shared = mine;
      return out;
    };
  }, c);
}
