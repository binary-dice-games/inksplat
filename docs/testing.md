# inksplat — Testing

How to test inksplat: the automated suites, how the browser tests work, how to
try the presenter page by hand, and what is not covered. For the checklist on
real networks and the real picker see [manual-testing.md](manual-testing.md);
for setting up the toolchain see [building.md](building.md).

## In five minutes

```
cmake -S . -B build                       # installs npm dependencies the first time
cmake --build build --target check        # lint, typecheck, format
ctest --test-dir build -C Debug --output-on-failure --parallel
```

All the tests should pass in about a minute. (`-C Debug` is needed for the
Visual Studio and Xcode generators and harmless elsewhere.) If they do, the
core, the viewer and the presenter page all work on your machine.

## What each test covers

Unit tests run in Node, with no browser. They use an in-memory network instead
of WebRTC.

| ctest name | File | What it checks |
|---|---|---|
| `session` | `tests/unit/session.test.ts` | Room tokens, sealing, message framing; a host with guests: roster, relaying, targeted messages, lock, remove, protocol refusal |
| `whiteboard_model` | `tests/unit/whiteboard-model.test.ts` | Drawings converge in any order; undo, clear, limits, validation; frame geometry; the drawing gate and rate limit |
| `whiteboard_dom` | `tests/unit/whiteboard-dom.test.ts` | The whiteboard in a simulated DOM: emoticon stickers, read-only mode, the frame adapter, a load reaching the host's board |
| `defaults` | `tests/unit/defaults.test.ts` | Video settings, the `stage` message, invite links |
| `settings` | `tests/unit/settings.test.ts` | Validation of the presenter settings and of the text form of the server lists |
| `present_settings` | `tests/unit/present-settings.test.ts` | The presenter page's saved choices: pointer mode, folding |
| `display_capture` | `tests/unit/display-capture.test.ts` | The size reduction for the encoder and the whole-screen warning |
| `share_host` | `tests/unit/share-host.test.ts` | The presenter's side: links, stage messages, drawing lock, removal, the streams on offer (preview, show, none, withdrawal), and that viewers cannot command or impersonate the host |
| `relay` | `tests/unit/relay.test.ts` | The host's forwarding of encoded frames: every output but the source's, key frame gating, continuous timestamps, key frame requests |
| `share_button` | `tests/unit/share-button.test.ts` | The share button: what the owner of a stream is told, the one-time notice, hidden without a picker |
| `viewer_model` | `tests/unit/viewer-model.test.ts` | The viewer's messages and decisions that need no page |
| `site_build` | `tests/unit/site-build.test.ts` | The Pages site: both pages at the root and under `/v2/` (the protocol major), bundle sizes, the 404 page, the tutorial and its pictures, the smoke check |

Browser tests drive real Chrome with real WebRTC over a local fake tracker.

| ctest name | File | What it checks |
|---|---|---|
| `webrtc` | `tests/e2e/webrtc.test.ts` | Video and board over real WebRTC; trackers that drop big announces; codec preference; nothing secret in the tracker traffic or the logs |
| `site` | `tests/e2e/site.test.ts` | The site served like GitHub Pages: viewer at `/` and `/v2/`, a 404 that keeps an invite, the privacy page, the tutorial (linked from home, no broken pictures) |
| `present` | `tests/e2e/present.test.ts` | The presenter page: starting a session, sharing a (fake) screen, video to a viewer, drawing both ways, None, a lost source, end, the whole-screen warning, the pointer option, settings, folding |
| `streams` | `tests/e2e/streams.test.ts` | Guests' uplinks and the host's relay over real WebRTC, forwarded and re-encoded: switching sources, a late joiner, nothing sent before the host asks |
| `participant_streaming` | `tests/e2e/participant-streaming.test.ts` | The built site: viewers and the presenter offer screens, the presenter previews, shows, switches and shows none |
| `relay_spike` | `tests/e2e/relay-spike.test.ts` | The browser behaviour the relay relies on: encoded frames written into another peer connection's senders |
| `viewer` | `tests/e2e/viewer.test.ts` | The viewer app with the presenter page as host: drawings land at the same place of the frame in windows of different shapes, accessibility (axe-core), who is here, touch on a phone-sized screen, joining with a code, removal, folding the tools |

## Running parts of the suite

```
ctest --test-dir build -C Debug -R share_host   # one test by name
ctest --test-dir build -C Debug -L e2e          # only browser tests (label: e2e or unit)
npm test                                        # all unit tests, with Vitest directly
npm run test:e2e                                # all browser tests
npx vitest run --project unit tests/unit/share-host.test.ts
npx vitest run --project e2e tests/e2e/viewer.test.ts -t "touch"   # one test by title
npm run check                                   # lint, typecheck, format
```

The browser tests build the site themselves before they start (`buildSite`), so
you do not need to build first.

## What the browser tests need

- **Chrome**. The tests look for it in the usual install places; set
  `INKSPLAT_CHROME` to its path if yours is elsewhere.
- No internet. The tests start their own tracker (`tests/support/fake-tracker.ts`),
  serve the site from a loopback server and turn off STUN. They never touch
  public trackers.

The browser's real picker cannot be driven by automation. The presenter-page
tests replace `getDisplayMedia` with a function that returns a moving canvas
(`tests/support/presenter-site.ts`), as a chosen window would. The real picker is
on the manual checklist.

## Writing tests

The rules (they are also in `CLAUDE.md`):

- Add every test file to `tests/CMakeLists.txt` with `inksplat_add_test(<name> <file>)`,
  and `PROJECT e2e` for browser tests. ctest runs each in its own process, in
  parallel.
- No fixed ports (listen on port 0), no fixed temp directory names, no fixed
  sleeps. Wait for the condition: `until(() => ..., 'what', timeoutMs)` from
  `tests/support/wait.ts`, or `expect.poll` in the browser tests.
- Support code is in `tests/support/`: `fake-tracker.ts`, `browser.ts` (launches
  Chrome), `presenter-site.ts` (the site, a tracker, a presenter page with a fake
  screen, a joined viewer), `rooms.ts` (memory-network sessions), `wait.ts`.

## The tutorial's pictures

The screenshots and animations of the tutorial page (`viewer/src/site/tutorial/`)
are made by driving the built site in Chrome, like the browser tests:

```
npm run tutorial:media                    # all of them (about two minutes)
npm run tutorial:media -- -t "pen"        # only those whose name matches
```

It needs Chrome and ffmpeg. It is not part of the test suite: run it after a
change to the look of the board and commit the files it writes. The script is
`tests/tutorial/tutorial.media.ts`; it draws a visible cursor and the keys held,
which a headless browser does not show.

## Trying it by hand

Do this before a release, and any time you change something automation cannot
see: what the page looks like, real networks, the real picker.

1. **Build and serve the site**

   ```
   npm run build:site
   python -m http.server 8080 --directory site
   ```

   (or `npx serve site -l 8080`). Leave it running.

2. **Present.** Open `http://localhost:8080/present.html` in Chrome, press
   *Start sharing* and choose a tab, a window or a screen. The page shows what you
   share with the whiteboard on top. Draw with the pen.
3. **Join as a viewer.** Copy the viewer link (the *Copy* button) and open it in a
   different Chrome window or profile, so you can see both at once. Enter a name.
   You see the shared picture and your drawing.
4. **Check the things that matter:**
   - the shared surface itself shows nothing extra, and you can still use it;
   - the video follows a moment late, a few frames a second;
   - strokes drawn on the presenter page appear on the viewer at once, and strokes
     drawn by the viewer appear on the presenter page;
   - the video never shows any drawing (draw over a plain page and look closely);
   - on the presenter page: remove the viewer, lock, turn off *Viewers can draw*
     (the viewer's tools go grey), pause, clear, *Share again*, end;
   - *Tools* and *Controls* fold the toolbar and the panel away; the viewer's
     *Tools* does the same.
5. **Then the things only real conditions show**: a phone on mobile data, Firefox
   and Safari, many viewers, closing the laptop lid. Without internet the public
   trackers are not reachable; use *Join codes* (the waiting screen of the viewer,
   and the presenter's controls) to connect anyway.

### If something does not work

| What you see | Likely cause |
|---|---|
| *Start sharing* is disabled and says the browser cannot share | The browser has no screen capture (a phone, or an old browser) |
| "Sharing was cancelled or blocked" | The picker was closed, or the browser or the system refused (on macOS give the browser the Screen Recording permission) |
| The viewer waits for the presenter, then gives up | The network blocks the trackers (use a code), the link is old, or the session is locked |
| The viewer says the presenter did not answer, but everything else looks right | The two sides run different versions of inksplat |
| The presenter page says *Sharing stopped* | You clicked the browser's *Stop sharing*, or the shared window closed; press *Share again* |

Connection logs: the viewer and the presenter page (F12) write `[inksplat]` lines
to the console, one per step. A healthy join reads, on the viewer:
`tracker: connected to ...`, `announce 3 offers`, `answer received from ...`,
`ICE connection: connected`, `data channel open: fast`, `session state: open`.
Where it stops tells you the stage that fails:

| Last line you see | The problem is |
|---|---|
| `tracker: closed ... code 1006`, repeated | The tracker is unreachable (blocked, down or DNS) |
| `announce with 3 offers` and nothing after | The tracker dropped the announce, or nobody is in the room: check that the presenter's log shows `offer received from` |
| presenter: `offer received`, but no `answer sent` | The presenter could not answer: the line says why |
| `answer received`, then `ICE connection: failed` | The two networks cannot reach each other: try another network or a TURN server |
| `link open` but never `session state: open` | The protocol versions differ (the presenter refuses the hello) |

Nothing secret is logged: no link, token, SDP or message contents.
`chrome://webrtc-internals` shows the connections, frame rates and bitrates.

## What is not covered

Be careful with these; nothing tests them automatically:

- The real picker and its permissions, the real sharing bar, "Stop sharing".
- Real window resizing, zoom, and sharing a native application.
- Real networks: public trackers over time, NATs, TURN, corporate proxies.
- Browsers other than Chromium, real phones, screen readers.
- How sharp the video looks on a real display with real encoders: the automated
  tests only measure it in headless Chromium. `spikes/video-quality/` measures a
  text page's sharpness over time (`node spikes/video-quality/run.mjs "name:w=1920&h=1080&..."`).
- Many viewers (the design aims at about 10) and long sessions.
- The Pages workflow: it has not run yet (CI has, on all three systems).
- A viewer on another protocol version only sees "the presenter did not answer".

## Continuous integration

`.github/workflows/ci.yml` runs the same steps on Linux, macOS and Windows:
configure, the viewer build, `check` and the whole ctest suite. The history of
problems found is in [../spec/05_release_pipeline/PLAN.md](../spec/05_release_pipeline/PLAN.md).
