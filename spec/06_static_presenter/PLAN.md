# 06_static_presenter - plan

Design: `spec/06_static_presenter/DESIGN.md`. Follow the steps in order.

## 1. ShareHost without a tab or keeper

**Goal:** `ShareHost` runs in a page that has no tab and mounts its own whiteboard.
**Deliverables:** `tabId` optional, `keeper?: boolean` (default true),
`clearBoard?: () => void`; `UiState.tabId` stays `number | null`.
**Tests:** `tests/unit/share-host.test.ts`: without a keeper `clear` calls the
callback; the ui has `tabId: null`.
**Result:** done.

## 2. Display capture module

**Goal:** the picker, the surface facts and the pure helpers.
**Deliverables:** `viewer/src/display-capture.ts` (`startDisplayCapture`,
`fitScale`, `surfaceWarning`).
**Tests:** `tests/unit/display-capture.test.ts`.
**Result:** done.

## 3. Presenter page and build

**Goal:** `present.html` in the Pages site, not in the extension.
**Deliverables:** `viewer/src/present.ts`, `present.html`; `buildViewer` builds
them (option `present`, off for the extension); `build-site` and `smoke-site`
cover it; the viewer's landing links to it.
**Tests:** `tests/e2e/present.test.ts`.
**Result:** done.

## 4. Documentation

**Goal:** README, docs, changelog, spec index.
**Deliverables:** README overview and layout; `docs/manual-testing.md` rows for
the real picker, still screen and background tab; CHANGELOG.
**Result:** done.

## 5. Settings dialog, folding

**Goal:** settings are editable; the
console and tools can be folded away.
**Deliverables:** `present-settings.ts`; the
Settings dialog; Tools and Controls toggles.
**Tests:** `tests/unit/present-settings.test.ts`; `tests/e2e/present.test.ts`
(remembered settings, live video settings, folding).
**Result:** done.

## 6. Remove the extension, fold the viewer's tools

**Goal:** the presenter page is the only presenter; the viewer can fold its tools.
**Deliverables:** `extension/`, its scripts, tests, workflow and docs deleted;
`ShareHost` and settings moved to `viewer/src/`, without tab, key, `ctl` or keeper;
the presenter key removed from links and the viewer; `fold.ts`; the viewer's Tools
button; the viewer's browser tests moved onto the presenter page.
**Tests:** `tests/unit/share-host.test.ts` (including that `ctl` commands are
ignored), `tests/e2e/viewer.test.ts` (folding, removal, join codes, touch,
accessibility, placement), `tests/unit/site-build.test.ts`.
**Result:** done.

## Completion Criteria

`npm run check`, unit and browser tests pass; `present.html` is on the built
site; the manual checks of section 3 of the design are recorded in
`docs/manual-testing.md`.
