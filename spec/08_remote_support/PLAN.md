# 08_remote_support - plan

Design: `spec/08_remote_support/DESIGN.md`. Follow the steps in order; update this plan before
diverging from it and record each step's result when done.

## 1. Spike: Electron capture, overlay and exclusion

**Goal:** settle the risks of DESIGN section 8 before product code: a guest in Electron shares
a display through `getDisplayMedia` answered by `setDisplayMediaRequestHandler`; a
transparent, click-through, always-on-top overlay window draws over it; the overlay is (or is
not) excluded from the capture on Windows, macOS 14, macOS 15+ and Linux X11/Wayland.
**Deliverables:** `support-app/` workspace skeleton (Electron pinned, esbuild build, one main
file, one page) kept as the base of step 3; a results note appended here: exclusion per system,
the source id mapping from `screen.Display` to `desktopCapturer`, the macOS permission and
relaunch path, Wayland behaviour. If exclusion fails where it matters, update DESIGN section 8
risk 1 with the chosen mitigation before step 2.
**Tests:** a Playwright `_electron` test (`tests/e2e/support-spike.test.ts`, `PROJECT e2e`,
Linux under Xvfb in CI): the app starts, captures a display without a picker, and the overlay
window exists, is transparent and ignores mouse events. Exclusion is checked by hand and
recorded.
**Result:** _pending_

## 2. Data model and host support mode

**Goal:** the site side of DESIGN sections 3.1 and 5 without the app (a test guest plays it).
**Deliverables:** `packages/defaults`: `Stage.mode`, `client`/`v` in the `screen` offer,
`SUPPORT_SCHEME`, `supportLink`; `ShareHost` `mode: 'support'` (lock after the first guest,
auto-active offer, aspect from the offer, guest locked to pointer-only, unlock on leave); TSDoc.
**Tests:** `tests/unit/defaults.test.ts` (stage `mode` cleaning, offer with `client`/`v`,
`supportLink`); `tests/unit/share-host.test.ts` (support mode: first offer active, aspect,
second guest refused or removed, guest drawing refused, unlock and rejoin).
**Result:** _pending_

## 3. Presenter page support mode and landing page

**Goal:** the helper's UI (DESIGN 3.1) and `support.html` (DESIGN 3.2).
**Deliverables:** **Start a support session** on the start page; status line; toolbar with the
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
**Deliverables:** overlay window per shared display (click-through, on top, capture
protection), session proxy over a `MessagePort`, read-only whiteboard with frame = display,
border; recreated on **Show my other screen** and on display changes.
**Tests:** e2e in `tests/e2e/support-app.test.ts`: the helper's `ping`/laser/emote at a board
point appears in the overlay's DOM at the matching display position (within 2 px after
scaling); the overlay ignores mouse events; switching display moves the overlay and changes the
stage aspect. Unit: frame-to-display mapping with scale factors.
**Result:** _pending_

## 6. Packaging, CI and release

**Goal:** installers for Windows, macOS and Linux, built in CI, published on a tag, with
updates (DESIGN 6.3).
**Deliverables:** `support-app/electron-builder.yml`; CMake target `support-app` (build) and
`support-package` (installers); CI job building and running the app's tests on the three
systems; `.github/workflows/support-release.yml` on `support-v*` tags with signing secrets
(skipped with a warning when absent); `electron-updater` wired; landing page links to the fixed
release file names.
**Tests:** CI green on the three systems; a release dry run on a test tag produces the five
installers; `tests/unit/support-build.test.ts` checks the builder config (protocol, fuses,
file names that the landing page links to).
**Result:** _pending_

## 7. Docs and manual checks

**Goal:** the feature documented and checked on real machines.
**Deliverables:** `docs/support-app.md` (build, run, package, sign; README "Further
Documentation" row); README overview line and layout row for `support-app/`;
`docs/using-the-board.md` support section; `docs/manual-testing.md` items (each system, two
displays, sleep and Wi-Fi change, macOS permission first run, Wayland, exclusion); tutorial
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
- Only one person can join a support session; ordinary sessions are unchanged.
- All tests above pass in CI on Linux, macOS and Windows; the manual checklist is done on the
  three systems.
