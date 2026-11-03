# 08_meet_addon - plan

Design: `spec/08_meet_addon/DESIGN.md`. Follow the steps in order; update this plan before
diverging from it and record each step's result when done.

## 1. Spike: the Meet SDK on a real deployment

**Goal:** answer DESIGN section 9 questions 1-4 and 6 before any product code.
**Deliverables:** a throwaway add-on (two static pages on the Pages origin or a test host, a
Google Cloud project, a test deployment of the add-on installed for the developer's account)
that logs: `getDisplayMedia` and `RTCPeerConnection` in the main stage and side panel iframes;
`broadcastStateUpdate` maximum size, rate, echo, ordering, delivery to late subscribers;
`getMeetingInfo` fields; side panel and main stage sizes; behavior when the Meet tab is in the
background. A results note appended to this step, and DESIGN sections 5.2, 7 and 9 updated. If
`getDisplayMedia` is blocked (DESIGN section 7), stop and re-plan with the user.
**Tests:** none automated (needs a real call); the spike page is kept under `tests/support/meet-spike/`
with its checklist in `docs/manual-testing.md`.
**Result:** open.

## 2. Channel rendezvous in `collab-session`

**Goal:** peers link through any `SignalTransport` (DESIGN 5).
**Deliverables:** `ChannelRendezvous` and `kind: 'channel'` in `collab-session.js` (header and
`NOTICE` record the change); `SignalTransport` and the spec in `collab-session.d.ts` with TSDoc;
retry with backoff, owner-only answer application, optional chunking if step 1 requires it.
**Tests:** `tests/unit/channel-rendezvous.test.ts` (in-memory broadcast hub): host and guests
link; late guest; echoed own messages ignored; wrong token and wrong protocol ignored; answers
for other guests ignored; retries stop after linking; status when `send` rejects. Registered with
`inksplat_add_test`.
**Result:** open.

## 3. Meet SDK adapter and fake Meet

**Goal:** `viewer/src/meet/` facade and transport, and the fake used by all later tests.
**Deliverables:** `meet-sdk.ts` (typed facade, `MeetError`), `meet-transport.ts`,
`tests/support/fake-meet.ts` (several tabs through a hub: starting state, co-doing, frame
messages, `getMeetingInfo`).
**Tests:** `tests/unit/meet-transport.test.ts`, `tests/unit/meet-sdk.test.ts` (not inside Meet,
missing SDK, bad starting state).
**Result:** open.

## 4. Boot refactor of the presenter and viewer pages

**Goal:** `present.ts` and `main.ts` boot from session options and identity given by a caller,
the standalone entry unchanged.
**Deliverables:** an extracted boot function in each; no behavior change standalone.
**Tests:** existing `tests/e2e/present.test.ts` and viewer tests pass unchanged.
**Result:** open.

## 5. Meet pages: main stage and side panel

**Goal:** the user experience of DESIGN section 3.
**Deliverables:** `main-stage.html`/`.ts`, `side-panel.html`/`.ts`, `meet-boot.ts` (role from
starting state, host key kept local, end and leave); the Meet privacy notice; "open from Meet"
page; build config (`viewer` bundling, `site` target) and CSP changes (SDK script origin,
`frame-ancestors https://meet.google.com`) on the Meet pages only; add-on manifest template in
`docs/meet-addon.md` (`addOnOrigins`, `sidePanelUri`, `mainStageUri`, icons).
**Tests:** `tests/e2e/meet-addon.test.ts` (fake Meet, Chrome): starter plus two joiners link
without URL or tracker; a late joiner links; a guest's canvas stream shown by the host reaches
the others; host leaving ends guests; opened outside Meet shows the notice; no third-party
script on the standalone pages.
**Result:** open.

## 6. Resilience

**Goal:** the failure table of DESIGN section 8.
**Deliverables:** status text for waiting, `no-channel`, ended; offer retry backoff; clean
shutdown on `pagehide`; side panel status via frame messages.
**Tests:** extend `tests/e2e/meet-addon.test.ts` (transport failing then recovering; guest
reload; host closing).
**Result:** open.

## 7. Documentation

**Goal:** users and operators can set it up.
**Deliverables:** `docs/meet-addon.md` (Cloud project, manifest, test deployment, publishing,
troubleshooting); README "Further Documentation" row and a short feature line;
`docs/privacy.md` and the privacy page (what Google receives); `docs/manual-testing.md` Meet
checklist; `spec/INDEX.md` status; CHANGELOG entry.
**Tests:** `check` target (lint, typecheck, format) green.
**Result:** open.

## 8. Real-call verification and publishing

**Goal:** the add-on works in a real call and can be installed.
**Deliverables:** the manual checklist run with three browsers on a test deployment; results and
differences from the fake recorded here and in DESIGN; Marketplace listing prepared (privacy
policy and terms links, icons, description). Public publishing only when the user asks.
**Tests:** manual checklist.
**Result:** open.

## Completion Criteria

- From a Meet call, the starter begins inksplat and every participant who opens it joins with no
  link, code or tracker; a participant can share a tab, window or screen and the host shows it to
  everyone, with video flowing peer to peer in the star of spec 07.
- Only sealed signaling travels through Meet; the presenter key and video never do.
- The standalone site is unchanged and its pages load no third-party script.
- All automated tests pass on Linux, macOS and Windows CI; the manual checklist is done on at
  least Chrome in a real Meet call.
