# 01_core_features — product, architecture and collab core

> **Update: the Chrome extension, the presenter console, the presenter key, the `ctl` channel and the board keeper described here were removed; the presenter page replaced them (`spec/06_static_presenter/DESIGN.md` section 8). The rest (session, star topology, whiteboard, security of the link) still holds.**

Foundation project. It defines what inksplat is, how the pieces fit, the repo
and tooling, and the **collab core** (session + whiteboard) that every other
project builds on. Related projects:

| Project | Covers |
|---|---|
| `spec/02_presenter_extension/` | Chrome extension: overlay, toolbar, share controls |
| `spec/03_tab_streaming/` | Tab capture and low-fps WebRTC video |
| `spec/04_viewer_site/` | Static viewer page on GitHub Pages |
| `spec/05_release_pipeline/` | CI, Pages deploy, Web Store packaging |

## 1. Purpose and scope

inksplat turns a browser tab into a shared whiteboard. A **presenter** with the
Chrome extension enables it on the active tab. The extension:

1. Gives the presenter a **console**: a separate window that shows the video and
   the whiteboard (pointer, pen, text, stickers/emoticons, eraser, undo/redo,
   colours) and the presenter's controls. Nothing is injected into the shared tab.
2. Streams the tab's pixels to **viewers** over WebRTC, at a low, configurable
   frame rate.
3. Produces a **collab link**. Viewers open it in any modern browser, with no
   extension. They see the video plus the same whiteboard and can draw on it.

Drawings are **never part of the video**. They travel as data and each peer
renders them locally on top of the video, the presenter's console included.
The presenter does not draw on the live page: tab capture records whatever is
rendered in the tab, an overlay included, and the browser has no way to exclude
it (see `spec/03_tab_streaming/PLAN.md` step 1).

Non-goals (v1): audio, recording, persistence of drawings, accounts, a server
of our own, more than ~10 viewers, non-Chromium presenters, remote control of
the presenter's page, multi-tab sharing.

## 2. Origin: copy of nymph, not a dependency

The collab code is **copied** from `binary-dice-games/nymph`
(`web/collab/collab-session.js`, `web/collab/collab-whiteboard.js`, and the
ideas in nymph `spec/18_collaboration/DESIGN.md`). inksplat never references
nymph at build or run time. Copied files keep a provenance header (source path,
commit, date) and nymph's MIT notice in `NOTICE`. Divergence is allowed; the
header is how to diff against upstream.

Reused unchanged in concept: serverless signaling through public WebTorrent
trackers with sealed (AES-GCM) offers, manual-code fallback, star topology
(host = presenter), `reliable` + `fast` data channels, 16 KiB framing,
last-writer-wins whiteboard with Lamport stamps and tombstones, roster,
lock/remove/new-link, 500-entry/2000-item/5000-point limits.

## 3. Architecture

```
 Presenter's Chrome                                   Viewers' browsers (no extension)
┌───────────────────────────────────────────┐        ┌──────────────────────────────┐
│ Shared tab (untouched: no overlay)        │        │ viewer page (GitHub Pages)   │
│        │ chrome.tabCapture                │        │  <video> + whiteboard        │
│ ┌──────▼─────────┐   ┌─────────────────┐  │        │  collab-session (guest)      │
│ │ service worker │──►│ offscreen doc   │◄─┼────────┴──────────────▲───────────────┘
│ │ (orchestrator) │   │ session (host), │  │   WebRTC: video track + reliable/fast
│ └──────▲─────────┘   │ board keeper,   │  │   data channels (star, 1 link per peer)
│        │ popup       │ MediaStream     │  │
│ ┌──────┴─────────┐   └────────▲────────┘  │   signaling: sealed offers/answers via
│ │ popup / options│            │ WebRTC    │   public WebTorrent trackers (wss) only
│ └────────────────┘   ┌────────┴────────┐  │
│  Console window ◄────┤ viewer.html     │  │   The console is a guest with the
│  (extension page)    │ + presenter key │  │   presenter key, in its own window.
│                      └─────────────────┘  │
└───────────────────────────────────────────┘
```

Key decisions (the *why*):

- **Session lives in the offscreen document, not the page.** Page CSP can block
  WebSockets to trackers; the page navigates and reloads (killing links);
  MV3 service workers sleep and cannot hold `RTCPeerConnection`. The offscreen
  document survives navigation and owns the capture stream anyway.
- **The board keeper in the offscreen document holds the drawings** while no
  console is open, so late joiners get a snapshot and drawings survive the
  console being closed and reopened.
- **Overlay talks to the session through a `SessionProxy`** (a `Port` relay via
  the service worker) that implements the same `channel()`/`on()` surface the
  whiteboard expects from a `Session`: `serveSessionProxy(session, port, hooks)`
  in the offscreen document, `connectSessionProxy(port)` in the overlay
  (`packages/collab-session/session-proxy.js`). The copied whiteboard needs no
  changes for this.
- **Star topology, presenter is host.** Same reason as nymph: the presenter
  holds the truth and one NAT path per viewer. Cost: uplink = viewers × video
  bitrate, hence the low-fps default and ~10-viewer target (see
  `spec/03_tab_streaming/DESIGN.md`).
- **The presenter is a peer with a key.** The console is the viewer app opened with a
  second secret (the presenter key); the host trusts that peer's `ctl` commands.
  See section 4.5.
- **Viewers are first-class drawers.** Unlike nymph (guests view only), any peer
  may add/modify/delete any item. The presenter can *lock* viewers to
  pointer-only at any time (host-enforced, see 4.3).
- **Whiteboard coordinates are frame-relative** (4.2), so the same drawing
  lines up on the presenter's page and on every viewer's video.

## 4. Collab core contract

Lives in `packages/` (see 5). Changes versus nymph are listed explicitly.

### 4.1 `collab-session` (copy)

Same public API as nymph (`createSession`, `Session`, `channel`, `peers`,
`lock`, `remove`, `newInvite`, `inviteFragment`, `manual`, events). Changes:

| Change | Reason |
|---|---|
| Fragment key is `inksplat=<token>` (not `collab=`) | Avoid clashing with nymph links |
| `media` option: host passes a `MediaStream` (or track source); guest passes `onTrack` | Video, see below |
| Guest offers always include a `recvonly` video transceiver | Offers are guest-made; the host attaches its track to that transceiver before answering |
| Tracker list and ICE servers come from options, defaults in `packages/defaults` | Configurable in extension options |
| Protocol id `inksplat/1` | Handshake refuses mismatches |

Media hooks (contract, details in `spec/03_tab_streaming/DESIGN.md`):

- Host: `session.setMedia(stream | null)` attaches/replaces the sender track on
  every link (current and future) via `RTCRtpTransceiver`/`replaceTrack`.
  `session.mediaParams({fps,maxBitrate,scale})` sets sender parameters live.
- Guest: `session.on('track', (stream) => ...)`.
- Guests' streams (an uplink per guest, `setRelay`, forwarding of encoded frames): see
  `spec/07_participant_streaming/DESIGN.md` section 4.
- A link is "open" once data channels are open; video may arrive later or
  never (e.g., presenter paused). Failure to negotiate video does not close
  the data link.

### 4.2 `collab-whiteboard` (copy, adapted)

Same tools, data model, merge rules and limits as nymph. Changes:

- **Board units.** Item coordinates, stroke width and text/sticker size are in
  units where the **frame width = 1000**. Frame height in units is
  `1000 / aspect`. The *stage* message (4.3) carries `aspect`. Items are not
  rescaled if the aspect later changes (page layout reflows anyway); content
  outside the new frame is clipped, not deleted.
- **Adapter** maps board units to the host element: the page viewport on the
  presenter, the letterboxed `<video>` rectangle on viewers.
- **Stickers.** Built-in SVG set is extended with emoticon faces (smile,
  laugh, wink, sad, surprised, angry, cool, thinking) next to nymph's check,
  cross, question, star, heart, thumbs-up, warning, arrow. Peers send names
  only, never SVG (nymph decision: emoji glyphs differ per OS). The text tool
  still accepts emoji characters.
- **Permissions.** Nymph's `readOnly` is local. inksplat enforces the lock on
  the host: `drawingGate(() => drawing)` is the session's `accept` callback and
  drops viewers' ops, live ink and non-empty snapshots while drawing is off
  (cursors and empty join requests still pass), and rate-limits ops to 50/s per
  peer. Viewers learn the state from `stage.drawing` and set the whiteboard's
  `readOnly` from it, so no separate `perm` message exists.
- **Snapshot on join.** The host sends the full model snapshot to a new
  viewer on the reliable channel (nymph already merges snapshots). While the
  overlay is detached (page loading) the **board keeper**
  (`packages/collab-whiteboard/board-keeper.js`) does this: it is a headless
  `WhiteboardModel` next to the host session that merges viewers' changes and
  hands a snapshot to the overlay when it attaches.
- **Frame adapter.** `frameAdapter(element, aspect)` and `letterbox()` map
  board units to the letterboxed frame inside an element.
- **Clear** affects everyone and is allowed to viewers only while drawing is on.

- **Canvases.** A board has `PAGES` (5) canvases. An item carries `page` (1 to 4; absent for the first), set from `model.page` when it is added, so there is no new op; `render()`, the export, hit tests and `clear` work on `pageItems()`, `saveBoard`/`loadBoard` on every item. Which canvas one is on is local: `setPage()` sends `{t:'pg', n}` (always allowed by `drawingGate`; the host tells a newcomer where the others are with `of`), `cur` and `ink` messages carry `pg`, and a cursor or live stroke from another canvas is not shown. `pageCounts()` feeds the badge on each button. Undo is not per canvas.

- **Numbered tools and options.** The toolbar order gives the shortcuts (1 pointer, 2 pen,
  3 text, 4 sticker, 5 eraser, last the colour). A number selects the tool; pressing it
  again cycles its options (pen thin/normal/thick = 2/4/8 units, text 18/28/44, each
  sticker, the palette). Options are local style, never synced.
- **Tool hints.** A faint line under the canvas buttons says how to use what is in hand: the
  selection (one item or several), else the tool or the pointer's mode, with the tool's number
  (`strings.toolHints`, `{key}` for the number; a host may translate only some). It shows for
  `toolHintMs` (3.5 s) when that changes and then fades, so it never stays over the screen; letting
  go of a selection only hides it. Nothing shows while drawing is locked, on screens narrower than
  520px (it would cover too much), or with `toolHints: false` / `setToolHints(false)` (the pages
  keep the choice: the presenter's Settings, the viewer's join form).
- **Own items.** Items carry `author`; the author can drag them (pointer tool, or the
  tool that made them). Clicking an element selects it (lines, texts and stickers with the pointer
  or their own tool) and Delete or Backspace removes the selected one; the right button does
  nothing to elements, because removing what was under it surprised people. A drag with the
  pointer from an empty place (mouse or pen; touch is left to the page) selects what it passes over,
  sampled every few pixels as the eraser does (`selectItems`, `selection`): dragged together (what
  sits on a moved element follows it, so it is not moved twice; locked items stay), coloured from
  the bar, deleted, and copied, cut and pasted through `copy`/`cut`/`paste` events with the type
  `application/x-inksplat-items` (JSON items; picture files go along only on the same page).
  Pasting reuses `loadBoard`'s placement (`placeCopies`: new ids, attachments and threads remapped).
  Zoomed in, a mouse drag on an empty place therefore no longer pans: Space+drag, the middle button
  or touch do. Shift+drag scales and Ctrl/Alt+drag
  rotates stickers about their centre and what has a pin (notes, images, links) about its
  pin, which stays put (`rot` degrees, absent when 0; `x`, `y` stay the unturned centre, so the
  true centre is `centre(item)`). The
  model still lets any peer change any item (last writer wins); "own" is a UI rule.
- **Images and files.** `image` items hold a *preview*: a small PNG/JPEG/WebP data URL (at
  most 300 000 characters, 20 per board). Any dropped file becomes one: a picture shows
  itself (scaled down until it fits), a text file shows its first lines, anything else a card
  with the type, name and size. The host page can add content to the card through the
  `filePreview` option (`viewer/src/previews.ts`): the first page of a PDF, drawn by pdf.js
  (shipped next to the pages, loaded only when a PDF is dropped, run in its own worker with
  `isEvalSupported: false` because of the CSP), and for Office and OpenDocument files, which are
  zips of XML read without a library, the saved thumbnail if there is one, else the first
  paragraphs (docx, the first slide of a pptx, the strings of an xlsx, the text of an odt/ods/odp).
  Old binary formats (.doc, .xls, .ppt), protected or damaged files, and a preview that takes
  over 10 s keep the plain card. Previews are made once, by whoever drops the file. When the file is at most 5 MiB (25 MiB for the board) the item also
  carries `file: {name, mime, bytes}` and the bytes travel separately, as `{t: 'file', id,
  data: base64}` on `wb`, to everyone when the file is added and from the host to anyone who
  joins later. A receiver accepts them only for an existing image item with `file`, from the
  item's author or the host, and only with exactly `bytes` bytes; the name and type come from
  the item, never the message, and the name loses path characters. A file whose bytes start
  like a GIF is drawn from a blob URL of the file instead of the preview, so an animated GIF
  moves (up to the 5 MiB of a file, far more than the preview could hold); the preview, its
  first frame, stays the fallback and is what PNG, SVG and the snapshot carry. A picture with
  at least 0.1% clearly transparent pixels keeps them (a PNG preview) and is marked
  `cutout: true`: it is drawn without the white rectangle, through an SVG filter that grows its
  alpha into a white border with a thin edge, so the border and the shadow follow what shows,
  like a cutout; the pin stays at the top middle of its box. Others get an invisible HTML
  box over each print (an SVG image cannot be dragged) whose `dragstart` puts the file on the
  drag as a `File` (pages and apps) and as `DownloadURL` (desktop and folders, Chromium);
  double click saves it. Your own prints are moved, not copied. The prints are drawn with a
  border, a shadow and a pin. The shadow is a copy of the paper's shape in see-through black,
  offset down and to the right outside the turn so the light stays put; it is not blurred, because
  an SVG blur filter was drawn again at every zoom step and made zooming slow on large screens.
  Past the size limit a picture is still shared, as a preview only; any other file is refused.
- **Sticky notes.** A `note` item is `{x, y, size (width), ratio, text, color (its paper), rot?}`; text up
  to `LIMITS.text`, may be empty. Made with tool 6 (`addNote`); the paper is a pale mix of the
  author's current colour. Only its author edits it (click, in a textarea over it; Ctrl+Enter or
  blur keeps, Escape drops), moves it, resizes it (the bottom right corner keeps the top left one
  fixed) or deletes it; the text is wrapped with canvas metrics so the box and the drawing agree.
  Others double click to copy the text (`copyText` option). The pin is a `g.pin[data-id]` so later
  features can attach to it. Tool numbers are now: 6 note, 7 colour.
- **Shapes, pins and threads.** A note may carry `shape` (`square` is the default and not stored;
  `rounded`, `oval`, `diamond`, `hexagon`), which only changes its outline and the part of it the
  text may use (`SHAPE_INSET`); the text is centred. A `pin` item `{x, y, color, shape?}` is a bare pin (`shape` one of `PIN_SHAPES`, absent for round; only its head is drawn differently). An
  `arrow` item `{from, to, color, heads}` ties the pin of the item `from` to that of `to` (any item
  with a pin: picture, link, note or pin item; `pinPoint`); `heads` is `none`, `start`, `end` or
  `both`. Nothing about its shape is stored: every client draws the same quadratic curve that hangs
  below the straight line, sagging more the longer it is (`threadCurve`), with a shadow like the
  other pinned things. It is re-drawn when either pin changes (the node's signature includes the
  stamps of both) and follows a pin while it is dragged. An author whose thread lost a pin takes it
  down (`dropLooseThreads`, not an undo step). Selecting (a click on your own note, pin or thread)
  shows a bar over it to change shape, colour or heads; only the owner sees it. Tool keys: 6 note,
  7 pin, 8 thread, 9 colour.
- **Pins on things.** A `pin` item may carry `on` (the id of a note, picture, link or sticker) and
  `u`, `v`: where it is on that item as fractions of its width and height from its centre, in
  the item's turned frame. Its place is derived (`pinPoint(item, get)`), not stored: moving,
  turning or scaling the item moves the pin and re-draws the threads (node signatures include the
  host's stamp; `followThreads` does it during a drag). `x`, `y` are only where it was put. A pin
  is attached when added or moved (Shift+drag) over such an item, the topmost one; moving it off
  detaches it. If the item goes, its pins go (their author takes them down quietly, then the threads
  tied to them). Drawing order: items by stamp, then threads, then pins, so a moved note never covers
  its pins.
- **Elements on elements.** A note, picture or link may carry `on`, `u`, `v` (where its centre is on
  the element it is attached to, as fractions of that element's width and height, in its turned
  frame) and `dr` (how much more turned than it). Dragging one by its pin (`pinAt` hit on its own
  pin) and dropping it over another element's box attaches it (never to what is on it); dragging
  by its body only updates its place on its element. When an element changes, what is on it
  (`followers`, recursively) is moved with it in the same gesture, skipping what is locked against the
  person; during the drag the preview redraws them, a ring is drawn around the pin (not the element) and the
  element it would attach to is outlined dashed (`showPinDrag`; a bare pin being dragged outlines
  the element under it the same way, with no ring). The drawing order puts an element after the one it is
  on, then threads, then pins. The resize grip (`gripOf`) is inside each shape, per `GRIP_REACH`.
- **Pulling a thread from a pin.** With Shift, a capture-phase `pointerdown` on the container finds the pin
  (`pinAt`, by geometry, so it wins over whatever else is under the pointer), switches to the
  thread tool for the gesture and stops the event; on release the previous tool returns, and
  a click without a drag selects the pin (or note). Not with the pen and eraser, nor without Shift: a plain drag moves the pin, like any item, and a plain click selects it (the pin wins over what lies on it).
- **Clear drawings** removes `ink`, `text` and `sticker` items of everyone (`clearDrawings`, host
  command `clearDrawings`), not an undo step; `clear` still removes everything.
- **Locks.** Any item may carry `lock`: absent (anybody may change, move or delete it), `owner`
  (only its author), `all` (nobody; its author may only change the lock, to unlock). The rule is the
  model's (`mayChange`, using the editor named in the new stamp), so it holds on every board: a
  forged operation is dropped on arrival, a local change throws a `WhiteboardError`. Only the author
  changes the lock. Unlocked is the default so that collaboration is easy; the bar over a selected
  element (note, pin, thread, picture, link) offers the lock to its owner. The exceptions are
  administrative: **Clear all** and a new session wipe locked items too. Another person's picture or
  file is moved by a plain drag like any element; Shift+drag copies it out: the box over each
  picture (pointer-events off) takes the pointer only while Shift is held (`.drag.shift`). A picture is resized
  from a corner grip, as notes are, because Shift is taken. A note has `fs` (font size, 9, 12 default, 18); the bar offers the three sizes of the text tool.
- **Saving.** `toSvg(box, {background, backdrop})` draws the frame (`exportArea`: the adapter's
  aspect, else the bounds of the items) with the same node builders as the screen, minus what only
  helps to use the board (hit areas, resize grips, selection); the sheet behind a board without
  video is a `foreignObject` box with its CSS, and the video frame a JPEG `<image>` (the page
  takes it: `viewer/src/save.ts`). `toPng` rasterises that SVG on a canvas (2000 px wide); if the
  browser refuses the `foreignObject` (it taints the canvas) it is retried without the sheet.
  A *board file* (`saveBoard` / `loadBoard`, JSON, `format: 'inksplat-board'`, `version: 1`) holds the
  live items, `meta` (the page's: the background of each canvas), and the pinned files as base64, so it
  is self-contained: files that never arrived or were too big only keep their picture. Loading
  adds everything as the loader's own items under new ids (threads are remapped), validated by
  `cleanItem` and the board's limits; it is not an undo step and loading twice makes a copy.
  Files are accepted back only up to 25 MB and exactly `bytes` long, and are sent to the others like
  a dropped file. A host sends the operations at once; a guest 40 a second, under the host's gate
  (50 a second). Opening a file replaces nothing: that avoids a viewer wiping a shared board.
- **Tilt and links.** What is pinned (`image` and `link` items) gets a random `rot` of at most 7
  degrees when added. A `link` item is `{x, y, size, url, rot?}` with an http(s) address only
  (`cleanUrl`); it carries no picture: every client draws the card (site name, path, tooltip with
  the whole address) from `url`, so a peer cannot show one address and open another. No page is
  fetched (a browser page cannot read other sites, and sessions have no server), so the card is
  not a screenshot. A click with the pointer tool, not at the end of a drag, opens `url` in a new
  tab with `noopener`. Links come from paste, a dropped `text/uri-list`, or `addLink()`.
- **Zoom.** Lives in the frame adapter, not in the items: `zoomAt`/`panBy` change a view
  (scale 1-8, always covering the box) that is folded into `transform()` and `clip()`, and
  applied as a CSS transform to the `content` element (the video). Drawings and picture
  therefore zoom together; cursors are sent in board units, so they are unaffected.
- **Cursors.** `cur` messages carry the sender's `tool`; receivers draw that tool's icon
  with its hot spot on the point. Avatars (`avatar` messages, a small data URL, at most
  16 000 characters) replace the name; the host re-sends known avatars to late joiners
  (`of` = owner, accepted only from the host).
- **Pointer modes.** The pointer tool has four modes (`style.pointerMode`: `cursor`, `laser`,
  `emote`, `magnify`); in `laser` and `emote` the board takes the input and nothing on it is selected or moved,
  and `cur` carries the mode (other than `cursor`) as the tool. The laser sends its points as
  `{t:'laser', id, seq, pts, pg}` (fast, lossy, like live ink); every peer draws a trail whose
  points fade after 1.2 s. Emotes are `{t:'emote', id, name, x, y, level, pg}`: `name` is one of
  `EMOTES` (built-in face stickers, so they look the same everywhere), shown where the wheel
  opened, floating up and fading over 2 s. A click on a live emote (anybody's) sends the same id
  with `level + 1` (up to 5): the larger level wins, so the emote grows for everyone and lives
  again. Neither is stored, and both pass the drawing gate like cursors. The `magnify` mode
  takes input like `cursor` and is local: a lens beside the pointer holds a copy of the
  adapter's `content()` (computed styles copied, since the lens is in the shadow root; videos
  play the same `srcObject`, so the lens shows the stream at its own resolution), remade only when
  that content's attributes change, and an SVG `<use>` of the drawing layer (`#wb-layer`), so the
  drawings in it are always current. The wheel sets its power (1.5 to 8) instead of zooming.
- **Turn queue.** The host keeps the queue (`queue` message with peer ids, accepted only
  from the host and refused by the gate when a guest sends it); guests send `turn`
  (`join`/`leave`) to the host. The host drops people who leave and can remove anyone. The
  first id has the turn: its cursor gets a larger shape and a pulsing border on the name tag or avatar. Turn requests and
  avatars pass the drawing gate even when viewers cannot draw.

### 4.3 Channels and messages

| Channel | Transport | Direction | Purpose |
|---|---|---|---|
| `$` | reliable | both | nymph control (hello, welcome, roster, refuse, locked, end, removed) |
| `wb` | reliable + fast | both | whiteboard ops, snapshots, cursors, live ink (nymph protocol); plus `avatar`, `turn` (guest to host) and `queue` (host to all), the tool in `cur`, and `laser` and `emote` (never stored) |
| `ctl` | reliable | guest ↔ host only | presenter auth and commands (4.5); never relayed |
| `stage` | reliable | host → guests | `{aspect, w, h, fps, state: live\|paused\|ended, drawing:boolean, title?}`; resent on join and on every change |

`stage.title` is optional, off by default (page titles can be private).

### 4.5 Presenter role

The host makes a second 128-bit secret, the **presenter key**, besides the room
token. The console link is `<viewer>#inksplat=<token>&presenter=<key>`; the viewer
link has no key. After joining, the console sends `{t:'auth', key}` on `ctl`
(the channel runs inside the DTLS-encrypted link to a host the sealed signaling
already authenticated). The host compares it in constant time, remembers that
peer id as a presenter, and answers `{t:'role', presenter:true|false}`. The host
stamps every sender id, so a viewer cannot pose as the console.

Presenter commands on `ctl` (accepted only from authenticated peers):
`lock{on}`, `drawing{on}`, `pause{on}`, `remove{id}`, `clear`, `end`. The
host's `accept` callback handles every `ctl` message itself and returns false, so
it is never delivered to other listeners or relayed to other viewers. More than
one console may be open (the key is the capability). `newLink` in the popup
changes the room token only; connected consoles stay.

### 4.4 Security and privacy

- The link is the permission (as in nymph). Token and presenter key only in the
  URL fragment, so GitHub Pages never sees them. The presenter key is a bearer
  secret: whoever has the console link is a presenter. The presenter can lock,
  remove a viewer, or issue a new link.
- Trackers see topic hash and IPs, not the token, video, or drawings.
- **Everything visible in the tab is shared with everyone holding the link.**
  The extension requires an explicit start action, shows a persistent
  "sharing" badge and in-page indicator, and offers *Pause* (stop sending
  video) at any time.
- Guest messages are validated, size-limited, rate-limited (50 whiteboard
  ops/s) and never touch the page DOM except through the whiteboard's
  `textContent` and named-sticker rendering.
- Video and data are DTLS/SRTP encrypted; DTLS fingerprint travels inside the
  sealed SDP.
- Star topology: only the presenter's browser learns viewer IPs (and each
  viewer learns the presenter's). The share dialog states this.

## 5. Repository, language, tooling

Answers recorded from the design session: **JS/TS, CMake only wraps it.**

```
packages/
  collab-session/      copied from nymph (JS + .d.ts), adapted per 4.1
  collab-whiteboard/   copied from nymph (JS + .d.ts), adapted per 4.2
  defaults/            tracker list, ICE servers, limits, fps presets (TS)
extension/             MV3 extension (spec/02, spec/03) — TypeScript
viewer/                static viewer site (spec/04) — TypeScript
tests/                 unit (Vitest), browser e2e (Vitest + playwright-core driving
                       Chrome), local fake tracker
CMakeLists.txt         top-level entry: target `check` calls npm; ctest runs Vitest
                       (`inksplat_add_test`); `extension`/`viewer` targets come with
                       projects 02 and 04
```

- npm workspaces, TypeScript (strict), Vitest, playwright-core driving an
  installed Chrome (also with the unpacked extension, from project 02), ESLint
  + Prettier. esbuild bundling arrives with the extension and viewer.
- The C++ skeleton (`include/`, `src/`, `app/`, `.clang-format` rules in
  `CLAUDE.md`) is **retired** in the first plan step; CLAUDE.md's C++ style,
  GoogleTest and `inksplat_add_test` sections are replaced by JS/TS equivalents
  (`inksplat_add_test` is a ctest wrapper over Vitest files). `extern/` and the
  googletest submodule are removed.
- No runtime dependencies in the shipped extension and viewer beyond the two
  copied packages (keeps the Web Store review and the Pages payload small).

## 6. Testing strategy

- Unit: framing, sealing, whiteboard merge/convergence, board-unit math,
  permission enforcement.
- Integration: host + N guests over `createMemoryNetwork` and a local fake
  WebTorrent tracker (WebSocket, port 0). No public trackers in CI.
- E2E: Playwright launches Chromium with the extension, opens a fixture page,
  starts sharing, opens the viewer in a second context, asserts video frames
  arrive and drawings sync both ways. Real NAT/TURN/public-tracker checks are
  a manual checklist (`docs/manual-testing.md`).

## 7. Open risks

1. Overlay appears in captured video — see `spec/03_tab_streaming/DESIGN.md`
   section 3; gated by plan step 1 of that project.
2. Public trackers may disappear or rate-limit; mitigated by several trackers
   plus manual codes (carried over from nymph).
3. Viewers behind symmetric NAT need TURN; v1 ships STUN only, TURN optional.
