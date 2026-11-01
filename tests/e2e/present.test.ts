// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readArchiveManifest } from '../../viewer/src/board-archive';
import { zipParts } from '../../viewer/src/zip';
import {
  PresenterSite,
  configure,
  draw,
  items,
  shareScreen,
  videoWidth,
} from '../support/presenter-site';
import { makePdf } from '../support/pdf';
import { makeZip } from '../support/zip';

/** A 16x16 GIF of two frames: a red and a green disc on a transparent background. */
const DISC_GIF =
  'R0lGODlhEAAQAIEAAAAAANwoKAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJFAAAACwAAAAAEAAQAAAIOAABCBxIsKDBgwgFBlgYICEAhhAbGowYcSJFhgUvVhyoESLBjhg5gpQoUqNFkyc3IvTosKVLggEBACH5BAkUAAAALAIAAgAMAAwAgQAAACigPAAAAAAAAAgpAAEIBBCgYICBAw0qPChw4cKGDg0SjEixosWLBSdShLiR40OEGhkKDAgAOw==';

// The static presenter page (spec/06_static_presenter, spec/07_participant_streaming) in
// Chrome: it starts a session and shares a "screen" (a canvas stream standing in for the
// picker, which automation cannot drive), a viewer joins through the site's viewer page over
// real WebRTC, video arrives, drawings go both ways, and None, a lost source and the end reach
// the viewer.

let site: PresenterSite;
beforeAll(async () => {
  site = await PresenterSite.start();
}, 180000);
afterAll(() => site?.close());

const presenterPage = (surface?: string) => site.presenterPage(surface);
const startSharing = (page: Awaited<ReturnType<PresenterSite['presenterPage']>>) =>
  site.startSharing(page);
const joinViewer = (link: string, name?: string) => site.joinViewer(link, name);

describe('static presenter page', () => {
  it('is linked from the viewer page and shows the start screen', async () => {
    const page = await presenterPage();
    await expect.poll(() => page.locator('#startSession').isVisible()).toBe(true);
    // The start page only starts a session: sharing happens in it.
    expect(await page.locator('#startBoard').count()).toBe(0);
    expect(await page.locator('#start button').allTextContents()).toEqual([
      'Start session',
      'Settings…',
    ]);
    const ctx = await site.context();
    const landing = await ctx.newPage();
    await landing.goto(`${site.origin}/`);
    await expect
      .poll(() => landing.locator('a[href="present.html"]').count(), { timeout: 10000 })
      .toBe(1);
  });

  it('shows the logo on the home page and an About box with the version', async () => {
    const ctx = await site.context();
    const home = await ctx.newPage();
    await home.goto(`${site.origin}/`);
    await expect.poll(() => home.locator('#landing').isVisible()).toBe(true);
    const logo = home.locator('.hero-logo img');
    await expect
      .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(880);
    expect(await home.locator('#about').isVisible()).toBe(false);
    await home.locator('#aboutOpen').click();
    await expect.poll(() => home.locator('#about').isVisible()).toBe(true);
    expect(await home.locator('#aboutVersion').textContent()).toMatch(
      /^Version \d+\.\d+\.\d+.*, protocol inksplat\/\d+\.$/,
    );
    await home.locator('#aboutClose').click();
    await expect.poll(() => home.locator('#about').isVisible()).toBe(false);
    await home.locator('#aboutFoot').click();
    await expect.poll(() => home.locator('#about').isVisible()).toBe(true);
  });

  it('shares a source: video reaches a viewer, drawings go both ways, None and end follow', async () => {
    const presenter = await presenterPage();
    const link = await startSharing(presenter);
    expect(link.startsWith(`${site.origin}/#inksplat=`)).toBe(true);
    const viewer = await joinViewer(link);

    // The video arrives, at the source's own size.
    await expect
      .poll(
        () =>
          viewer.evaluate(() => (document.getElementById('video') as HTMLVideoElement).videoWidth),
        { timeout: 30000 },
      )
      .toBe(640);
    await expect.poll(() => presenter.locator('#people').textContent()).toBe('1 viewer');

    // The presenter draws on the host session: the viewer sees it, and the other way round.
    await draw(presenter, [200, 200]);
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(1);
    await draw(viewer, [200, 380]);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(2);

    // Viewers can draw: off disables the viewer's pen, on enables it.
    const pen = () => viewer.locator('collab-whiteboard button[aria-label="Pen"]').isDisabled();
    await presenter.bringToFront();
    await presenter.locator('#drawing').uncheck();
    await expect.poll(pen, { timeout: 10000 }).toBe(true);
    await presenter.locator('#drawing').check();
    await expect.poll(pen, { timeout: 10000 }).toBe(false);

    // None blacks the screen out for the viewer; Show brings the video back.
    await presenter.locator('#streams button[aria-label="Show nothing to everybody"]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 15000 }).toBe(0);
    await presenter.locator('#streams button[aria-label="Show your screen to everybody"]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 15000 }).toBe(640);
    expect(await presenter.locator('#shareStatus').textContent()).toBe('On screen for everybody');

    // Clear removes the drawings everywhere.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#clear').click();
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(0);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(0);

    // Canvas 1 shows the screen and canvas 2 a whiteboard, until the presenter gives it the screen.
    const canvasButton = (page: typeof viewer, n: number) =>
      page.locator(`collab-whiteboard .pages button[aria-label^="Canvas ${n},"]`);
    await canvasButton(viewer, 2).click();
    await expect.poll(() => viewer.locator('#page').isVisible()).toBe(true);
    expect(await viewer.locator('#video').isVisible()).toBe(false);
    await canvasButton(presenter, 2).click();
    await expect
      .poll(() => presenter.locator('#backgroundLabel').textContent())
      .toBe('Background of canvas 2');
    expect(await presenter.locator('#background').inputValue()).toBe('whiteboard');
    expect(await presenter.locator('#screenHere').isVisible()).toBe(true);
    await presenter.locator('#screenHere').click();
    await expect.poll(() => presenter.locator('#background').inputValue()).toBe('screen');
    await expect.poll(() => viewer.locator('#video').isVisible(), { timeout: 15000 }).toBe(true);
    expect(await viewer.locator('#page').isVisible()).toBe(false);
    await canvasButton(viewer, 1).click();
    await canvasButton(presenter, 1).click();

    // The user stops sharing in the browser: the session stays, the screen goes black, and the
    // button shares again.
    await presenter.evaluate(() =>
      (window as unknown as { shared: MediaStreamTrack }).shared.dispatchEvent(new Event('ended')),
    );
    await expect.poll(() => presenter.locator('#share').textContent()).toBe('Share screen');
    await expect.poll(() => videoWidth(viewer), { timeout: 15000 }).toBe(0);
    expect(await presenter.locator('#streams li').count()).toBe(1); // None alone
    await shareScreen(presenter);
    await expect.poll(() => videoWidth(viewer), { timeout: 15000 }).toBe(640);

    // End: the viewer is told, the presenter sees the end screen.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#end').click();
    await presenter.locator('#over').waitFor({ state: 'visible' });
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/ended/);
    await expect.poll(() => viewer.locator('#wait').isVisible()).toBe(true);
  });

  it('starts a board with nothing shared: backgrounds, files pinned with previews, copies dragged out', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });

    // A sheet instead of the video, and nothing to wait for.
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);
    expect(await viewer.locator('#video').isVisible()).toBe(false);
    expect(await viewer.locator('#notice').textContent()).toBe('');
    expect(await presenter.locator('#share').isVisible()).toBe(true);

    // The presenter changes the background for everyone.
    const frame = (page: typeof viewer) =>
      page.locator('#page').evaluate((e) => getComputedStyle(e).borderTopColor);
    await expect.poll(() => frame(viewer)).toBe('rgb(185, 190, 198)');
    await presenter.locator('#background').selectOption('cork');
    await expect.poll(() => frame(viewer), { timeout: 15000 }).toBe('rgb(139, 94, 52)');
    await expect.poll(() => frame(presenter)).toBe('rgb(139, 94, 52)');
    // Its textures are drawn once into bitmaps (at twice their size), which the page's CSP lets in.
    await expect
      .poll(() =>
        viewer
          .locator('#page')
          .evaluate((e) => (getComputedStyle(e).backgroundImage.match(/blob:/g) ?? []).length),
      )
      .toBe(4);
    const tiles = await viewer.locator('#page').evaluate(async (e) => {
      const urls = [...getComputedStyle(e).backgroundImage.matchAll(/url\("(blob:[^"]+)"\)/g)];
      return Promise.all(
        urls.map(async ([, url]) => {
          const image = new Image();
          image.src = url!;
          await image.decode();
          return image.naturalWidth;
        }),
      );
    });
    expect(tiles).toEqual([600, 600, 1000, 600]);
    expect(await viewer.locator('#page').evaluate((e) => getComputedStyle(e).backgroundSize)).toBe(
      '300px 300px, 300px 300px, 500px 500px, 300px 300px, auto',
    );

    // Files dropped on the presenter's board: a text file, a real picture, a binary one.
    await presenter.evaluate(async () => {
      const png = await new Promise<Blob>((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 80;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#3e63dd';
        ctx.fillRect(0, 0, 120, 80);
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });
      const dt = new DataTransfer();
      dt.items.add(new File(['hello board'], 'notes.txt', { type: 'text/plain' }));
      dt.items.add(new File([png], 'blue.png', { type: 'image/png' }));
      dt.items.add(new File([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], 'bundle.zip'));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 200,
        }),
      );
    });
    const pinned = (page: typeof viewer) =>
      page.locator('collab-whiteboard .item.image-item').count();
    await expect.poll(() => pinned(presenter), { timeout: 15000 }).toBe(3);
    await expect.poll(() => pinned(viewer), { timeout: 15000 }).toBe(3);

    // Each has a preview picture, a shadow and a pin.
    const hrefs = await viewer
      .locator('collab-whiteboard .item.image-item image')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')?.slice(0, 22)));
    expect(hrefs.every((h) => h?.startsWith('data:image/'))).toBe(true);
    expect(await viewer.locator('collab-whiteboard .item.image-item .pin circle').count()).toBe(9); // each: what catches the pointer, the pin, its highlight
    expect(await viewer.locator('collab-whiteboard .item.image-item g[filter]').count()).toBe(3);

    // The viewer drags a copy of the text file out: once it has arrived, the drag carries it.
    const dragOut = (name: string) =>
      viewer.evaluate(async (title) => {
        const proxy = [
          ...document
            .querySelector('collab-whiteboard')!
            .shadowRoot!.querySelectorAll<HTMLElement>('.proxy'),
        ].find((p) => p.title.startsWith(title))!;
        const dt = new DataTransfer();
        const ev = new DragEvent('dragstart', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
        });
        proxy.dispatchEvent(ev);
        const file = dt.files[0];
        return {
          refused: ev.defaultPrevented,
          name: file?.name,
          text: file?.type === 'text/plain' ? await file.text() : undefined,
          size: file?.size,
          url: dt.getData('DownloadURL').slice(0, 30),
        };
      }, name);
    await expect
      .poll(async () => (await dragOut('notes.txt')).refused, { timeout: 15000 })
      .toBe(false);
    expect(await dragOut('notes.txt')).toMatchObject({
      name: 'notes.txt',
      text: 'hello board',
      url: 'text/plain:notes.txt:blob:http',
    });
    await expect.poll(async () => (await dragOut('bundle.zip')).size, { timeout: 15000 }).toBe(7);

    // A file over the limit that is not a picture is refused with a message.
    await presenter.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'huge.zip'));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    await expect.poll(() => presenter.locator('#toast').textContent()).toMatch(/too large/);
    expect(await pinned(presenter)).toBe(3);
  });

  it('animates a dropped GIF and draws a picture with transparent parts as a cutout', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });

    // A 16x16 GIF of two frames, a red and a green disc on a transparent background.
    await presenter.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'disc.gif', { type: 'image/gif' }));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 200,
        }),
      );
    }, DISC_GIF);
    const picture = (page: typeof viewer) =>
      page.locator('collab-whiteboard .item.image-item image');
    for (const page of [presenter, viewer]) {
      // Drawn from the file itself once it is there, so it moves.
      await expect
        .poll(() => picture(page).getAttribute('href'), { timeout: 15000 })
        .toMatch(/^blob:http/);
      // A cutout: no white rectangle, a border that follows the disc.
      expect(await picture(page).getAttribute('filter')).toMatch(/^url\(#wb-cut-/);
      expect(await page.locator('collab-whiteboard .item.image-item .paper').count()).toBe(0);
    }
    const loaded = await picture(viewer).evaluate(async (node) => {
      const img = new Image();
      img.src = node.getAttribute('href')!;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
    expect(loaded).toEqual([16, 16]);
  });

  it('previews a PDF and an Office file with their content, and gives the link as a QR code', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);

    // The QR code of the link, for a camera.
    await presenter.locator('#showQr').click();
    await presenter.locator('#qr').waitFor({ state: 'visible' });
    expect(await presenter.locator('#qrCode svg path').count()).toBe(1);
    expect(await presenter.locator('#qrLink').textContent()).toBe(link);
    await presenter.locator('#closeQr').click();
    await expect.poll(() => presenter.locator('#qr').isVisible()).toBe(false);

    // A PDF and a docx dropped on the board show their content, not just the type.
    const docx = makeZip({
      'word/document.xml':
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Quarterly report: revenue grew and costs fell this year</w:t></w:r></w:p></w:body></w:document>',
    });
    await presenter.evaluate(
      async ([pdf, office]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(pdf!)], 'plan.pdf', { type: 'application/pdf' }));
        dt.items.add(new File([new Uint8Array(office!)], 'report.docx'));
        document.getElementById('stage')!.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
            clientX: 300,
            clientY: 200,
          }),
        );
      },
      [[...makePdf()], [...docx]],
    );
    const pinned = presenter.locator('collab-whiteboard .item.image-item image');
    await expect.poll(() => pinned.count(), { timeout: 30000 }).toBe(2);

    // Dark pixels in the content area of each card: a plain card only has light grey bars.
    const dark = (index: number) =>
      pinned.nth(index).evaluate(async (node) => {
        const img = new Image();
        img.src = node.getAttribute('href')!;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const px = g.getImageData(20, 80, 280, 205).data;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if ((px[i]! + px[i + 1]! + px[i + 2]!) / 3 < 100) n++;
        }
        return n;
      });
    expect(await dark(0)).toBeGreaterThan(3000); // the black bar of the page
    expect(await dark(1)).toBeGreaterThan(100); // the first lines of the document
  });

  it('pins a link that a viewer opens in a new tab', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);

    // A web address dragged onto the presenter's board becomes a card (here, a page of the test site).
    const target = `${new URL(link).origin}/`;
    await presenter.evaluate((url) => {
      const dt = new DataTransfer();
      dt.setData('text/uri-list', url);
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 200,
        }),
      );
    }, target);
    const card = viewer.locator('collab-whiteboard .link-item');
    await expect.poll(() => card.count(), { timeout: 30000 }).toBe(1);
    expect(await card.locator('title').textContent()).toBe(target);
    expect(await card.locator('text').first().textContent()).toContain('127.0.0.1');

    // Clicking it, as a viewer, opens the page in another tab.
    const popup = viewer.context().waitForEvent('page');
    await card.locator('rect').nth(1).click();
    const opened = await popup;
    expect(opened.url()).toBe(target);
    await opened.close();
  });

  it('pins a sticky note that is written by its owner and seen by a viewer', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);

    // The note tool (6) makes a note where the page is clicked, with a text box to type in.
    await presenter.keyboard.press('6');
    const box = (await presenter.locator('#stage').boundingBox())!;
    await presenter.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const editor = presenter.locator('collab-whiteboard textarea.sticky');
    await editor.waitFor({ state: 'visible' });
    await editor.fill('Remember the milk and the long second line of this note');
    await presenter.locator('#stage').click({ position: { x: 20, y: box.height - 20 } });
    await expect.poll(() => editor.count()).toBe(0);

    // The viewer sees the paper, the text and a pin, but no way to edit it.
    const note = viewer.locator('collab-whiteboard .note-item');
    await expect.poll(() => note.count(), { timeout: 30000 }).toBe(1);
    expect(await note.locator('text').first().textContent()).toContain('Remember');
    expect(await note.locator('.pin circle').count()).toBeGreaterThan(0);
    await note.locator('tspan').first().click();
    // Anybody can edit it (until its owner locks it): the click opens its text box for the viewer too.
    expect(await viewer.locator('collab-whiteboard textarea').count()).toBe(1);
  });

  it('ties threads between pins and notes of different shapes with the mouse', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);
    const box = (await presenter.locator('#stage').boundingBox())!;
    const at = (fx: number, fy: number) => ({
      x: box.x + box.width * fx,
      y: box.y + box.height * fy,
    });
    const click = async (fx: number, fy: number) => {
      const p = at(fx, fy);
      await presenter.mouse.click(p.x, p.y);
    };

    // An oval note (6 twice picks the second shape after square), a diamond, and a bare pin.
    await presenter.keyboard.press('6');
    await presenter.keyboard.press('6');
    await presenter.keyboard.press('6');
    await click(0.25, 0.4);
    await presenter.locator('collab-whiteboard textarea.sticky').fill('Start');
    await presenter.keyboard.press('Control+Enter');
    await presenter.keyboard.press('6'); // back to the note tool,
    await presenter.keyboard.press('6'); // and on to the next shape
    await click(0.6, 0.55);
    await presenter.locator('collab-whiteboard textarea.sticky').fill('Decide?');
    await presenter.keyboard.press('Control+Enter');
    await presenter.keyboard.press('Escape');
    await presenter.keyboard.press('7');
    await click(0.45, 0.15);
    await expect
      .poll(() => viewer.locator('collab-whiteboard .item').count(), { timeout: 30000 })
      .toBe(3);
    expect(await viewer.locator('collab-whiteboard ellipse.paper').count()).toBe(1);
    expect(await viewer.locator('collab-whiteboard polygon.paper').count()).toBe(1);

    // Threads: pin to pin by dragging, pressing 8 again changes the heads.
    const pins = await presenter.evaluate(() => {
      const root = document.querySelector('collab-whiteboard')!.shadowRoot!;
      return [...root.querySelectorAll('.item')].map((g) => {
        const pin = g.querySelector('g.pin > circle, circle.paper')!;
        const r = pin.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    });
    await presenter.keyboard.press('8');
    await presenter.mouse.move(pins[0]!.x, pins[0]!.y);
    await presenter.mouse.down();
    await presenter.mouse.move(pins[1]!.x, pins[1]!.y, { steps: 5 });
    await presenter.mouse.up();
    await presenter.keyboard.press('8'); // both heads
    await presenter.mouse.move(pins[1]!.x, pins[1]!.y);
    await presenter.mouse.down();
    await presenter.mouse.move(pins[2]!.x, pins[2]!.y, { steps: 5 });
    await presenter.mouse.up();
    const threads = viewer.locator('collab-whiteboard .arrow-item');
    await expect.poll(() => threads.count(), { timeout: 30000 }).toBe(2);
    expect(await threads.nth(0).locator('polygon').count()).toBe(1);
    expect(await threads.nth(1).locator('polygon').count()).toBe(2);
  });

  it('saves the board as a picture, a drawing and a board file that another session opens', async () => {
    const presenter = await presenterPage();
    await site.startBoard(presenter);
    await presenter.locator('#background').selectOption('cork');
    const box = (await presenter.locator('#stage').boundingBox())!;
    await presenter.keyboard.press('6');
    await presenter.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await presenter.locator('collab-whiteboard textarea.sticky').fill('Keep me');
    await presenter.keyboard.press('Control+Enter');
    await presenter.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['file for later'], 'later.txt', { type: 'text/plain' }));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 700,
          clientY: 300,
        }),
      );
    });
    await expect
      .poll(() => presenter.locator('collab-whiteboard .item').count(), { timeout: 30000 })
      .toBe(2);

    const saved = async (id: string) => {
      await presenter.locator('#saveBoard').click();
      const download = presenter.waitForEvent('download');
      await presenter.locator(id).click();
      const file = await download;
      const path = (await file.path())!;
      return {
        name: file.suggestedFilename(),
        bytes: await import('node:fs').then((fs) => fs.readFileSync(path)),
      };
    };

    // The picture: a real PNG of the frame, with the cork behind the items.
    const png = await saved('#savePng');
    expect(png.name).toMatch(/^inksplat-board-\d{4}-\d\d-\d\d-\d{4}\.png$/);
    expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const look = await presenter.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(img.width - 200, img.height - 120, 1, 1).data; // the cork, away from the items
      return { width: img.width, height: img.height, r: px[0]!, g: px[1]!, b: px[2]! };
    }, png.bytes.toString('base64'));
    expect(look.width).toBe(2000);
    expect(Math.abs(look.height - 2000 * (9 / 16))).toBeLessThan(40);
    expect(look.r).toBeGreaterThan(look.b + 30); // brown, not white or grey

    // The drawing: an SVG with the note's text.
    const svg = await saved('#saveSvg');
    expect(svg.name).toMatch(/\.svg$/);
    const text = svg.bytes.toString('utf8');
    expect(text.startsWith('<svg')).toBe(true);
    expect(text).toContain('Keep me');

    // The board file: another session opens it and carries on, with the file and the cork.
    const file = await saved('#saveFile');
    expect(file.name).toMatch(/\.inksplat\.zip$/);
    // A zip anyone can look into: the note in the JSON of canvas 1, the file as it was dropped.
    const parts = zipParts(new Uint8Array(file.bytes));
    const part = async (name: string) => new TextDecoder().decode(await parts.get(name)!());
    expect(await part('canvas-1.json')).toContain('Keep me');
    expect(await part('files/later.txt')).toBe('file for later');
    expect(await part('settings.json')).toContain('cork');
    const again = await presenterPage();
    await site.startBoard(again);
    await again.locator('#openBoard').click({ trial: true }); // there, without a dialog to find it in
    await again.locator('#openFile').setInputFiles({
      name: file.name,
      mimeType: 'application/zip',
      buffer: file.bytes,
    });
    await expect
      .poll(() => again.locator('collab-whiteboard .item').count(), { timeout: 30000 })
      .toBe(2);
    await expect
      .poll(() => again.locator('#toast').textContent())
      .toContain('Added 2 items, 1 file');
    await expect.poll(() => again.locator('#background').inputValue()).toBe('cork');
    expect(await again.locator('collab-whiteboard .note-item').textContent()).toContain('Keep me');
  });

  it('pulls a thread from a pin with any tool, keeps pins on their notes, and clears only the drawings', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);
    const box = (await presenter.locator('#stage').boundingBox())!;
    const at = (fx: number, fy: number) => ({
      x: box.x + box.width * fx,
      y: box.y + box.height * fy,
    });
    const pointerTool = presenter.locator('collab-whiteboard .toolbar button[data-key="1"]');
    const pins = () =>
      presenter.evaluate(() =>
        [
          ...document
            .querySelector('collab-whiteboard')!
            .shadowRoot!.querySelectorAll('.pin-item circle.paper'),
        ].map((c) => {
          const r = c.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      );

    // A note, and a pin put on top of it; another pin on the bare board.
    await presenter.keyboard.press('6');
    const n = at(0.3, 0.5);
    await presenter.mouse.click(n.x, n.y);
    await presenter.keyboard.press('Control+Enter');
    await presenter.keyboard.press('7');
    await presenter.mouse.click(n.x + 30, n.y - 20); // on the note
    const free = at(0.6, 0.2);
    await presenter.mouse.click(free.x, free.y); // on nothing
    await expect.poll(async () => (await pins()).length).toBe(2);
    const before = (await pins())[0]!;

    // Moving the note (pointer tool) takes the pin along.
    await presenter.keyboard.press('1');
    await presenter.mouse.move(n.x - 40, n.y + 40);
    await presenter.mouse.down();
    await presenter.mouse.move(n.x + 20, n.y + 90, { steps: 5 });
    await presenter.mouse.up();
    await expect.poll(async () => (await pins())[0]!.x).toBeCloseTo(before.x + 60, -1);
    const [attached, bare] = await pins();
    expect(attached!.y).toBeGreaterThan(before.y + 40);

    // With the pointer tool in hand, Shift+pressing on a pin and dragging to the other ties a thread,
    // and the pointer tool is back as soon as the button is up.
    await presenter.mouse.move(attached!.x, attached!.y);
    await presenter.keyboard.down('Shift');
    await presenter.mouse.down();
    await expect.poll(() => pointerTool.getAttribute('aria-pressed')).toBe('false');
    await presenter.mouse.move(bare!.x, bare!.y, { steps: 6 });
    await presenter.mouse.up();
    await presenter.keyboard.up('Shift');
    await expect.poll(() => pointerTool.getAttribute('aria-pressed')).toBe('true');
    const threads = viewer.locator('collab-whiteboard .arrow-item');
    await expect.poll(() => threads.count(), { timeout: 30000 }).toBe(1);

    // A click on that pin selects the pin, though the thread leaves from it.
    await presenter.mouse.click(bare!.x, bare!.y);
    await expect
      .poll(() => presenter.locator('collab-whiteboard .pin-item.selected').count())
      .toBe(1);
    await expect
      .poll(() => presenter.locator('collab-whiteboard .arrow-item.selected').count())
      .toBe(0);

    // Clear drawings: a line goes, the note, pins and thread stay; Clear all takes everything.
    await presenter.keyboard.press('2');
    const a = at(0.5, 0.8);
    await presenter.mouse.move(a.x, a.y);
    await presenter.mouse.down();
    await presenter.mouse.move(a.x + 120, a.y + 30, { steps: 5 });
    await presenter.mouse.up();
    const count = (page: typeof viewer) => page.locator('collab-whiteboard .item').count();
    await expect.poll(() => count(viewer), { timeout: 30000 }).toBe(5);
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#clearDrawings').click();
    await expect.poll(() => count(viewer), { timeout: 30000 }).toBe(4);
    await expect.poll(() => count(presenter)).toBe(4);
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#clear').click();
    await expect.poll(() => count(viewer), { timeout: 30000 }).toBe(0);
  });

  it('lets anybody change an element until its owner locks it', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);
    const box = (await presenter.locator('#stage').boundingBox())!;
    const noteAt = async (page: typeof viewer) =>
      page.evaluate(() => {
        const g = document
          .querySelector('collab-whiteboard')!
          .shadowRoot!.querySelector('.note-item rect.paper')!;
        const r = g.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });

    // The presenter's note, with a bigger text from its bar.
    await presenter.keyboard.press('6');
    await presenter.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await presenter.keyboard.press('Control+Enter');
    await presenter
      .locator('collab-whiteboard .selbar button[aria-label="Text note: large"]')
      .click();
    await expect
      .poll(() => viewer.locator('collab-whiteboard .note-item text').getAttribute('font-size'), {
        timeout: 30000,
      })
      .toBe('18');

    // Unlocked: the viewer drags it.
    const before = await noteAt(viewer);
    await viewer.mouse.move(before.x, before.y + 20);
    await viewer.mouse.down();
    await viewer.mouse.move(before.x + 80, before.y + 60, { steps: 5 });
    await viewer.mouse.up();
    await expect
      .poll(async () => (await noteAt(presenter)).x - (await noteAt(viewer)).x, { timeout: 15000 })
      .toBeCloseTo(0, -1);
    const moved = await noteAt(viewer);
    expect(moved.x).toBeGreaterThan(before.x + 50);

    // The presenter locks it for the others; the viewer's drag does nothing, and says why.
    await presenter.locator('collab-whiteboard .selbar button[aria-label^="Unlocked"]').click();
    await expect
      .poll(() => viewer.locator('collab-whiteboard .note-item .lock').count(), { timeout: 30000 })
      .toBe(1);
    await viewer.mouse.move(moved.x, moved.y + 20);
    await viewer.mouse.down();
    await viewer.mouse.move(moved.x + 80, moved.y + 60, { steps: 5 });
    await viewer.mouse.up();
    expect(Math.abs((await noteAt(viewer)).x - moved.x)).toBeLessThan(3);
    // The presenter, its owner, still can (1 only confirms the pointer the note put in hand).
    await presenter.keyboard.press('1');
    const p = await noteAt(presenter);
    await presenter.mouse.move(p.x, p.y + 20);
    await presenter.mouse.down();
    await presenter.mouse.move(p.x - 60, p.y + 20, { steps: 5 });
    await presenter.mouse.up();
    await expect
      .poll(async () => (await noteAt(viewer)).x, { timeout: 15000 })
      .toBeLessThan(moved.x - 40);
  });

  it('moves a pinned file with a plain drag by anybody, and copies it out only with Shift', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);
    await presenter.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['to share'], 'share.txt', { type: 'text/plain' }));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
        }),
      );
    });
    const where = (page: typeof viewer) =>
      page.evaluate(() => {
        const r = document
          .querySelector('collab-whiteboard')!
          .shadowRoot!.querySelector('.image-item image')!
          .getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    await expect
      .poll(() => viewer.locator('collab-whiteboard .image-item').count(), { timeout: 30000 })
      .toBe(1);
    await expect.poll(() => viewer.locator('collab-whiteboard .proxy').count()).toBe(1);

    // The viewer's plain drag moves it, for the presenter too.
    const before = await where(viewer);
    await viewer.mouse.move(before.x, before.y);
    await viewer.mouse.down();
    await viewer.mouse.move(before.x + 70, before.y + 40, { steps: 5 });
    await viewer.mouse.up();
    await expect
      .poll(async () => (await where(presenter)).x - (await where(viewer)).x, { timeout: 15000 })
      .toBeCloseTo(0, -1);
    expect((await where(viewer)).x).toBeGreaterThan(before.x + 40);

    // Shift hands the pointer to the box that the browser drags out: it is the one under the mouse.
    const now = await where(viewer);
    await viewer.keyboard.down('Shift');
    await viewer.mouse.move(now.x + 2, now.y + 2);
    const top = await viewer.evaluate(
      ([x, y]) => {
        const root = document.querySelector('collab-whiteboard')!.shadowRoot!;
        return root.elementsFromPoint(x!, y!)[0]?.className;
      },
      [now.x + 2, now.y + 2],
    );
    await viewer.keyboard.up('Shift');
    expect(top).toBe('proxy');
    await viewer.mouse.move(now.x + 2, now.y + 2);
    const plain = await viewer.evaluate(
      ([x, y]) =>
        document.querySelector('collab-whiteboard')!.shadowRoot!.elementsFromPoint(x!, y!)[0]
          ?.className,
      [now.x + 2, now.y + 2],
    );
    expect(plain).not.toBe('proxy');
  });

  it('resizes an oval note from a grip inside it, and attaches an element dragged by its pin to another', async () => {
    const presenter = await presenterPage();
    await site.startBoard(presenter);
    const box = (await presenter.locator('#stage').boundingBox())!;
    const at = (fx: number, fy: number) => ({
      x: box.x + box.width * fx,
      y: box.y + box.height * fy,
    });
    const rect = (selector: string) =>
      presenter.evaluate((sel) => {
        const r = document
          .querySelector('collab-whiteboard')!
          .shadowRoot!.querySelector(sel)!
          .getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, selector);

    // An oval note (key 6 pressed three times: square, rounded, oval).
    for (let i = 0; i < 3; i++) {
      await presenter.keyboard.press('6');
    }
    const first = at(0.3, 0.45);
    await presenter.mouse.click(first.x, first.y);
    await presenter.keyboard.press('Control+Enter');
    const before = await rect('.note-item:nth-child(1) ellipse.paper');
    // Its grip is inside the ellipse, and pulling it makes the note bigger.
    const grip = await rect('.note-item .grip circle');
    expect(grip.x + grip.w / 2).toBeLessThan(before.x + before.w); // not at the corner of the box
    expect(grip.y + grip.h / 2).toBeLessThan(before.y + before.h);
    await presenter.mouse.move(grip.x + grip.w / 2, grip.y + grip.h / 2);
    await presenter.mouse.down();
    await presenter.mouse.move(grip.x + grip.w / 2 + 60, grip.y + grip.h / 2 + 40, { steps: 5 });
    await presenter.mouse.up();
    const after = await rect('.note-item:nth-child(1) ellipse.paper');
    expect(after.w).toBeGreaterThan(before.w + 40);
    // The note is still selected (the click did not fall outside the shape).
    expect(await presenter.locator('collab-whiteboard .selbar').isVisible()).toBe(true);

    // A second, small note; dragged by its pin onto the first, it is attached and goes with it.
    await presenter.keyboard.press('6');
    const second = at(0.6, 0.2);
    await presenter.mouse.click(second.x, second.y);
    await presenter.keyboard.press('Control+Enter');
    await presenter.keyboard.press('1');
    const notes = presenter.locator('collab-whiteboard .note-item');
    expect(await notes.count()).toBe(2);
    const pinOf = (index: number) =>
      presenter.evaluate((i) => {
        const notes = document
          .querySelector('collab-whiteboard')!
          .shadowRoot!.querySelectorAll('.note-item');
        const r = notes[i]!.querySelector('.pin circle')!.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, index);
    await presenter.keyboard.press('Escape'); // nothing selected: no bar over the pin
    const pin = await pinOf(1);
    const target = await rect('.note-item:nth-child(1) ellipse.paper');
    await presenter.mouse.move(pin.x, pin.y);
    await presenter.mouse.down();
    await presenter.mouse.move(target.x + target.w / 2, target.y + target.h / 2, { steps: 8 });
    await presenter.mouse.up();
    // The attached note is drawn after (on top of) the one it is on.
    const order = await presenter.evaluate(() =>
      [
        ...document
          .querySelector('collab-whiteboard')!
          .shadowRoot!.querySelectorAll('.items > .item'),
      ].map((n) => n.getAttribute('data-id')),
    );
    expect(order).toHaveLength(2);
    const small = await rect('.note-item:nth-child(2) .paper');
    const there = { x: small.x, y: small.y };
    // Moving the big one moves the small one with it.
    const big = await rect('.note-item:nth-child(1) ellipse.paper');
    await presenter.mouse.move(big.x + big.w * 0.2, big.y + big.h * 0.5);
    await presenter.mouse.down();
    await presenter.mouse.move(big.x + big.w * 0.2 + 70, big.y + big.h * 0.5 + 30, { steps: 5 });
    await presenter.mouse.up();
    await expect
      .poll(async () => (await rect('.note-item:nth-child(2) .paper')).x - there.x)
      .toBeCloseTo(70, -1);
  });

  it('selects, moves and erases a sticker from anywhere in its square, not only its strokes', async () => {
    const presenter = await presenterPage();
    await site.startBoard(presenter);
    const box = (await presenter.locator('#stage').boundingBox())!;
    const sticker = () =>
      presenter.evaluate(() => {
        const node = document
          .querySelector('collab-whiteboard')!
          .shadowRoot!.querySelector('.sticker-item use');
        const r = node?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      });
    // A blank spot inside the square: the corner of the check mark, where nothing is drawn.
    const blank = async () => {
      const r = (await sticker())!;
      return { x: r.x + r.w * 0.12, y: r.y + r.h * 0.12 };
    };

    await presenter.keyboard.press('4');
    await presenter.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect.poll(sticker).not.toBeNull();

    // The pointer tool selects it and drags it from the blank spot.
    await presenter.keyboard.press('1');
    const from = await blank();
    const before = (await sticker())!;
    await presenter.mouse.move(from.x, from.y);
    await presenter.mouse.down();
    await presenter.mouse.move(from.x + 60, from.y + 30, { steps: 5 });
    await presenter.mouse.up();
    await expect.poll(async () => (await sticker())!.x - before.x).toBeCloseTo(60, -1);
    expect(await presenter.locator('collab-whiteboard .selbar').isVisible()).toBe(true);

    // The eraser takes it from the blank spot too.
    await presenter.keyboard.press('5');
    const at = await blank();
    await presenter.mouse.click(at.x, at.y);
    await expect.poll(sticker).toBeNull();
  });

  it('selects several items by dragging over them, moves them together, copies and pastes them', async () => {
    const presenter = await presenterPage();
    await site.startBoard(presenter);
    const box = (await presenter.locator('#stage').boundingBox())!;
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    const stickers = () =>
      presenter.evaluate(() =>
        [
          ...document
            .querySelector('collab-whiteboard')!
            .shadowRoot!.querySelectorAll('.sticker-item use'),
        ].map((n) => {
          const r = n.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      );
    await presenter.keyboard.press('4');
    await presenter.mouse.click(...at(0.3, 0.5));
    await presenter.mouse.click(...at(0.5, 0.5));
    await presenter.mouse.click(...at(0.5, 0.8)); // left out of the sweep
    await expect.poll(async () => (await stickers()).length).toBe(3);
    const before = await stickers();

    // From an empty place, over the first two.
    await presenter.keyboard.press('1');
    await presenter.mouse.move(...at(0.15, 0.5));
    await presenter.mouse.down();
    await presenter.mouse.move(...at(0.65, 0.5), { steps: 6 });
    await presenter.mouse.up();
    const bar = presenter.locator('collab-whiteboard .selbar');
    await expect.poll(() => bar.textContent()).toContain('2 selected');

    // Dragging one moves both.
    await presenter.mouse.move(before[0]!.x, before[0]!.y);
    await presenter.mouse.down();
    await presenter.mouse.move(before[0]!.x + 40, before[0]!.y - 50, { steps: 5 });
    await presenter.mouse.up();
    // (Moved items are drawn last: the order changes.)
    const where = (list: { x: number; y: number }[]) =>
      list.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`).sort();
    const moved = where([
      { x: before[0]!.x + 40, y: before[0]!.y - 50 },
      { x: before[1]!.x + 40, y: before[1]!.y - 50 },
      before[2]!,
    ]);
    await expect.poll(async () => where(await stickers())).toEqual(moved);
    expect(await bar.textContent()).toContain('2 selected');

    // Copied and pasted where the pointer is, the copies are selected.
    await presenter.keyboard.press('ControlOrMeta+C');
    await presenter.mouse.move(...at(0.75, 0.3), { steps: 3 });
    await presenter.keyboard.press('ControlOrMeta+V');
    await expect.poll(async () => (await stickers()).length).toBe(5);
    expect(await bar.textContent()).toContain('2 selected');
    await presenter.keyboard.press('Delete');
    await expect.poll(async () => (await stickers()).length).toBe(3);
  });

  it('hides the pointer when asked, and remembers the settings', async () => {
    const presenter = await presenterPage();
    await configure(presenter, 'never');
    await expect.poll(() => presenter.locator('#summary').textContent()).toMatch(/Pat.*hidden/);
    await presenter.locator('#startSession').click();
    await presenter.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await shareScreen(presenter);
    const asked = await presenter.evaluate(
      () => (window as unknown as { asked: { video: { cursor?: string } } }).asked,
    );
    expect(asked.video.cursor).toBe('never');
    // Stored: a reload shows them again (the page asks first: it ends the session).
    presenter.once('dialog', (d) => void d.accept());
    await presenter.reload();
    await expect.poll(() => presenter.locator('#summary').textContent()).toMatch(/Pat.*hidden/);
  });

  it('asks before closing, keeps a backup of the board and offers to resume it', async () => {
    const presenter = await presenterPage();
    await site.startBoard(presenter);
    await draw(presenter, [200, 200]);
    await draw(presenter, [200, 320]);
    expect(await items(presenter)).toBe(2);
    const backedUp = () =>
      presenter
        .evaluate(async () => {
          try {
            const dir = await navigator.storage.getDirectory();
            const file = await (await dir.getFileHandle('board-backup.inksplat.zip')).getFile();
            return [...new Uint8Array(await file.arrayBuffer())];
          } catch {
            return [];
          }
        })
        .then(async (bytes) => (await readArchiveManifest(new Uint8Array(bytes)))?.items ?? 0);
    await expect.poll(backedUp, { timeout: 10000 }).toBe(2);

    // Leaving the page ends the session: the browser asks first, and staying keeps it.
    let asked = '';
    presenter.once('dialog', (d) => {
      asked = d.type();
      void d.dismiss();
    });
    await presenter.evaluate(() => void setTimeout(() => location.reload()));
    await expect.poll(() => asked).toBe('beforeunload');
    expect(await presenter.locator('#app').isVisible()).toBe(true);
    presenter.once('dialog', (d) => void d.accept());
    await presenter.reload();

    // The next session offers the backup; Resume brings the board back.
    await presenter.locator('#startSession').click();
    await presenter.locator('#resume').waitFor({ state: 'visible', timeout: 30000 });
    expect(await presenter.locator('#resumeText').textContent()).toMatch(/2 items/);
    await presenter.keyboard.press('Escape'); // it must be answered
    expect(await presenter.locator('#resume').isVisible()).toBe(true);
    await presenter.locator('#resumeYes').click();
    await expect.poll(() => items(presenter), { timeout: 10000 }).toBe(2);

    // Ending keeps the backup; Start new on the next session empties it.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#end').click();
    await presenter.locator('#again').click();
    await presenter.locator('#startSession').click();
    await presenter.locator('#resume').waitFor({ state: 'visible', timeout: 30000 });
    await presenter.locator('#resumeNo').click();
    expect(await items(presenter)).toBe(0);
    await expect.poll(backedUp, { timeout: 10000 }).toBe(0);
  });

  it('applies video settings to a running share', async () => {
    const presenter = await presenterPage();
    await startSharing(presenter);
    await presenter.locator('#settingsLive').click();
    await presenter.locator('#tab-video').click();
    await presenter.locator('#fps').fill('5');
    await presenter.locator('#settingsForm button[type=submit]').click();
    await expect.poll(() => presenter.locator('#toast').textContent()).toMatch(/Saved/);
    await presenter.locator('#settingsLive').click();
    await presenter.locator('#tab-video').click();
    expect(await presenter.locator('#fps').inputValue()).toBe('5');
  });

  it('folds the controls and the tools away so they do not hide the view', async () => {
    const presenter = await presenterPage();
    await startSharing(presenter);
    const toolbar = presenter.locator('collab-whiteboard .toolbar');
    await expect.poll(() => toolbar.isVisible()).toBe(true);
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(true);

    await presenter.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(false);
    await presenter.locator('#panelToggle').click();
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(false);

    // Remembered across a reload (the next session starts folded).
    presenter.once('dialog', (d) => void d.accept());
    await presenter.reload();
    await presenter.locator('#startSession').click();
    await presenter.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(false);
    await expect.poll(() => toolbar.isVisible()).toBe(false);

    // Back again.
    await presenter.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(true);
  });

  it('keeps long names inside the controls, with no sideways scroll', async () => {
    const presenter = await presenterPage();
    const link = await startSharing(presenter);
    const long = 'WWWWWWWWWW Featherstonehaugh-Worthington'.slice(0, 40);
    await joinViewer(link, long);
    await expect
      .poll(() => presenter.locator('#people').textContent(), { timeout: 30000 })
      .toBe('1 viewer');
    const panel = presenter.locator('#panel');
    await expect.poll(() => panel.locator('#viewers li').textContent()).toContain(long);
    // The full name is in the tooltip; the row is cut with an ellipsis.
    expect(await panel.locator('#viewers li .text').getAttribute('title')).toBe(long);
    const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await presenter.locator('#panelClose').click();
    await expect.poll(() => panel.isVisible()).toBe(false);
    expect(await presenter.locator('#panelToggle').getAttribute('aria-expanded')).toBe('false');
    await presenter.locator('#panelToggle').click();
    await expect.poll(() => panel.isVisible()).toBe(true);
  });

  it('lays the settings out in tabs that fit without scrolling', async () => {
    const presenter = await presenterPage();
    await presenter.setViewportSize({ width: 1280, height: 720 });
    await presenter.locator('#openSettings').click();
    const overflow = () =>
      presenter.locator('#settings').evaluate((d) => d.scrollHeight - d.clientHeight);
    for (const tab of ['general', 'video', 'connection']) {
      await presenter.locator(`#tab-${tab}`).click();
      await expect.poll(() => presenter.locator(`#pane-${tab}`).isVisible()).toBe(true);
      expect(await overflow(), tab).toBeLessThanOrEqual(0);
    }
    // Only the chosen section shows, and the arrow keys move between them.
    expect(await presenter.locator('#pane-general').isVisible()).toBe(false);
    await presenter.locator('#tab-connection').focus();
    await presenter.keyboard.press('ArrowRight');
    await expect.poll(() => presenter.locator('#pane-general').isVisible()).toBe(true);
    // Reopening starts on the first section; a phone-sized window still fits.
    await presenter.locator('#closeSettings').click();
    await presenter.setViewportSize({ width: 390, height: 700 });
    await presenter.locator('#openSettings').click();
    await expect.poll(() => presenter.locator('#pane-general').isVisible()).toBe(true);
    await presenter.locator('#tab-video').click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  it('warns when a whole screen is shared', async () => {
    const presenter = await presenterPage('monitor');
    await startSharing(presenter);
    await expect.poll(() => presenter.locator('#warning').textContent()).toMatch(/whole screen/);
  });

  it('shows why when sharing is refused', async () => {
    const ctx = await site.context();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = () =>
        Promise.reject(new DOMException('no', 'NotAllowedError'));
    });
    await page.goto(`${site.origin}/present.html`);
    await site.startSession(page);
    await page.locator('#share').click();
    await page.locator('#shareNotice button[value=continue]').click();
    await expect.poll(() => page.locator('#toast').textContent()).toMatch(/cancelled/);
    expect(await page.locator('#share').textContent()).toBe('Share screen');
    expect(await page.locator('#streams li').count()).toBe(1); // None alone
  });
});
