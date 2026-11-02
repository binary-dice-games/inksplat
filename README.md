<img src="resources/inksplat.png" alt="inksplat" height="200"/>

inksplat turns a shared tab, window or screen into a shared whiteboard. The
presenter starts a session and sends a link; viewers open it in the browser
with nothing to install. Everybody draws on the same board, which sits on top
of the shared video instead of being part of it.

- **Share anything the browser's picker offers:** a tab, a window or a whole
  screen, so native applications work too. The presenter and any viewer can
  share; the presenter chooses the stream everybody sees.
- **A real whiteboard:** pointer, laser, emotes, lines, text, stickers, sticky
  notes, pins and threads, pictures and files, five canvases, and saving as
  PNG, SVG or a board file. See [docs/using-the-board.md](docs/using-the-board.md).
- **No server:** the site is static (GitHub Pages). Peers find each other
  through public WebTorrent trackers with sealed offers, and the video is
  WebRTC at a low frame rate.

The collab code is copied from [nymph](https://github.com/binary-dice-games/nymph)
and adapted (see [NOTICE](NOTICE)).

## Quick Start

1. Open the presenter page (`present.html`) and press **Start session**.
2. Send the viewer link (or the **QR code**) to the others.
3. Press **Share screen**, pick what to show, and draw. Viewers open the link,
   and can draw or share their own screen too.

The home page (`index.html`) has a **Start presenting** button. The
[tutorial page](viewer/src/site/tutorial.html) has the pictures.

## Quick Build

```sh
cmake -S . -B build                       # installs npm dependencies on first run
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target site         # the whole Pages site in site/
ctest --test-dir build -C Debug --output-on-failure --parallel
```

Needs Node.js 20+; the browser tests need Chrome. See
[docs/building.md](docs/building.md).

## Project Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video |
| `packages/collab-whiteboard/` | The whiteboard |
| `packages/defaults/` | Trackers, ICE servers, video presets, invite links |
| `viewer/` | The viewer app and the presenter page |
| `viewer/src/site/` | Static pages: 404, privacy policy, tutorial |
| `tests/` | Unit tests, Chrome WebRTC tests, fake tracker |
| `cmake/` | CMake modules |
| `docs/` | Documentation |
| `spec/` | Design and plan documents, one folder per project |
| `resources/` | Project assets (the logo) |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/using-the-board.md](docs/using-the-board.md) | Tools, keys, canvases, files, saving and resuming |
| [docs/building.md](docs/building.md) | Prerequisites, build, check and test |
| [docs/testing.md](docs/testing.md) | Running the tests, how the browser tests work, trying the presenter page by hand |
| [docs/manual-testing.md](docs/manual-testing.md) | Checklist for real networks and the real picker |
| [docs/publishing.md](docs/publishing.md) | Publishing the Pages site |
| [docs/privacy.md](docs/privacy.md) | Where the privacy policy lives, in short |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [NOTICE](NOTICE) | Code copied from nymph |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |
| [CLAUDE.md](CLAUDE.md) | Coding style and project rules for agents and contributors |

## License

MIT License © 2026 Binary Dice Games. See [LICENSE](LICENSE).
