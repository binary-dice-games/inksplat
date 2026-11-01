# Changelog

All notable user-facing changes to inksplat are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A tutorial page on the site (`tutorial.html`, linked from the home page, its About box and the join form): how to start, join and share a screen, every tool with screenshots and animations, sharing pictures and files by drag and drop, and the shortcuts that have no button.
- A faint line under the canvas buttons says for a few seconds how to use the tool just picked (and the pointer's mode, or the selection), like "Drag to draw · Press 2 again for another width". It can be turned off (**Settings** on the presenter page, the join form for viewers), folds away with **Tools** and is not shown on phone-sized screens.
- Several items can be selected with the pointer (1): a drag that starts on an empty place selects everything it passes over. Dragging any of them moves them all; the bar over them changes their colour; Delete removes them; Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste them (with the pins and threads on them) where the pointer is. A single selected item can be copied and pasted too.

### Changed

- The eraser draws a dashed trail along its way while it is held, like a selection drag with the pointer.
- The presenter controls are redesigned: grouped sections (Invite, People, Screen, Board), switches for the options, initials for the people, a button to hide the panel, and Settings and End session always in view. Long names are cut with an ellipsis (the full text shows on hover) instead of making the panel scroll sideways.
- Zoomed in, a mouse drag on an empty place with the pointer selects instead of panning: pan with Space+drag, the middle button, or touch.

- Animated GIFs dropped on the board move, for everybody, once the file has arrived.
- A picture with a transparent background is drawn as a cutout: its white border and shadow follow what shows instead of its rectangle.

- The pointer tool (1) has modes, in its panel or by pressing 1 again: **cursor**, **laser** (a trail that fades), **emotes** (picked from a wheel; they float up and fade, and a click on one makes it bigger for everybody) and **magnifier** (a lens beside the pointer that enlarges the screen and the drawings under it; the wheel sets how much). When the pointer comes back by itself (after a note is put down, or Esc), the first press of 1 keeps its mode.

- Anybody in a session can share a tab, window or screen at any time with **Share screen** (and stop with **Stop sharing**), not only the presenter; a notice explains it before the first share. The presenter's **Screen** list shows the streams on offer, with **Preview** (only the presenter sees it) and **Show** (everybody sees it), and **None**; one stream is on the screen at a time, and its owner is told whether it is offered, previewed or on screen.
- A **screen** background for any canvas: the stream on the screen, or black when there is none.

- A sticky note can be dragged out to the size wanted with the note tool (a click still puts one of the usual size).

- A thread let go over a note, picture, link or sticker (not on a pin) puts a pin there and is tied to it.

- With the thread tool, pressing on a note, picture, link or sticker (away from its pins) starts a thread from a new pin there; the pin is kept only if the thread is tied to something.

- The presenter page asks for confirmation before it is closed, reloaded or left while a session runs, and keeps a backup of the board in the browser after every change. When a new session starts and there is a backup, it asks whether to resume it or start new (and can download it first).

- A redesigned home page with the inksplat logo, a **Start presenting** button, the main features and how it works, and an **About** box with the version, licences and credits. The pages have the inksplat icon.

- Each canvas has its own background, chosen by the presenter for the canvas they are on (**Background of canvas N**): the video (in a session with video), whiteboard, blackboard, wall or cork. By default canvas 1 shows the video, if there is one, and the others the whiteboard, blackboard, wall and cork in turn. Board files keep the background of every canvas.
- Lines, texts and stickers can be selected (pointer tool, or the tool that makes them), so Delete or Backspace removes them too.
- Pins have a shape (round, square, diamond, triangle, star): the pin tool opens a panel with them, pressing 7 again cycles through them, and the bar over a selected pin changes it.
- Five canvases per board: round buttons at the top centre switch between them, each person on the one they choose; every button shows how many people are on it, and only the cursors and live drawing of those on your canvas show. **Clear** and **Clear drawings** affect the canvas shown; board files keep every canvas, PNG and SVG save the one shown.
- A note, picture or link dragged by its pin and dropped on another element is attached to it, like a pin: it is drawn on top of it and moves, turns and scales with it (chains of them follow); dragging it away by its pin, or onto nothing, detaches it. Locked elements stay where they are.
- The Delete (or Backspace) key removes the selected element, if it is not locked against you.
- Anybody can now change, move and delete any element of the board (it used to be only its author). A **lock** button in the bar over a selected element, for its owner, locks it: first for the others (only the owner can change it), then for everybody (nobody, until the owner unlocks it). A locked element shows a small padlock.
- Sticky notes have the three text sizes of the text tool in their bar, and a button to copy their text; a new note is selected as it is written.
- **Open...** button next to **Save...** to load a board file (it was inside the Save dialog).
- Every tool with options (line width, text size, stickers, note shapes, thread heads, colour) opens a panel with all of them when clicked in the toolbar; the number keys still cycle through them.
- Pins put on a note, picture, link or sticker stay attached to it (and their threads with them) when it is moved, turned or scaled; they go when it goes.
- Shift+dragging from a pin pulls a thread with any tool in hand, and the previous tool comes back on release; dragging a pin moves it; the pin wins over the threads and notes around it when it is clicked.
- **Clear drawings** in the presenter controls removes only lines, texts and stickers, leaving notes, pins, threads, pictures and files; the old button is now **Clear all**.
- **Save...** on the viewer and presenter pages: the board as a PNG picture or an SVG drawing (over the video frame or the chosen background), or as a board file to open in a later session and carry on (notes, threads, pictures and pinned files included; what is opened becomes yours).
- Sticky notes come in five shapes (square, rounded, oval, diamond, hexagon): key 6 again cycles them; select your note to change its shape or colour.
- Pin tool (7): a bare pin on the board.
- Thread tool (8): click a pin and drag to another to tie a hanging thread between them, with heads at none, the source, the destination or both (8 again cycles); select a thread to change its colour or heads, right click to remove it. Threads follow their pins and go when a pin is removed.
- Sticky notes: new tool (6) pins a note in a pale version of your colour; its owner clicks it to type, drags it to move, drags the corner to resize, right clicks to delete; others double click it to copy its text.
- Web links on the board: paste a link (Ctrl+V) or drag one from a page onto it to pin a card with its address; clicking the card opens the page in a new tab.
- White in the colour list (the eighth colour).
- PDF and Office files dropped on the board show their content on the card: the first page of a PDF, the saved thumbnail or the first paragraphs of a Word, Excel, PowerPoint or OpenDocument file (older .doc, .xls and .ppt files show only the card).
- **QR code** button in the presenter controls: shows the viewer link as a QR code to scan with a phone or tablet camera, and copies it as an image.
- Start a session without video (**Start a board without video** on the presenter page): only the shared board, on a whiteboard, blackboard, wall or cork background chosen by the presenter.
- Share files through the board: drop any file (picture, document, zip, ...) up to 5 MB on it. The board shows a preview (a picture's own, the first lines of a text file, or a card with the type, name and size), everyone else gets the file, and can drag a copy out to a folder or another app (double click to save it). Files and pictures are shown as prints pinned to the board, with a border, a shadow and a pin.
- Numbered tool shortcuts: 1 pointer, 2 line, 3 text, 4 stickers, 5 eraser, 6 colour. Pressing a number again goes through the options of that tool (line: thin, normal, thick; text: small, medium, large; each sticker; each colour); the toolbar shows the option in use. `0` resets the zoom.
- Drag your own lines, text, stickers and images to move them; right click removes them. Stickers and images scale with Shift+drag and turn with Ctrl (or Alt)+drag.
- Zoom with the mouse wheel at the pointer (and move with the middle button, or by dragging when zoomed in); the drawings stay where they are on the video.
- Drop an image file on the board to add it as a drawing item.
- Other people's cursors take the shape of their active tool; an optional avatar (set in the join form or the presenter settings) replaces the name on the cursor.
- Turn queue in the lower left corner: ask for a turn, end it or leave the queue; the queue shows name and avatar on each person's colour, and the cursor of whoever has the turn is larger and its name tag or avatar has a pulsing border. The presenter can remove anyone.
- Setting for how long the viewer link stays valid on the trackers (one hour by default, 0 for no limit); a **New link** button in the controls renews it.

- Presenter page on the viewer site (`present.html`): start a session and choose what to share with the browser's picker (a tab, a window,
  a whole screen, native applications included). The page is presenter and
  console in one: draw over the live preview, copy the viewer link, and manage
  viewers (remove, lock, pause, clear, end). The mouse pointer can be hidden in the
  shared video; a Settings dialog sets name, colour, video limits, trackers and
  STUN/TURN servers; the tools and the controls panel can be folded away.
- Viewer page: join a link, watch the shared tab and draw on it (pen, text,
  stickers, emoticons), and fold the toolbar away. See who is here and how the
  connection goes; join with a code when the network blocks the trackers (the
  presenter pastes it under "Join codes" in the controls).
- Serverless collaboration core: sessions over WebRTC with a low-frame-rate
  video track and a shared whiteboard (ink, text, stickers and emoticons),
  adapted from nymph.

- Privacy policy page on the viewer site.

### Changed

- Pins are drawn at half their size; the area that catches the pointer over them is as large as before.
- The presenter's start page only starts a session (**Start session**); streams start and stop inside it. Canvas 1 shows the screen by default, black until something is shown. The board keeps a 16:9 frame and every stream fits inside it. A viewer's stream reaches the others through the presenter, who forwards it as it arrives in Chrome. Viewers of an older version cannot join (protocol `inksplat/2`).
- Board files (**Save... > Board file**) are now zips (`.inksplat.zip`) that any zip tool opens: `manifest.json`, `settings.json`, one `canvas-N.json` per canvas, and the pictures (`images/`) and documents (`files/`) on the board as they are, instead of base64 in one JSON file. The presenter's backup in the browser is the same zip.
- The bar over a selected element is hidden while the element is dragged (or a thread pulled from it), so it does not cover where it is put down.
- New sticky notes and pins are about half their former size, and the small, medium and large text sizes of notes and the text tool are about three quarters of what they were.
- The project is now called inksplat, with a new logo: page titles, invite links (`#inksplat=`), saved files (`.inksplat.json`), npm packages (`@inksplat/...`), CMake names (`INKSPLAT_...`, `inksplat_add_test`) and the site address (`/inksplat/`).
- Notes, pictures and links turn about their pin (Ctrl+drag, or attached to a turning element), not their centre; the pin and its threads stay put.
- Dragging an element by its pin outlines the pin (a ring that goes with it), not the element, and outlines with a dashed line the element it would be attached to if dropped there.
- Dragging a bare pin also outlines with a dashed line the element (note, picture, link or sticker) it would be attached to if dropped there; stickers get a dashed outline too.
- Pictures and pinned files move with a plain drag, whoever pinned them, and are copied out of the board with Shift+drag (as pins use drag to move and Shift+drag for a thread). They are resized from a corner grip instead of with Shift.
- The colour shortcut is now key 9 (6 is the sticky note, 7 the pin, 8 the thread).
- Pinned pictures and files are slightly tilted at random, as if put up by hand.
- Wall and cork backgrounds look like painted plaster and cork, with a lit, rough surface and a wooden frame on the cork.

### Fixed

- A viewer could sometimes see no video after joining (the page showed the stream of a connection it had dropped).
- A participant's shared screen is sent in AV1 (or H.264) instead of VP8 where the browsers allow, which keeps more detail while it moves and uses less bandwidth; a viewer whose browser lacks that codec still gets the picture.
- A shared screen sharpens once it stops changing (in Chrome): text no longer stays blurry after scrolling or switching pages, especially on 4K screens.
- Zooming, panning and the magnifier no longer slow down badly on large (4K) screens, notably over the wall, cork and whiteboard backgrounds.
- Zooming over many notes, pictures, pins and threads is much faster: their shadows are sharp-edged now instead of blurred. The faint square around pins stuck on notes is gone.
- The magnifier's lens is clipped round: a square of the enlarged screen no longer shows around it.
- Stickers can be selected, moved and erased by touching anywhere on them, not only their lines (they were often missed, notably on iPad).

- The bar over a selected element shows again when the same element is selected a second time after letting it go.
- The bar over a selected element stays inside the board near its edges (it goes under the element when there is no room over it), so all its buttons can be reached.
- The grip that resizes a note or picture is drawn inside its shape (it was at the corner of the box, outside ovals, diamonds and hexagons, so clicking it deselected the note) and is easier to hit.
- The text box of a note being written follows the note when it is moved, resized or turned.
- An options panel has only as many slots as options (it always showed four).
- The thread-head icons use a gentler curve so the head at the start points the right way.
- The bar over a pin attached to another element is drawn over the pin, where it is, not where it was first put.
- The thread-heads icons in the toolbar and its options panel are drawn as filled heads along the curve.
- Dragging a pin that is attached to a note that has been moved no longer starts its thread from the note's old place.
- Blurry video: the shared tab is now sent at the screen's own resolution (HiDPI included, up
  to 4K) instead of being shrunk to 1280x720, and AV1 or H.264 is used instead of VP8, so
  text is sharp as soon as the page stops moving. The default bitrate cap is 1500 kbps.
- Viewers and the console could not connect through the public trackers (only join codes
  worked): offers were too large for the trackers. They are now compressed.

- Connection diagnostics: the extension's offscreen page and the viewer write one line per
  step of making a connection to the browser console, prefixed `[inksplat]`.

### Removed

- **Pause**/**Resume**, **Share again** and **Start a board without video** (use **None**, **Share screen** and **Start session**). The **Video** background is now **Screen** (board files that name it open with it).
- The old `.inksplat.json` board files (and browser backups in that format) can no longer be opened.
- The right button no longer removes the element under the pointer; select it and press Delete or Backspace instead.
- The C++ library and executable; the project is now TypeScript.
