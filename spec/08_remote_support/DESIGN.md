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
2. When the app joins, the status reads *Connected: Bob*, then *Bob is deciding* with the
   **safety code** in large digits and "Read this code to Bob" (section 7.3 R5), then shows
   the screen. The person's screen is the active stream at once (no Preview / Show step: in a
   support session the intent is clear), on canvas 1 with background `screen`.
3. The toolbar has only the pointer, with its modes cursor, laser and emote (magnify stays: it
   is local to the helper). The canvas buttons, Clear, Open, the Screen list and the share
   button are hidden. **End session** ends it for both.
4. If the person stops sharing, the app leaves the session and the status reads *Bob stopped
   sharing or lost the connection* with no automatic retry; the person can share again from the
   app (**Share again**), which reconnects and asks again.

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

1. Opened by the link, the control window shows *Connecting to the helper...* (with the
   person's name, which they can change there), then for 3 seconds the explanation in large
   text: who wants to see the screen, the safety code, and the warning. Then the consent: a
   **native dialog** of the system (section 7.3 R9) over the control window. It says: "Someone
   who says they are **Ana** wants to see your screen. Ana will see everything on this screen,
   but cannot click or type. Ana should read you this code: **482 913**. Only allow someone
   you contacted yourself or know well. Banks, Microsoft, Apple and the police never ask for
   this." Buttons **Don't allow** (the default, also Enter and Escape) and **Allow**. A native
   dialog cannot hold a button disabled, so an **Allow** pressed less than a second after the
   dialog appeared is taken for a reflex and the dialog asks again. The helper's page shows the
   same code (the safety code, 7.3 R5). Nothing is captured before **Allow**.
2. After **Allow**: the overlay appears with a thin coloured border around the shared display
   (the "you are being seen" sign) and the control window shrinks to a small always-on-top bar
   in a corner: "Ana can see your screen" and **Stop**. The bar can be dragged, never closed
   without stopping.
3. The helper's cursor (an arrow with their name, as on the board), laser trails, pings and
   emotes appear on the overlay. Clicks and keys go to the person's own programs, never to the
   overlay.
4. **Stop** (or closing the bar, or the helper ending) stops capture, removes the overlay,
   leaves the session (the main process destroys the session window, so nothing can go on
   capturing) and shows "Sharing stopped" with **Share again** (reconnects with the same link
   and asks again) and **Close**. Closing quits the app; it does not stay in the tray or start
   with the system.
5. Locking the screen or putting the computer to sleep stops sharing too. After 60 minutes the
   bar asks "Keep sharing with Ana?" (**Keep sharing** / **Stop**) and stops by itself if no one
   answers within 60 seconds.

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
  already receives. The session package only gains an optional sender parameter (4.3), a fixed
  host certificate and the fingerprints of each link (5.4).
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

Section 7 explains what each of these defends against.

- Every renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, a strict CSP (`script-src 'self'`; `connect-src` the trackers' `wss:`
  hosts only), no remote content (all pages are bundled files loaded from the app), navigation
  and `window.open` refused.
- Preloads expose a few typed calls through `contextBridge` (section 6.2); no Node API reaches
  a renderer. Every IPC handler checks the sender (`event.senderFrame` is the expected window's
  bundled page) and validates its arguments; renderers can ask to stop, never to start.
- Consent is a native dialog owned by the main process; the main process's state machine alone
  lets `setDisplayMediaRequestHandler` answer (only the session window, video only, the chosen
  display, once per Allow or display switch). `setPermissionRequestHandler` grants only the
  `media` permission that capture asks for, to the session page, during that grant, without
  audio; `setPermissionCheckHandler` refuses everything. If the bar or the overlay closes,
  crashes or hides, the main process stops: it tells the session page to stop capturing and
  leave (so the helper sees it go at once) and destroys the session window 250 ms later
  whatever the page does. A bar dragged off its display is moved back.
- The session renderer passes to the overlay only an allowlist of validated `wb` marks (cursor,
  laser, ping, emote).
- A development run (not packaged, as in the tests) does not refuse debugging switches (the
  test driver needs them) and lets the session page connect to a loopback tracker; a packaged
  app does neither.
- The protocol is registered with a `--` separator and the app reads only the argument after
  it (at most 2 KB). The URL is parsed in the main process with `parseInvite`
  (`packages/defaults`): only
  `inksplat-support://join#inksplat=<22-char token>[&tr=wss://...]` is accepted, anything else
  shows "This link does not work" and does nothing. The token is never logged.
- A single instance (`requestSingleInstanceLock`): a second link while a session runs asks
  "End the current session and connect to the new one?".
- Electron fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments` and `GrantFileProtocolExtraPrivileges` off;
  `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` on. The app quits at start
  when it finds `--remote-debugging-port`, `--inspect` or other debugging switches.
- macOS: hardened runtime, library validation on, no `disable-library-validation` or
  `allow-dyld-environment-variables` entitlement.
- No telemetry, `crashReporter` off, logs in memory only and without the token or safety code.
- An app more than 6 months past its build date refuses to connect and asks to be updated.

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

The laser trail is only as smooth as the video, which is why a support session uses a high
frame rate (4.3).

### 4.3 Video: one viewer, high frame rate

Ordinary sessions keep a low frame rate (`spec/03`, at most 15 fps) because the host sends to
up to ten viewers. A support session has **one stream to one viewer**: the person's uplink to
the helper, nothing relayed, nothing sent back (the owner of the active stream never gets its
own stream, `spec/07` section 3.6). So it can afford a fluid video, which makes the helper's
view of the cursor, the laser (4.2) and the person's own pointer feel live.

Support sessions have their own video settings (`SUPPORT_VIDEO` in `packages/defaults`, kept
apart from the ordinary ones in the presenter page's settings, `supportVideo`):

| Setting | Support default | Support range | Ordinary (for comparison) |
|---|---|---|---|
| Frame rate | 30 fps | 15-30 fps (presets 15, 20, 30) | 0.5-15, default 3 |
| Bitrate cap | 4000 kbit/s | 500-8000 | 100-8000, default 1500 |
| Size limit | 1920 on the long side | 1280 up to the screen's own | up to 3840x2160 |
| Content hint | `text` | as today | `detail` |

They reach the person's encoder through `uplinkParams` as for any guest (`spec/07` section
4.4), and the capture is asked for the same frame rate (`frameRate` in the request the
display handler answers). The sender uses `degradationPreference: 'balanced'`: on a slow link
the encoder lowers both rate and resolution a little rather than freezing text or dropping to
a few frames per second. (`UplinkParams` gains an optional `degradationPreference`, the only
change to `collab-session` for this project, recorded in its header; absent, as today.) The helper can change them in **Settings > Video** during the session;
they apply at once.

Cost on the person's computer: one encode of one display at up to 30 fps. The codec is the
first of `FORWARD_CODECS` the person's machine encodes in hardware (`viewer/src/codec-choice.ts`
logic, run in the app), so an older laptop encodes H.264 on its media engine instead of AV1 in
software. The size limit of 1920 keeps a 4K screen's encode affordable; the helper can raise it
when small text is hard to read.

## 5. Protocol

No new channel and no change to the session protocol id. What a support session adds:

### 5.1 Stage

`Stage` (`packages/defaults`) gets `mode?: 'support'` (absent: an ordinary session). In a
support session the host sends `mode: 'support'`, `drawing: false`, `backgrounds` with
`screen` on canvas 1, `aspect` = the guest's display aspect once its offer arrives (16:9
before), and `screen` = the guest's stream. `cleanStage` accepts `mode` only as `'support'`.

### 5.2 The app's hello

The app joins with its name (the computer's user name by default, editable in the control
window while connecting; open question 4) and announces itself on the `screen` channel after **Allow** with the
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
holding the link, rejoins on its own for 2 minutes (the session's own reconnect), with
*Reconnecting...* in the bar and the capture kept but taken off the uplink by the session page
until the main process has checked the host. Consent is not asked again within those 2 minutes **only if the host
is the same**: the host uses one DTLS certificate for the whole session (a new optional
`certificates` session option, passed to every `RTCPeerConnection`), the app pins the
fingerprint it consented to, and a reconnect to any other fingerprint asks again (with a new
safety code). A screen lock or sleep in between ends consent anyway (section 7, I8). After the
2 minutes the app stops and shows "The connection was lost" with **Share again** (asks for
consent again) and **Close**.

The safety code (7.3 R5) is the first 32 bits of SHA-256 over the two fingerprints of the link
(sorted, so both sides agree), modulo one million, as six decimal digits (`safetyCode` in
`packages/defaults`); the helper's page shows it next to the person's name.

## 6. Components

### 6.1 In the existing site

| Piece | Where | Change |
|---|---|---|
| Stage, `screen` messages | `packages/defaults/src/index.ts` | `Stage.mode`, `client`/`v` in `offer`, `SUPPORT_SCHEME = 'inksplat-support'`, `supportLink(base, fragment, extra)`, `SUPPORT_VIDEO` limits and defaults, `cleanSupportVideo` |
| `ShareHost` | `viewer/src/share-host.ts` | `mode: 'support'`: one guest, auto-active, aspect from the offer, `wb` from guests dropped |
| Whiteboard | `packages/collab-whiteboard/collab-whiteboard.js`/`.d.ts` (nymph copy) | `localMarks` option (4.2); header records the change |
| Session | `packages/collab-session/collab-session.js`/`.d.ts` (nymph copy) | Optional `degradationPreference` in `UplinkParams` (4.3); optional `certificates` session option and the link's DTLS fingerprints exposed per peer (5.4, 7.3 R5); header records the changes |
| Presenter settings | `viewer/src/present-settings.ts` | `supportVideo`, shown in **Settings > Video** during a support session |
| Presenter page | `viewer/src/present.ts`/`.html` | **Start a support session**, support status line, safety code, restricted toolbar, hidden canvas and stream controls, the text to paste |
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
| Consent | `support-app/src/main/consent.ts` | The state machine of section 7.1 (idle, asking, consented, stopped), the native dialog, the 3-second delay, the drive-by limit, the 60-minute check, lock and sleep, the pinned fingerprint |
| Capture | `support-app/src/main/capture.ts` | `setDisplayMediaRequestHandler` gated by consent; macOS permission state (`systemPreferences.getMediaAccessStatus('screen')`) |
| Overlay windows | `support-app/src/main/overlay.ts` | Create, place, protect from capture, recreate on display change |
| Session renderer | `support-app/src/session/` | `createSession` (guest), `setUplink`, `screen` offer, stage, reconnect, the whiteboard proxy over a `MessagePort` |
| Overlay renderer | `support-app/src/overlay/` | Whiteboard read only on a transparent page, border, frame = display |
| Control renderer | `support-app/src/control/` | Connecting, consent, macOS permission help, bar, stopped, errors |
| Preloads | `support-app/src/preload/*.ts` | `support.onState`, `support.allow()`, `support.deny()`, `support.stop()`, `support.nextDisplay()`, `support.openScreenSettings()`; port hand-over |
| Strings | `support-app/src/strings.ts` | All texts, one table per language |
| Packaging | `support-app/electron-builder.json` | Installers, protocol, signing, update feed |

The app's version is its own (`support-app/package.json`, semver); it records the
`packages/defaults` `PROTOCOL` it was built with and refuses a host with another one with
"Please update inksplat Support" and a download button.

### 6.3 Packaging, signing and updates

| System | Installer | Notes |
|---|---|---|
| Windows 10 2004+ / 11 | NSIS, per user, no admin rights, x64 and arm64 | Registers the protocol in HKCU; Authenticode signed so SmartScreen does not scare the person |
| macOS 12+ | DMG, universal | Developer ID signed and notarized; `NSScreenCaptureUsageDescription` set |
| Linux | `.deb` (offered first) and AppImage, x64 | `.desktop` file with `x-scheme-handler/inksplat-support`; the `.deb` installs Chromium's sandbox helper, which an AppImage cannot use on Ubuntu 24.04 and later (and the app refuses `--no-sandbox`) |

Updates (Windows and macOS; Linux builds do not update themselves, 7.3 R11): `electron-updater`
from the project's GitHub Releases, checked when the app starts and
applied on the next start (never in the middle of a session), and only when the new build is
signed by the same publisher (section 7.3 R11). Signing keys live in a protected GitHub
environment that needs a second maintainer's approval. Releases come from a workflow on
tags `support-v*` (CI builds the app on the three systems on every push but publishes only on a
tag). The landing page links to `releases/latest/download/<fixed file name>` so it needs no
change per release.

## 7. Security: threat model and risk analysis

The app can see a whole screen. The worst outcome is that it becomes a way to **watch someone
who does not know, or no longer wants, to be watched**. This section lists what must never
happen, who might try, and how the design stops them. Section 4.1 holds the Electron settings
it relies on.

### 7.1 Invariants

These hold whatever the helper, the network or a web page does. Each has a test (7.5).

| # | Invariant |
|---|---|
| I1 | **No capture without consent** given by the person, in this app process, to this host (7.3 R9: the decision is a native dialog the renderers cannot click). |
| I2 | **No capture without the signs:** while the capture runs, the bar and the border are on screen. If either window closes, crashes or hides, or the overlay is not up within 5 seconds, the main process destroys the session window, which ends the capture; a bar dragged off its display is moved back. |
| I3 | **Stop always works:** one click, local, offline, whatever the session's state. |
| I4 | **The helper cannot change what is captured:** no message starts, resumes or widens a capture (other display, audio, camera, a window); only the person's clicks do. |
| I5 | **Show, never act:** no code path injects input, reads or writes the person's files, runs programs or opens URLs other than the fixed download page. |
| I6 | **Nothing resident:** no autostart, tray icon, service or listening port; the app runs only while the person has it open from a link. |
| I7 | **Only the signed app's own code runs:** no remote content, no debugging or Node entry points (fuses, section 4.1). |
| I8 | **Consent does not outlive its moment:** it ends on Stop, quit, screen lock, sleep, 60 minutes without confirmation (3.2), and a different host (5.4). |

### 7.2 Assets and attackers

Assets: what is on the person's screen; the person's computer (the app as a foothold, or its
macOS *Screen Recording* permission); the person's IP address.

| Attacker | Can |
|---|---|
| A. A scammer acting as helper | Talk the person into installing and allowing; host a support session; send marks |
| B. Anyone who holds the link (leaked, forwarded) | Host a room with the same token (the room key derives from the token alone, `collab-session`), so pose as the helper |
| C. Any web page | Open `inksplat-support://` links with its own token, again and again |
| D. The network, trackers | See IPs and topic hashes; drop or delay traffic |
| E. Another program on the person's computer | Start the app with chosen arguments and environment, modify user-writable files |
| F. Whoever controls the build or release (stolen account, malicious dependency) | Ship an app update to every installed copy |

Out of scope: an attacker with administrator or root rights on the person's computer (it can
capture the screen without the app); a helper the person knowingly lets watch (seeing the
screen is the feature); bugs in the operating system's capture.

### 7.3 Risks

Likelihood and impact before mitigation: L(ow), M(edium), H(igh), C(ritical).

**R1. Tech support scam** (A; likelihood H, impact H). The most common real abuse of support
tools: a stranger calls, claims to be the bank or Microsoft, and has the person install and
allow, then watches them sign in to their bank.
*Mitigations:* view only, with no remote control, so the scam's usual endgame (installing
software, moving money) needs the person's own hands; the consent dialog and the landing page
say "Only allow someone you contacted yourself or know well. Banks, Microsoft, Apple and the
police never ask for this."; the helper's name is shown as untrusted text ("says they are
**Ana**"), at most 24 plain characters, with no avatar or picture on the consent; the border,
the bar and Stop stay; the 60-minute confirmation.
*Residual:* a person who is convinced still shows their screen. Inherent to any screen
sharing; the warnings are the defence.

**R2. The helper disguises or hides the signs** (A; M, M). Marks could cover the bar, or the
cursor label could say "Type your password here".
*Mitigations:* the session renderer passes to the overlay only an allowlist of `wb` messages
(cursor position, laser points, pings, emotes from the fixed set), validated, and drops
everything else, so no text, picture, note or link reaches the overlay; the cursor label is the
helper's name, at most 24 characters; the bar sits above the overlay (higher always-on-top
level) and the overlay never covers it; the border is drawn by the app, not by the helper.
*Residual:* a 24-character name is still words on the screen.

**R3. The helper widens or extends the capture** (A; L, H). Another display, sound, the camera,
capturing again after Stop.
*Mitigations:* I4: the display media handler answers only the session window, only in the
*consented* state, video only (audio refused), always the display the person chose;
**Show my other screen** and **Share again** come only from the person's clicks in the bar
(IPC checked, 4.1); every other permission (camera, microphone, notifications, location, ...)
is refused by `setPermissionRequestHandler`/`setPermissionCheckHandler`; Stop is local (I3).
*Residual:* none known.

**R4. A forgotten session** (A; M, H). The person walks away or forgets; the helper keeps
watching for hours.
*Mitigations:* I8: screen lock and sleep (`powerMonitor` `lock-screen`, `suspend`) stop the
capture and ask again; after 60 minutes the bar asks "Keep sharing with Ana?" and stops if no
one answers within 60 seconds; the reconnect window (5.4) never spans a lock or sleep.
*Residual:* an unattended, unlocked computer is watched for up to 61 minutes.

**R5. Someone else poses as the helper** (B; L-M, H). A leaked or forwarded link lets an
attacker host the same room, or sit between the two (each leg is a valid room member).
*Mitigations:* a **safety code**: both sides show six digits derived from the two DTLS
certificate fingerprints of the link (SHA-256 of both, sorted); the helper reads them on the
phone and the consent dialog says "Ana should read you this code: 482 913. Do not allow if it
is different."; someone in the middle has different fingerprints on each leg, so the codes
differ. Support links lock to one guest, expire with the existing link lifetime (60 minutes by
default) and die when the helper ends the session. Reconnects go only to the same host (5.4).
*Residual:* a person who skips the code check.

**R6. Drive-by launches** (C; M, H). A page opens the app with its own token, again and again,
hoping for a reflex click on Allow.
*Mitigations:* the browser asks before opening the app; consent is always needed (I1);
the control window explains for 3 seconds before the dialog appears; **Don't allow** is the
default button, and an **Allow** less than a second after the dialog appeared is a reflex the
dialog asks again; a link that arrives while a consent dialog is open is ignored with a notice; after three
**Don't allow** in 10 minutes the app ignores links for 10 minutes and says so.
*Residual:* a person who allows a stranger anyway (R1).

**R7. The network** (D; L, L-M). Trackers see topic hashes and IPs; offers are sealed with the
room key; media and data are DTLS-SRTP encrypted end to end. The helper learns the person's IP
(a direct WebRTC link), which tells roughly where they are.
*Mitigations:* documented. Relayed-only paths (`iceTransportPolicy: 'relay'` with a TURN
server) are not built yet (open question 9).
*Residual:* the IP is visible to the helper by default.

**R8. A message exploits the app** (A, B; L, C). A crafted `wb`, `stage` or `screen` message, or
SDP, hits a bug in the whiteboard, the session code or Chromium, runs code, and captures
silently or stays installed.
*Mitigations:* the overlay gets only allowlisted, validated marks (R2) and its whiteboard is
read only; every renderer is sandboxed with context isolation, no Node and a CSP without
inline scripts or `eval`; no remote content; the main process trusts no renderer (4.1, R9);
Electron stays on a supported major and a release follows each Chromium security fix within
two weeks; an app more than 6 months past its build date refuses to connect ("Please update").
*Residual:* a Chromium zero-day with a sandbox escape. Shared with every browser.

**R9. A compromised renderer grants itself consent** (A, B after R8; L, C).
*Mitigations:* consent is a **native dialog** shown by the main process
(`dialog.showMessageBox`, modal to the control window), so no renderer can click it; the
control window only explains around it. The main process's state machine alone decides
whether the display handler answers; IPC handlers check the sender (`event.senderFrame` is the
expected window's bundled page) and validate every argument; a renderer can only ask to stop
or to move to the next display, and the latter needs a native confirmation too.
*Residual:* a main-process bug.

**R10. Protocol handler argument injection** (C, E; L, C). On Windows a crafted
`inksplat-support:` URL has carried extra command-line switches into Electron apps before
(e.g. a GPU launcher switch that runs a program).
*Mitigations:* the protocol is registered with a `--` separator so the URL is never parsed as
switches; the app reads only the one argument after `--`, at most 2 KB, through the strict
parser (4.1); it quits at start if it finds debugging or unknown Chromium switches.
*Residual:* none known.

**R11. A malicious update** (F; L, C). Whoever can publish a release can turn every installed
app into spyware. The highest-impact risk.
*Mitigations:* the updater installs only builds signed by the same publisher (Authenticode
publisher check on Windows, the Developer ID requirement of Squirrel.Mac on macOS); Linux
builds do not update themselves (an AppImage update carries no signature the updater checks),
and ask to be downloaded again when they are too old; signing keys live in a
protected GitHub environment that needs a second maintainer's approval, releases come only
from protected `support-v*` tags on the default branch, and the organisation requires 2FA;
updates apply on the next start, never during a session; CI runs the invariant tests (7.5) on
every build, so an accidental removal fails; release notes list every change to `support-app/`.
*Residual:* a maintainer who deliberately ships spyware with a second maintainer's approval.

**R12. Malicious dependencies** (F; L, C). *Mitigations:* the app's runtime dependencies are
Electron, `electron-updater` and the repository's own packages; `package-lock.json` with
integrity hashes, `npm ci`, dependency changes reviewed, the app's bundle built from the lock
only. *Residual:* a compromised Electron release.

**R13. A look-alike app** (scammers; M, H). Spyware called "inksplat Support" spread by
phishing. *Mitigations:* the landing page downloads only from this repository's GitHub
Releases; installers are signed by Binary Dice Games and the docs say how to check;
*Residual:* cannot be prevented, only made recognisable.

**R14. Another program borrows the app's permission** (E; M on macOS, C). A program runs the
signed app with `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect` or
`--remote-debugging-port`, or swaps its code or loads a library into it, and so captures with
the app's *Screen Recording* permission without asking. A known weakness of Electron apps on
macOS.
*Mitigations:* fuses (4.1) turn off run-as-Node, `NODE_OPTIONS`, the inspect switches and
file-protocol privileges, and turn on asar integrity and app-from-asar only; the app quits at
start on `--remote-debugging-port` or other debugging switches; macOS hardened runtime with
library validation on (no `disable-library-validation`, no `allow-dyld-environment-variables`
entitlement), installed in `/Applications`; CI reads the fuses of each packaged build and
fails if one is wrong. On Windows and Linux there is no permission to borrow (any program of
the user can capture already), but the same fuses apply.
*Residual:* an attacker who can already change system files.

**R15. Data left behind** (any; L, M). *Mitigations:* no telemetry, no crash report uploads
(`crashReporter` off), no screenshots or recordings, logs only in memory and without the token
or the safety code; the app keeps only the person's name and language. The update check sends
only what GitHub sees for any download.

### 7.4 Accepted risks

- A person who is convinced by a scammer (R1) or skips the safety code (R5) shows their screen.
- The helper learns the person's IP unless relayed paths are configured (R7).
- An unattended unlocked screen is visible for up to 61 minutes (R4).
- A Chromium zero-day with a sandbox escape (R8) or a deliberate malicious release approved by
  two maintainers (R11).

### 7.5 Verification

- **Invariant tests** (Playwright `_electron`, every CI build): no capture before the native
  consent (I1); closing, hiding or crashing the bar or the overlay ends the capture (I2); Stop
  with the network down ends it (I3); host messages asking for audio, another display or a new
  capture change nothing (I4); lock and suspend events end consent (I8); a different host
  fingerprint asks again (5.4).
- **Packaging checks:** fuses of each packaged build; entitlements and hardened runtime on
  macOS; the protocol registration carries `--`.
- **Input tests:** the link parser and the `wb` allowlist with malformed and oversized input
  (property tests); IPC handlers refuse calls from the wrong window.
- **Review before the first release:** Electron's security checklist item by item, a static
  scan of the app (for example Electronegativity), and this section re-read against the code;
  results recorded in `PLAN.md`. An external review before wide use is open question 8.

## 8. Risks and open questions

Risks (each checked by the spike, plan step 1):

1. **Marks delay.** The helper sees their own laser and emotes only after the video's delay
   (4.2). On a slow link this can feel sluggish; the helper's mouse pointer stays instant, and
   the high frame rate (4.3) keeps trails smooth. If it proves too slow by hand, a later version
   can draw a local laser on the helper's board only where the overlay can be left out of the
   capture (not planned).
2. **Encoding load.** 30 fps on an old computer without a hardware encoder may cost a lot of
   CPU. The encoder lowers its rate under load (`balanced`); the spike measures CPU on a modest
   machine, and the support default drops to 15 fps if 30 is too heavy.
3. **Wayland.** `desktopCapturer` goes through the xdg portal, which always shows the system
   picker, and overlays cannot be placed or kept on top reliably on every compositor. Wayland
   is supported best effort; X11 is the tested Linux path.
4. **macOS permission flow.** Screen Recording needs a restart after it is granted; the
   restart must keep the link (passed in the relaunch arguments).
5. **Signing costs** (Apple Developer ID, a Windows code signing certificate) and their secrets
   in CI. Unsigned builds work for testing but frighten the target users.
6. **Protocol drift.** The app bundles `collab-session`; a site update that bumps `PROTOCOL`
   breaks old apps until they update. The updater and the "Please update" message cover it.

Open questions (default in brackets, used unless decided otherwise):

1. Should the helper be able to point while the person's screen is not yet shared (on a black
   canvas)? [no: nothing to point at]
2. Should the helper have a pen whose lines stay until cleared (circling a button), besides the
   laser? [no for the first version: laser trails and pings; easy to add later as `pen` with a
   Clear button, the overlay already draws strokes]
3. Remote control later? [not planned; it would need a separate design and stronger consent]
4. The name the app uses: the computer's user name or asked each time? [the user name,
   editable in the control window while connecting, remembered]
5. Languages for the first version. [English and Spanish]
6. Support video defaults (4.3). [30 fps, 4000 kbit/s, 1920 on the long side, content hint
   `text`]
8. An external security review before the app is offered widely? [yes, before the first
   public release; the internal review of 7.5 before any release]
9. Relayed-only connections for the app when a TURN server is configured, to hide the person's
   IP from the helper? [wanted as a helper setting, off by default; not built in the first
   version]
10. Should the safety code be required (the person types it) rather than read and compared?
    [no: typing is hard for the target users; comparing is the default]
