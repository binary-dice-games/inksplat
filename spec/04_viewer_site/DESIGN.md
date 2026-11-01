# 04_viewer_site — static viewer on GitHub Pages

> **Update: the presenter console and the extension's `viewer.html` were removed; the presenter page is `present.html` on the same site (`spec/06_static_presenter/DESIGN.md`). The viewer has a Tools button that folds the toolbar away.**

Builds on `spec/01_core_features/DESIGN.md` (guest session, whiteboard) and
`spec/03_tab_streaming/DESIGN.md` section 5 (video presentation).

## 1. Purpose and scope

A static web app served from this project's GitHub Pages. Viewers open the
collab link, no install, no account, no server beyond static hosting. It joins
the presenter's session as a guest, shows the video and the shared whiteboard,
and lets them draw.

Link shape: `https://<owner>.github.io/inksplat/#inksplat=<token>`. The token is in
the fragment, so GitHub never receives it. The extension's "viewer base URL"
setting allows self-hosting the same bundle elsewhere.

Out of scope: hosting any dynamic service; presenter functions.

## 2. Page behaviour

- **Landing** (no fragment): the home page of the product: the logo (a
  light-text copy in dark mode), a short pitch, **Start presenting** (to
  `present.html`), feature cards, the three steps, and a footer with the
  licence, privacy policy, source and an **About** box (description, version
  and commit, protocol, licences and credits, after nymph's). The build fills
  in the version and protocol and copies the images from `viewer/src/assets/`
  next to the pages (and under `/v<N>/`, with the privacy policy, so relative
  links work there). The **tutorial** (`viewer/src/site/tutorial.html`, linked
  from the home page, the About box and the join form) is a static page with
  committed screenshots and GIFs in `tutorial/`, made by
  `npm run tutorial:media` from the real pages rather than drawn by hand, so
  they can be remade when the board changes; it is copied next to both home
  pages like the policy. **Invalid/expired token**: clear message.
- **Join flow**: name field (prefilled from `localStorage`) and colour; "Join"
  creates a guest `Session` with the default trackers/ICE servers. Statuses
  (`connecting`, `no-tracker`, `no-answer`, `ice-failed`, `reconnecting`,
  `host-gone`, `locked`, `removed`, `ended`) map to friendly messages; the
  manual-code fallback is offered when trackers fail.
- **Stage**: full-window `<video>` (muted, `playsinline`, `object-fit:
  contain`), black letterbox, whiteboard overlay aligned to the displayed video
  rectangle (board units from `stage.aspect`). Overlay stays aligned on window
  resize and fullscreen.
- **Placeholders**: "Waiting for presenter" (no track yet), "Presenter paused"
  (`stage.state=paused`, last frame dimmed), "Presenter ended the session".
- **Toolbar**: same components as the presenter overlay (shared code): pointer,
  pen, text, sticker/emoticon chooser, eraser, colour, undo/redo, clear. In
  pointer mode the viewer just watches. When the presenter turns drawing off,
  tools are disabled with a "Drawing disabled by presenter" note.
- **Extras**: people list (read-only), fullscreen, "fit/actual size" toggle, a
  connection quality hint from `session.stats()` (direct/relay, rtt).
- **Touch**: pointer events throughout, one-finger draw, no page scroll while a
  tool is active, two-finger scroll is not required (the stage never scrolls).
- Accessibility: keyboard-operable toolbar, visible focus, reduced-motion,
  dark scheme.

## 2b. Presenter console

The same app, opened with `#inksplat=<token>&presenter=<key>`, is the **presenter
console** (`spec/01_core_features/DESIGN.md` section 4.5). The extension bundles
the app as `viewer.html` and opens it in its own window; the same link also works
on any browser, for example a tablet with a pen.

- After joining it sends `{t:'auth', key}` on `ctl`; on `{t:'role', presenter:true}`
  the presenter panel appears. Without it (wrong key) the app behaves as a plain
  viewer and says so.
- Panel: viewers (name, colour, kick), **Viewers can draw**, **Lock**, **Pause /
  Resume**, **Clear drawings**, **End session** (asks to confirm). Commands go
  on `ctl` to the host.
- The whiteboard is never read-only for the console; its toolbar is the same.
- The console shows the shared video (a few frames per second, a little behind)
  and draws over it. A note in the panel says so: the presenter's page itself
  shows no drawings.

## 3. Hosting and build

- Source in `viewer/`; the same sources build twice: a static bundle for Pages
  (`viewer/dist`) and `viewer.html` inside the extension. Built by esbuild to a small static bundle (target < 150
  KB gzipped, enforced by a size budget check like nymph's `size_budget.json`).
- Deployed by GitHub Actions to Pages (`spec/05_release_pipeline`); one build
  per tag plus `main` as the "latest" channel.
- **Protocol compatibility.** The extension and viewer can be at different
  versions: the `hello`/`welcome` handshake carries `protocol` and `v`; a
  mismatch shows "this link needs a newer/older viewer" and offers the
  matching versioned path (`/v1/`, `/v2/`...) which Pages keeps for old
  majors.
- Security headers via `<meta>` CSP: `default-src 'self'; connect-src wss:
  'self'; img-src 'self' data: blob:; media-src blob: mediastream:`. No third
  party scripts or fonts. Referrer policy `no-referrer`.
- No analytics. `localStorage` only for name/colour.

## 4. Testing

- Unit: board-to-video rectangle math (letterbox, resize, aspect change);
  status-to-message mapping.
- E2E: Playwright desktop and mobile emulation; join via fake tracker; draw both
  directions; lock/unlock; paused/ended placeholders; invalid token.
- Size budget check in CI.
