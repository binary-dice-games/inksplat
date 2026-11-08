# 08_remote_support - a desktop app for remote user support

Builds on `spec/01_core_features/DESIGN.md` (star session, invite links, board units, `wb`
channel with `laser` and `emote`), `spec/06_static_presenter/DESIGN.md` (the presenter page,
`ShareHost`, settings) and `spec/07_participant_streaming/DESIGN.md` (a guest's uplink, the
`screen` channel, `Stage.screen`). Where this document and those disagree, this one wins for
support sessions only; ordinary sessions do not change.

## 1. Purpose and scope

A way to help someone with their computer from a distance. The **helper** runs inksplat as
today (the presenter page, the host of the session; "the server" in the original request). The
**person helped** installs a small desktop app, **inksplat Support**, built with Electron. In a
support session:

- The helper starts a **support session** on the presenter page and sends its link.
- The person helped opens the link. It opens the app, which asks once "Let Ana see your
  screen?" and then shares the **whole screen** with the helper.
- The helper sees that screen and guides with the **pointer, laser (trails and pings) and
  emotes**. The app draws them on a transparent, click-through, full-screen **overlay** on the
  person's own screen, so they see where to click right where they would click.
- The app does nothing else: no toolbar, no drawing, no board, no chat, no files.

Design goals, in order: **simple for an inexperienced person** (one click on a link, one
"Allow", one "Stop" button, plain words, big text); **safe** (nothing is shared before that
"Allow", sharing is always visible and stops with one click, the helper can only show, never
act); **no server** (the same trackers, sealed offers and WebRTC as every inksplat session).

Out of scope: remote control (mouse or keyboard from the helper), audio and voice (people use a
phone call), file transfer, chat, unattended access (the app never runs or listens without a
link opened by the person), more than one person helped per session, the person helped seeing
the helper's screen, phones and tablets as the helped side, persistent drawings on the overlay
(open question 2).

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Helper** | The person giving support; the host of the session, on `present.html`. |
| **Person helped** | The person receiving support; the only guest, in the app. |
| **Support session** | A session started with **Start a support session**: one guest at most, pointer tools only, the guest's screen shown at once. |
| **Support link** | `<site>/support.html#inksplat=<token>[&tr=...]`: a landing page that opens the app. |
| **App** | inksplat Support, the Electron program on the person helped's computer. |
| **Overlay** | The app's transparent, always-on-top, click-through window over the shared display. |
| **Control window** | The app's small window: status, the helper's name, **Stop**. |

## 3. User experience

### 3.1 Helper (presenter page)

The start page gets a second action next to **Start session**: **Start a support session**
(same name, colour and Settings). Then:

1. The page shows the support link, **Copy link** and **QR code**, and a short text to paste in
   an email or chat ("Click this link to let me see your screen. The first time it asks you to
   install inksplat Support."). The status reads *Waiting for the person to connect*.
2. When the app joins, the status reads *Connected: Bob*, then *Bob is deciding*, then shows
   the screen. The person's screen is the active stream at once (no Preview / Show step: in a
   support session the intent is clear), on canvas 1 with background `screen`.
3. The toolbar has only the pointer, with its modes cursor, laser and emote (magnify stays: it
   is local to the helper). The canvas buttons, Clear, Open, the Screen list and the share
   button are hidden. **End session** ends it for both.
4. If the person stops sharing, the status reads *Bob stopped sharing* with no automatic retry;
   the person can share again from the app (**Share again**).

A support session admits **one guest**: once the app has joined, the host locks the room
(`session.lock`) so a forwarded link lets nobody else in, and **New link** is hidden. If that
guest leaves, the room unlocks so the app can reconnect with the same link (section 5.4).

### 3.2 Person helped (landing page and app)

**Landing page** (`support.html`, on the Pages site, no install needed to read it):

- One big button **Open inksplat Support**. It navigates to
  `inksplat-support://join#<the link's fragment>`; the browser asks "Open inksplat Support?"
  the first time.
- Below, **Don't have it yet?** with one download button for the visitor's system (detected
  from the user agent; links to the other systems under it) and three numbered steps with
  pictures: download, install, come back here and press the button again.
- The page never joins the session itself and never asks for screen sharing; it holds the token
  only in its fragment, like every inksplat link.

**App, first run on macOS:** the system needs the *Screen Recording* permission. The app
explains it in one screen with a picture of the System Settings switch, an **Open System
Settings** button, and **I turned it on** (which restarts the app with the same link, as macOS
requires). Windows and Linux X11 need nothing. Linux Wayland shows the system's own screen
picker (xdg portal); the app says so before it appears.

**App, every session:**

1. Opened by the link, the control window shows *Connecting to the helper...*, then the
   consent screen: the helper's name, colour and avatar, "**Ana** wants to see your screen to
   help you. Ana will see everything on your screen, but cannot click or type." and two big
   buttons, **Allow** and **Don't allow**. Nothing is captured before **Allow**.
2. After **Allow**: the overlay appears with a thin coloured border around the shared display
   (the "you are being seen" sign) and the control window shrinks to a small always-on-top bar
   in a corner: "Ana can see your screen" and **Stop**. The bar can be dragged, never closed
   without stopping.
3. The helper's cursor (an arrow with their name, as on the board), laser trails, pings and
   emotes appear on the overlay. Clicks and keys go to the person's own programs, never to the
   overlay.
4. **Stop** (or closing the bar, or the helper ending) stops capture, removes the overlay and
   shows "Sharing stopped" with **Share again** (while still connected) and **Close**. Closing
   quits the app; it does not stay in the tray or start with the system.

Text is short and large (at least 16 px), every action is a button with a word on it, and the
app follows the system's language when a translation exists (English first; open question 5).

### 3.3 Several displays

The app shares **one display**: the one the control window is on when **Allow** is pressed
(normally the primary). With more than one display, the bar has **Show my other screen**, which
moves the capture, the overlay and the bar to the next display. The helper is told
(`Stage.screen` changes size), and the drawings, which are transient, simply start over there.

## 4. Architecture

```
 Helper's browser (present.html, host)          Person helped's computer (Electron app, guest)
┌──────────────────────────────────────┐       ┌────────────────────────────────────────────┐
│ ShareHost (mode: support)            │       │ main process                               │
│  session (host), whiteboard          │◄──────┤  protocol handler, windows, displays,      │
│  screen background = guest's stream  │ WebRTC│  setDisplayMediaRequestHandler, consent    │
│  tools: pointer (cursor/laser/emote) │ uplink│                                            │
│                                      │ + wb  │ session window (hidden renderer)           │
│                                      ├──────►│  collab-session (guest), setUplink(stream) │
└──────────────────────────────────────┘ cur,  │      │ wb messages (MessagePort)           │
                                         laser,│ overlay window (per shared display)         │
                                         emote │  collab-whiteboard: readOnly, no toolbar,   │
                                               │  transparent, click-through, part of the    │
                                               │  capture (the helper sees it in the video)  │
                                               │ control window: consent, status, Stop       │
                                               └────────────────────────────────────────────┘
```

Key decisions (the *why*):

- **The app is an ordinary guest.** It uses the same `collab-session` and `packages/defaults`
  (bundled, not loaded from the site), the same trackers and sealed offers, and the same
  protocol id. The host needs no new transport: the app's screen travels on the guest uplink of
  `spec/07` section 4.1, and the cursor, laser and emotes are the `wb` messages every viewer
  already receives. Nothing in the session package changes.
- **Capture through `getDisplayMedia` with Electron's handler, not a picker.** The session
  window calls `navigator.mediaDevices.getDisplayMedia` as the share button does; the main
  process answers it with `session.setDisplayMediaRequestHandler`, giving the
  `desktopCapturer` source of the chosen display (`screen:<id>`). So the stream is a normal
  display capture (frame rate and size limits through `uplinkParams` from the host, as for any
  guest), and the person sees the app's consent screen instead of Chromium's picker. The
  handler refuses any request that does not come from the session window after **Allow**.
- **The overlay reuses the whiteboard.** The overlay window runs `collab-whiteboard` with
  `readOnly: true, toolbar: false, pages: false, toolHints: false, turns: false` on a
  transparent page, fed by a session proxy (`spec/01` section 3, `SessionProxy`) over a
  `MessagePort` from the session window. The board already draws remote cursors, laser trails,
  pings and emotes in board units; the overlay only maps the frame to the whole display. No
  second renderer for laser or emotes is written, and they look the same as on the board.
- **The marks are drawn only on the person's screen; the helper sees them in the video.**
  The overlay is an ordinary window, so the capture includes it, and the helper's board does
  not draw the laser, pings or emotes itself. Each mark is drawn in one place and seen once,
  with no capture exclusion (which Linux lacks and macOS 15+ is reported to ignore) and no
  per-system behaviour, and the helper sees exactly what the person sees. The cost is the
  video's delay on the helper's side. Section 4.2.
- **The overlay never takes input.** `setIgnoreMouseEvents(true)` (no forwarding),
  `focusable: false`, `skipTaskbar`, always on top at the `screen-saver` level, one per shared
  display, sized to the display's bounds (not its work area: the taskbar is shared too). The
  whiteboard in it is read only and the app's own cursor is never sent (the person's real
  cursor is in the video).
- **Frame = the shared display.** Board units are relative to the frame (`spec/01` section
  4.2). In a support session the frame's aspect is the **display's** aspect (from the `screen`
  offer's `w`/`h`), not the fixed 16:9 of `spec/07` section 3.5, so on the helper's board the
  video fills the frame and on the overlay the frame is exactly the display: a laser drawn on a
  button lands on that button. A display change (3.3, or a resolution change) changes
  `Stage.aspect`; the transient drawings of the moment are dropped.
- **Three windows, one session.** The session lives in a hidden renderer that survives the
  overlay being recreated on a display change and keeps WebRTC out of the overlay's
  click-through, always-on-top window. The main process holds no session state.

### 4.1 Electron security

- Every renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, a strict CSP (`script-src 'self'`; `connect-src` the trackers' `wss:`
  hosts only), no remote content (all pages are bundled files loaded from the app), navigation
  and `window.open` refused.
- Preloads expose a few typed calls through `contextBridge` (section 6.2); no Node API reaches
  a renderer.
- The protocol URL is parsed in the main process with `parseInvite` (`packages/defaults`): only
  `inksplat-support://join#inksplat=<22-char token>[&tr=wss://...]` is accepted, anything else
  shows "This link does not work" and does nothing. The token is never logged.
- A single instance (`requestSingleInstanceLock`): a second link while a session runs asks
  "End the current session and connect to the new one?".
- Electron fuses: `RunAsNode` off, `EnableNodeCliInspectArguments` off,
  `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on.

### 4.2 The marks, drawn once

The marks are the helper's cursor arrow, laser trails, pings and emotes (all transient, `wb`
messages never stored). In a support session:

- The **overlay** draws them on the person's screen as soon as they arrive.
- The **capture** includes the overlay like any other window, so they are in the video.
- The **helper's board** sends them but does not draw them. The helper sees them in the video,
  one video delay late (about 100-300 ms plus a frame). The helper's own mouse pointer is the
  instant feedback while they move.

The coloured border and the bar are in the video too; the border sits on the edge and the bar
in a corner, and the helper sees what the person sees.

**What the helper's board needs.** The whiteboard (a nymph copy) gets an option to send marks
without drawing them: `localMarks?: boolean` (default true), recorded in the file's header as
an inksplat change. The presenter page passes `localMarks: false` in a support session. Remote
marks and everything stored are unaffected.

**Frame rate.** The laser trail is only as smooth as the video, so the host raises the guest's
frame rate to at least 10 fps (within the settings' limits) while marks are on screen, and
back to the support default (open question 6) a second after the last one.

## 5. Protocol

No new channel and no change to the session protocol id. What a support session adds:

### 5.1 Stage

`Stage` (`packages/defaults`) gets `mode?: 'support'` (absent: an ordinary session). In a
support session the host sends `mode: 'support'`, `drawing: false`, `backgrounds` with
`screen` on canvas 1, `aspect` = the guest's display aspect once its offer arrives (16:9
before), and `screen` = the guest's stream. `cleanStage` accepts `mode` only as `'support'`.

### 5.2 The app's hello

The app joins with its name (the computer's user name by default, editable on the consent
screen; open question 4) and announces itself on the `screen` channel after **Allow** with the
existing `{cmd: 'offer', surface: 'monitor', w, h}` (`spec/07` section 5.1). `w` and `h` are
the display's size in physical pixels. A new optional field `client: 'support'` lets the host
show "inksplat Support 1.2.0" in the log and refuse an app older than it supports
(`cleanScreenMessage` accepts it, version in `v`, a semver string of at most 16 characters).
The app sends the offer again when the display changes.

Before **Allow** the app is connected but offers nothing; the host shows *Bob is deciding*
from the roster (a peer without an offer). **Don't allow** leaves the session.

### 5.3 Host rules in support mode

`ShareHost` with `mode: 'support'`:

- The first guest's `offer` becomes the active stream at once (`setRelay(owner)`, uplink
  `active: true`), with the host's video settings; there is no preview. The stage's aspect
  follows that offer.
- A second guest is refused: the room is locked after the first joins (3.1). If one gets in
  through a race (two joins at once), the host removes the later one.
- `wb` from the guest: the guest is locked to pointer-only (the existing lock, `spec/01`
  section 4.3), so a forged client cannot add anything; the app sends no cursor or ops, only
  what the whiteboard needs to join. The host's whiteboard is restricted to the pointer tool
  (`tools: ['pointer']`).
- Canvas: the host stays on canvas 1; canvas commands are not offered.
- Marks: the host's whiteboard has `localMarks: false`, and the host raises the guest's frame
  rate while marks are shown (4.2).

### 5.4 Reconnecting

A dropped link (sleep, Wi-Fi change) ends the guest; the room unlocks and the app, still
holding the link, rejoins on its own for 2 minutes (backoff 1, 2, 4, 8, then every 15 s), with
*Reconnecting...* in the bar and the capture kept (paused on the uplink by the host until it is
the active stream again). Consent is not asked again within those 2 minutes; after them the app
shows "The connection was lost" with **Try again** (asks for consent again) and **Close**.

## 6. Components

### 6.1 In the existing site

| Piece | Where | Change |
|---|---|---|
| Stage, `screen` messages | `packages/defaults/src/index.ts` | `Stage.mode`, `client`/`v` in `offer`, `SUPPORT_SCHEME = 'inksplat-support'`, `supportLink(base, fragment, extra)` |
| `ShareHost` | `viewer/src/share-host.ts` | `mode: 'support'`: one guest, auto-active, aspect from the offer, `wb` from guests dropped |
| Whiteboard | `packages/collab-whiteboard/collab-whiteboard.js`/`.d.ts` (nymph copy) | `localMarks` option (4.2); header records the change |
| Presenter page | `viewer/src/present.ts`/`.html` | **Start a support session**, support status line, restricted toolbar, hidden canvas and stream controls, the text to paste |
| Landing page | `viewer/src/support.html`, `viewer/src/support.ts` | Open button, downloads per system, steps with pictures |
| Site build | `scripts/build-site.mjs` | `support.html`, its pictures |

### 6.2 The app (`support-app/`)

A new top-level folder, its own npm workspace (so `electron` and `electron-builder` stay out of
the site's dependencies), TypeScript built with esbuild like the viewer.

| Piece | Where | Responsibility |
|---|---|---|
| Main | `support-app/src/main/main.ts` | Single instance, protocol registration (`setAsDefaultProtocolClient`, `open-url` on macOS, `argv` on Windows/Linux), windows, fuses check, quit rules |
| Link | `support-app/src/main/link.ts` | Pure: protocol URL to `Invite` or a refusal reason |
| Displays | `support-app/src/main/displays.ts` | Pure-ish: which display to share, its bounds and scale, the next display, the `desktopCapturer` source id for a display (`display_id`) |
| Capture | `support-app/src/main/capture.ts` | `setDisplayMediaRequestHandler` gated by consent; macOS permission state (`systemPreferences.getMediaAccessStatus('screen')`) |
| Overlay windows | `support-app/src/main/overlay.ts` | Create, place, protect from capture, recreate on display change |
| Session renderer | `support-app/src/session/` | `createSession` (guest), `setUplink`, `screen` offer, stage, reconnect, the whiteboard proxy over a `MessagePort` |
| Overlay renderer | `support-app/src/overlay/` | Whiteboard read only on a transparent page, border, frame = display |
| Control renderer | `support-app/src/control/` | Connecting, consent, macOS permission help, bar, stopped, errors |
| Preloads | `support-app/src/preload/*.ts` | `support.onState`, `support.allow()`, `support.deny()`, `support.stop()`, `support.nextDisplay()`, `support.openScreenSettings()`; port hand-over |
| Strings | `support-app/src/strings.ts` | All texts, one table per language |
| Packaging | `support-app/electron-builder.yml` | Installers, protocol, signing, update feed |

The app's version is its own (`support-app/package.json`, semver); it records the
`packages/defaults` `PROTOCOL` it was built with and refuses a host with another one with
"Please update inksplat Support" and a download button.

### 6.3 Packaging, signing and updates

| System | Installer | Notes |
|---|---|---|
| Windows 10 2004+ / 11 | NSIS, per user, no admin rights, x64 and arm64 | Registers the protocol in HKCU; Authenticode signed so SmartScreen does not scare the person |
| macOS 12+ | DMG, universal | Developer ID signed and notarized; `NSScreenCaptureUsageDescription` set |
| Linux | AppImage and `.deb`, x64 | `.desktop` file with `x-scheme-handler/inksplat-support` |

Updates: `electron-updater` from the project's GitHub Releases, checked when the app starts and
applied on the next start (never in the middle of a session). Releases come from a workflow on
tags `support-v*` (CI builds the app on the three systems on every push but publishes only on a
tag). The landing page links to `releases/latest/download/<fixed file name>` so it needs no
change per release.

## 7. Security and privacy

- **Consent before capture, every session.** Opening a link only connects. The screen is
  captured after **Allow** on a screen that names the helper, and the request handler refuses
  any capture before it. The OS adds its own indicator where it has one (macOS menu bar).
- **Always visible, always stoppable.** The border and the bar are on screen for as long as the
  capture runs; **Stop** is one click; closing the bar stops; quitting the app stops.
- **Show, never act.** The app has no code path that injects input, reads files or runs
  commands; the helper's messages reach only a read-only whiteboard. The only data the app
  sends is the video and the session's own control messages.
- **No resident software.** No tray icon, no autostart, no open port, no background service;
  the protocol handler starts the app only when the person opens a link.
- **The link is the permission**, as everywhere in inksplat: whoever holds a support link can
  ask to see the screen, but still needs the person's **Allow** and is named on that screen.
  Support links lock to one guest; the helper sends them to one person.
- What the helper sees includes notifications and anything on that display; the consent text
  says "everything on your screen". Other displays are not captured.
- Trackers see the topic hash and IPs only; media and data are DTLS/SRTP encrypted end to end
  between the two computers.
- The app keeps nothing between sessions except the name it last used and the language.

## 8. Risks and open questions

Risks (each checked by the spike, plan step 1):

1. **Marks delay.** The helper sees their own laser and emotes only after the video's delay
   (4.2). On a slow link this can feel sluggish; the helper's mouse pointer stays instant, and
   the raised frame rate keeps trails readable. If it proves too slow by hand, a later version
   can draw a local laser on the helper's board only where the overlay can be left out of the
   capture (not planned).
2. **Wayland.** `desktopCapturer` goes through the xdg portal, which always shows the system
   picker, and overlays cannot be placed or kept on top reliably on every compositor. Wayland
   is supported best effort; X11 is the tested Linux path.
3. **macOS permission flow.** Screen Recording needs a restart after it is granted; the
   restart must keep the link (passed in the relaunch arguments).
4. **Signing costs** (Apple Developer ID, a Windows code signing certificate) and their secrets
   in CI. Unsigned builds work for testing but frighten the target users.
5. **Protocol drift.** The app bundles `collab-session`; a site update that bumps `PROTOCOL`
   breaks old apps until they update. The updater and the "Please update" message cover it.

Open questions (default in brackets, used unless decided otherwise):

1. Should the helper be able to point while the person's screen is not yet shared (on a black
   canvas)? [no: nothing to point at]
2. Should the helper have a pen whose lines stay until cleared (circling a button), besides the
   laser? [no for the first version: laser trails and pings; easy to add later as `pen` with a
   Clear button, the overlay already draws strokes]
3. Remote control later? [not planned; it would need a separate design and stronger consent]
4. The name the app uses: the computer's user name or asked each time? [the user name,
   editable on the consent screen, remembered]
5. Languages for the first version. [English and Spanish]
6. Should the helper's video settings default lower for support (screens are mostly still
   text)? [yes: content hint `text`, 5 fps, size limit 1920 on the long side; 10 fps while
   marks are shown]
