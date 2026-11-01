<img src="resources/inksplat.png" alt="inksplat" height="200"/>

# inksplat

inksplat turns a shared tab, window or screen into a shared whiteboard. The
presenter starts a session on the presenter page and gives a link; viewers open
it (nothing to install). Anybody in the session, the presenter or a viewer, can
share a tab, a window or a screen with the browser's own picker (so native
applications work too), at any time; the presenter picks the one everybody sees,
as a low-frame-rate WebRTC video, and everybody draws on the same board. There is
no server: the site is static, peers find each other through public WebTorrent
trackers with sealed offers, and the board is a layer of data on top of the video,
not part of it. The collab code is copied (not
referenced) from [nymph](https://github.com/binary-dice-games/nymph) and adapted.

**Status:** working end to end on Chromium: the collab core, the presenter page,
the viewer app, and the scripts and workflows for the Pages site (CI passes on
Linux, macOS and Windows; the Pages workflow has not run yet). Not done: tests on
real phones and other browsers, the load test with many viewers, a clear message
for a version mismatch. See [spec/INDEX.md](spec/INDEX.md).

**How it works.** The **presenter page** (`present.html`) is host and console in
one: **Start session** opens the board and gives the viewer link. **Share screen**
(on both pages) opens the picker; a viewer's stream goes only to the presenter, who
previews it, shows it (**Screen** in the controls) or shows **None**, and forwards
the one shown to everybody as it arrives, without decoding it (Chrome;
`spec/07_participant_streaming`). Nothing is drawn on the shared surface itself,
because capture would record it: people draw on a live copy of it. Viewers open the link on the
viewer page (`index.html`), which without a link is the home page: the logo, a
**Start presenting** button and an **About** box with the version and credits. Both are served from GitHub Pages
(`spec/06_static_presenter`). There used to be a Chrome extension; it was removed
because the page does the same and more.

## Using the board

Keys 1-9 pick the tool (1 pointer, 2 line, 3 text, 4 sticker, 5 eraser, 6 sticky note, 7 pin, 8 thread, 9 colour); pressing the
same number again goes through its options (clicking a tool with options opens a panel with all of them), and a faint line under the canvas buttons says how to use the tool in hand. The pointer has four modes: **cursor** (the usual one), **laser** (dragging leaves a glowing trail that fades in a second) and **emotes** (press, move towards a face on the wheel and let go, or click and then click a face; it floats up and fades, and anybody who clicks it while it lives makes it bigger), and the **magnifier** (the cursor with a round lens beside it that enlarges the screen and the drawings under the pointer, to read small text; the wheel changes how much, and only you see it); Esc goes back to the cursor. When the pointer comes back by itself (after a note is put down, or Esc), the first press of 1 only confirms it. Drag items to move them, click one to
select it (a bar to change it appears over it, hidden while it is dragged) and press Delete or Backspace to remove it. With the pointer, a drag that starts on an empty place selects everything it passes over (as the eraser marks it); drag any of them to move them all, change their colour from the bar, press Delete to remove them, and Ctrl+C, Ctrl+X and Ctrl+V to copy, cut and paste them (pasted where the pointer is, on the canvas shown; zoomed in, Space+drag or the middle button pans) (anybody can change anybody's, unless the owner locks it from the bar over it: only the owner, or nobody); stickers and links scale with Shift+drag, pictures and files resize from their corner, and all turn with Ctrl+drag (what is pinned turns about its pin). The wheel zooms
at the pointer (0 resets), and image files can be dropped on the board (an animated GIF moves; a picture with a transparent background is cut out, its border and shadow around what shows); web addresses pasted or dropped become cards that open the page. Sticky notes (tool 6) are put down with a click, or dragged out to the size wanted, and written by clicking them, moved by dragging, resized from the corner and removed with Delete once selected; select a note to copy its text, change its shape, text size and colour, or lock it. Pressing 6 again goes through the shapes of the note (square, rounded, oval, diamond, hexagon); select your note to change its shape or colour. The pin tool (7) puts down bare pins in five shapes (7 again goes through them). **Threads** (8) hang between pins, like on a detective's board: press on a pin (those of notes, pictures and links too, or one from the pin tool), drag to another and let go, or let go over a note, picture, link or sticker to put a new pin there (pressing on one of those starts from a new pin too, kept only if the thread is tied); 8 again goes through the heads (none, source, destination, both); select a thread to change its colour or heads, or Delete to remove it. Dragging a pin moves it, and Shift+dragging from a pin pulls a thread whatever tool you hold (it comes back when you let go), and a pin put on a note, picture, link or sticker stays on it when that moves, turns or scales. A note, picture or link dragged by its pin onto another element is attached to it the same way (it is drawn on top and goes, turns and scales with it). Five **canvases** (round buttons at the top centre, each with the number of people on it; everybody chooses their own and sees only the cursors of those on it) hold separate contents, each on its own background: the presenter picks it for the canvas they are on (**Background of canvas N**: the screen, whiteboard, blackboard, wall or cork; by default canvas 1 has the screen, which shows the stream on screen or black, and the others the whiteboard, blackboard, wall and cork); board files keep all of them, PNG and SVG the one shown, and the clear buttons act on the one shown. **Clear drawings** in the controls removes only lines, texts and stickers; **Clear all** also takes the notes, pins, threads and files. **Ask for a turn** (lower
left) queues you to speak; the presenter can remove anyone. Files (up to 5 MB) dropped on the board
are pinned as previews (the first page of a PDF, the text of an Office file) that everyone can drag
a copy out of (Shift+drag it out; a plain drag moves it); **QR code** in the controls shows the link for a camera.
**Save...** and **Open...** (viewer bar, presenter controls) save the board as a PNG picture, an SVG drawing, or a board
file (`.inksplat.zip`: one JSON file per canvas, the settings, and the pictures and files on the board as they are, so any zip tool shows what is in it) that **Open...** adds to a new session to carry on;
everything opened becomes the opener's own, so it can be moved and changed there.
The presenter page asks before closing or reloading (that ends the session) and keeps a backup of the board in the
browser, written a second after every change; the next session offers to **Resume** it or **Start new**.

## Build and test

```
cmake -S . -B build                       # installs npm dependencies on first run
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target site         # the whole Pages site in site/
ctest --test-dir build -C Debug --output-on-failure --parallel
```

Needs Node.js 20+; the browser tests need Chrome. Details in
[docs/building.md](docs/building.md).

## Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video |
| `packages/collab-whiteboard/` | Whiteboard |
| `viewer/` | The viewer app (`main.ts`) and the presenter page (`present.ts`, `share-host.ts`) |
| `packages/defaults/` | Trackers, ICE servers, video presets, `stage` message, invite links |
| `tests/` | Vitest unit tests, Chrome WebRTC tests, fake tracker |
| `cmake/` | CMake modules (Node discovery, `inksplat_add_test`) |
| `spec/` | Design and plan documents, one folder per project |
| `docs/` | User and developer documentation |
| `resources/` | Project assets: the logo (`inksplat.png`) |
| `viewer/src/assets/` | The logo, its dark-mode copy and the icon, sized for the pages (made from `resources/inksplat.png`) |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/building.md](docs/building.md) | Prerequisites, build, check and test |
| [docs/testing.md](docs/testing.md) | How to run the tests, how the browser tests work, how to try the presenter page by hand |
| [docs/manual-testing.md](docs/manual-testing.md) | Checklist for real networks and the real picker |
| [docs/publishing.md](docs/publishing.md) | Publishing the Pages site |
| [docs/privacy.md](docs/privacy.md) | Where the privacy policy lives, in short |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [NOTICE](NOTICE) | Code copied from nymph |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |

# MIT License © 2026 Binary Dice Games
