# inksplat — Building

inksplat is TypeScript/JavaScript. CMake is the entry point and calls npm.
It runs on **Linux, macOS and Windows**.

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 20 | with npm |
| CMake | 3.14 | entry point for check and test |
| Google Chrome | recent | `tests/e2e/webrtc.test.ts` |
| Xvfb | any | Linux without a display: the support app's tests ([support-app.md](support-app.md)) |

Configuring runs `npm ci` (or `npm install` without a lock file) when
`node_modules/` is missing or `package-lock.json` is newer than what was installed (after a pull
or a branch switch that changed the dependencies).

## Build, check and test

```
cmake -S . -B build
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target viewer       # the viewer and presenter pages in viewer/dist
cmake --build build --target site         # the whole Pages site in site/
cmake --build build --target support-app  # inksplat Support in support-app/dist
cmake --build build --target support-package  # its installers in support-app/release
ctest --test-dir build -C Debug --output-on-failure --parallel
```

`-C Debug` matters with multi-config generators (Visual Studio, Xcode).

Without CMake, from the repository root:

```
npm run check          # eslint, tsc, prettier --check
npm run build:viewer     # viewer/dist (the viewer and presenter pages)
npm run build:site       # site/ (viewer, presenter page, /v2/ copy, 404, privacy policy)
npm test               # unit tests (Vitest, project "unit")
npm run test:e2e       # browser tests (project "e2e"), needs Chrome
```

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `INKSPLAT_BUILD_TESTS` | ON when top level | Register the tests with ctest |

| Environment variable | Meaning |
|----------------------|---------|
| `INKSPLAT_CHROME` | Path of the Chrome executable for the browser tests (otherwise standard install paths, then Playwright's `chrome` channel) |

## Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video (copied from nymph, adapted) |
| `packages/collab-whiteboard/` | Whiteboard (copied from nymph, adapted) |
| `support-app/` | inksplat Support, the Electron app of support sessions ([support-app.md](support-app.md)) |
| `packages/defaults/` | Trackers, ICE servers, video presets, `stage` message, invite links |
| `viewer/` | The viewer app (`src/main.ts`) and the presenter page (`src/present.ts`, `src/share-host.ts`) |
| `scripts/` | Build scripts: `build-viewer`, `build-site`, `smoke-site` |
| `tests/unit/` | Vitest unit and integration tests (memory network) |
| `tests/e2e/` | Chrome tests: real WebRTC through a local fake tracker |
| `tests/support/` | Fake tracker, browser launcher, room helpers |

`spikes/` holds throwaway experiments (capture, video quality); it is not part of the build.

## Tests never use the network

Browser tests start `FakeTracker` (a local WebTorrent tracker) and serve the
packages from a loopback HTTP server. Real NATs, public trackers and TURN are
a manual check: see [manual-testing.md](manual-testing.md). How to run and write tests
is in [testing.md](testing.md).
