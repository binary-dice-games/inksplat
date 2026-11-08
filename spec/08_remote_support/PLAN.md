# 08_remote_support - plan

Design: `spec/08_remote_support/DESIGN.md`. Follow the steps in order; update this plan before
diverging from it and record each step's result when done.

## 1. Spike: Electron capture and overlay

**Goal:** settle the risks of DESIGN section 8 before product code: a guest in Electron shares
a display through `getDisplayMedia` answered by `setDisplayMediaRequestHandler`; a
transparent, click-through, always-on-top overlay window draws over it and appears in the
capture on Windows, macOS 14, macOS 15+ and Linux X11/Wayland.
**Deliverables:** `support-app/` workspace skeleton (Electron pinned, esbuild build, one main
file, one page) kept as the base of step 3; a results note appended here: the overlay in the
capture per system, the delay of a mark from overlay to the far end's video, the source id
mapping from `screen.Display` to `desktopCapturer`, CPU and frame rate actually sent at 15
and 30 fps on a modest machine (sets the default of DESIGN 4.3), the macOS permission and relaunch path,
Wayland behaviour.
**Tests:** a Playwright `_electron` test (`tests/e2e/support-spike.test.ts`, `PROJECT e2e`,
Linux under Xvfb in CI): the app starts, captures a display without a picker, the overlay
window exists, is transparent and ignores mouse events, and a coloured mark drawn on it is
found in the captured frames. Windows and macOS are checked by hand and recorded.
**Result:** done, by hand in a Linux container (Electron 44.9.3, Xvfb, no compositor); no
separate spike page was kept: the app's own tests (steps 4 to 6) cover what it checked.
`getDisplayMedia` answered by `setDisplayMediaRequestHandler` captures the display with no
picker (`displaySurface: monitor`, 30 fps asked and given); `desktopCapturer`'s `display_id`
matches `screen.Display.id`; a mark drawn on the overlay is in the captured frames. Without a
compositor an X11 transparent window is drawn opaque (black), so the overlay hides the screen:
real Linux desktops have a compositor; this goes on the manual checklist. Playwright's
`_electron` drives Electron 44 (it needs `--no-sandbox` as root and starts Electron with
`--inspect` and `--remote-debugging-port`, so the refusal of those switches applies only to a
packaged app, DESIGN 4.1). Windows, macOS and Wayland were not available here: manual
checklist. CPU at 15 and 30 fps on a modest machine: not measured here (manual checklist).

## 2. Data model and host support mode

**Goal:** the site side of DESIGN sections 3.1 and 5 without the app (a test guest plays it).
**Deliverables:** `packages/defaults`: `Stage.mode`, `client`/`v` in the `screen` offer,
`SUPPORT_SCHEME`, `supportLink`; `ShareHost` `mode: 'support'` (lock after the first guest,
auto-active offer, aspect from the offer, guest locked to pointer-only, unlock on leave,
support video settings (DESIGN 4.3: `SUPPORT_VIDEO`, `cleanSupportVideo`,
`supportVideo` in the presenter settings, sent with `uplinkParams`, which gains
`degradationPreference` in `collab-session`); whiteboard `localMarks` option (header
records the change)); `collab-session`: optional `certificates` option and each link's DTLS
fingerprints (DESIGN 5.4; header records the change); `safetyCode(fingerprints)` in
`packages/defaults`; presenter page passes `localMarks: false`; TSDoc.
**Tests:** `tests/unit/defaults.test.ts` (stage `mode` cleaning, offer with `client`/`v`,
`supportLink`, `cleanSupportVideo` bounds and defaults, `safetyCode` is order-independent and
six digits); `tests/e2e/streams.test.ts` (with `certificates` the host's fingerprint is the
same on every link, and both sides compute the same code);
`tests/unit/present-settings.test.ts` (`supportVideo` kept apart from the ordinary video
settings); `tests/unit/share-host.test.ts` (support mode: first
offer active, aspect, second guest refused or removed, guest drawing refused, unlock and rejoin,
the guest's uplink gets the support video settings); the whiteboard's `localMarks` option (marks are sent but
not drawn locally; remote marks still drawn) in `tests/unit/whiteboard-pointer-modes.test.ts`.
**Result:** done. `safetyCode` uses 32 bits of the hash modulo one million (20 bits do not
fit in six digits; DESIGN 5.4 corrected). In a support session the host does not forward
frames (`forwardFrames: false`): there is no other viewer, so the person's own codec order
decides. The session's certificate test is in `tests/e2e/streams.test.ts`.

## 3. Presenter page support mode and landing page

**Goal:** the helper's UI (DESIGN 3.1) and `support.html` (DESIGN 3.2).
**Deliverables:** **Start a support session** on the start page; status line with the safety
code; toolbar with the
pointer only; hidden canvas buttons, Screen list, share button and **New link**; the text to
paste; `support.html`/`support.ts` (open button, downloads by system, steps); site build and
smoke check include it.
**Tests:** `tests/e2e/present.test.ts` extended (support start, restricted toolbar, a fake guest
offering a canvas stream appears at once and sets the aspect); `tests/unit/support-page.test.ts`
(system detection, the `inksplat-support://` URL built from the hash, a bad hash refused);
`tests/unit/site-build.test.ts` lists `support.html`.
**Result:** _pending_

## 4. App: link, session and capture

**Goal:** the app joins from a protocol link and shares one display after consent (DESIGN 4,
5.2, 5.4, 6.2).
**Deliverables:** main process (single instance, protocol registration, link parsing, capture
handler gated by consent, displays), session renderer (guest, `setUplink`, offer, reconnect),
control renderer (connecting, consent, bar, stopped, errors, macOS permission help), preloads,
strings (English, Spanish), Electron security settings and fuses (DESIGN 4.1).
**Tests:** unit: `tests/unit/support-link.test.ts` (accepted and refused URLs),
`tests/unit/support-displays.test.ts` (choice, next display, source id), reconnect backoff;
e2e `tests/e2e/support-app.test.ts` (Playwright `_electron`, fake tracker, the built
`present.html` as helper): the app connects, nothing is sent before **Allow**, after **Allow**
the helper sees the app's screen, **Stop** blacks it, **Don't allow** leaves, a dropped link
reconnects without asking again.
**Result:** _pending_

## 5. App: overlay

**Goal:** the helper's cursor, laser, pings and emotes appear on the person's screen in the
right place (DESIGN 3.2, 4).
**Deliverables:** overlay window per shared display (click-through, on top, part of the
capture), session proxy over a `MessagePort`, read-only whiteboard with frame = display,
border; recreated on **Show my other screen** and on display changes.
**Tests:** e2e in `tests/e2e/support-app.test.ts`: the helper's `ping`/laser/emote at a board
point appears in the overlay's DOM at the matching display position (within 2 px after
scaling); the overlay ignores mouse events; switching display moves the overlay and changes the
stage aspect; a laser mark drawn on the overlay reaches the helper's video while the
helper's board draws none of its own. Unit: frame-to-display mapping with scale factors.
**Result:** _pending_

## 6. Security hardening and review

**Goal:** the invariants and mitigations of DESIGN section 7 in place and checked, before
anything is packaged for people.
**Deliverables:** `support-app/src/main/consent.ts` (state machine, native dialog, 3-second
delay, drive-by limit, 60-minute check, lock and sleep, pinned fingerprint, safety code in the
dialog); IPC sender checks; permission handlers; the `wb` allowlist; the window watchdog
(I2); start-up refusal of debugging switches; build-date expiry; fuses and macOS entitlements
in the builder config; protocol registration with `--`. A review note appended here: Electron's
security checklist item by item, a static scan of the app, and DESIGN section 7 re-read
against the code, with each finding fixed or recorded as accepted.
**Tests:** `tests/e2e/support-security.test.ts` (Playwright `_electron`): every invariant test
of DESIGN 7.5 (no capture before consent; bar or overlay closed, hidden or crashed ends the
capture; Stop offline; host requests for audio, another display or a new capture change
nothing; lock and suspend end consent; another host fingerprint asks again; three refusals
block links for 10 minutes). Unit: `tests/unit/support-consent.test.ts` (state machine
transitions and timers with a fake clock), `tests/unit/support-allowlist.test.ts` and
`tests/unit/support-link.test.ts` extended with malformed, oversized and switch-injection
input; IPC handlers refuse calls from the wrong window.
**Result:** _pending_

## 7. Packaging, CI and release

**Goal:** installers for Windows, macOS and Linux, built in CI, published on a tag, with
updates (DESIGN 6.3).
**Deliverables:** `support-app/electron-builder.yml`; CMake target `support-app` (build) and
`support-package` (installers); CI job building and running the app's tests on the three
systems; `.github/workflows/support-release.yml` on `support-v*` tags with signing secrets
(skipped with a warning when absent); `electron-updater` wired; landing page links to the fixed
release file names.
**Tests:** CI green on the three systems; a release dry run on a test tag produces the five
installers; a packaging check reads the fuses, the macOS entitlements and hardened runtime and
the protocol registration of each installer and fails on any difference from DESIGN 4.1; the
updater refuses a build signed by another key (test certificate); `tests/unit/support-build.test.ts` checks the builder config (protocol, fuses,
file names that the landing page links to).
**Result:** _pending_

## 8. Docs and manual checks

**Goal:** the feature documented and checked on real machines.
**Deliverables:** `docs/support-app.md` (build, run, package, sign; README "Further
Documentation" row); README overview line and layout row for `support-app/`;
`docs/using-the-board.md` support section; `docs/manual-testing.md` items (each system, two
displays, sleep and Wi-Fi change, macOS permission first run, Wayland, the delay of marks on a slow link); tutorial
page section for the person helped; CHANGELOG; `spec/INDEX.md` status.
**Tests:** the manual checklist on Windows 11, macOS 15 and Ubuntu (X11) at least.
**Result:** _pending_

## Completion Criteria

- A helper starts a support session, sends the link, and a person with no inksplat installed
  gets from the link to a shared screen with: one download and install, one "Open", one
  "Allow" (plus the macOS permission once).
- Nothing is captured before **Allow**; the border and **Stop** are always visible while it is.
- The helper's cursor, laser, pings and emotes appear on the person's screen where the helper
  put them, and never take the person's clicks.
- The helper sees each mark once, in the video; the helper's board draws none of its own.
- Only one person can join a support session; ordinary sessions are unchanged.
- Every invariant of DESIGN section 7.1 has a passing test in CI, the packaging checks pass, and
  the security review of step 6 is recorded with no open finding above low.
- All tests above pass in CI on Linux, macOS and Windows; the manual checklist is done on the
  three systems.
