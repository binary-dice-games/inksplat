# Specification index

One row per project. Add a row when you create a project folder; update
the status and topics as it progresses. See "spec/" in `CLAUDE.md`.

| Project | Status | Summary | Topics |
|---|---|---|---|
| [01_core_features](01_core_features/) | Implemented | Product definition, architecture, JS/TS repo setup, and the collab core copied from nymph (serverless session + whiteboard). | architecture, collab-session, whiteboard, security, tooling, testing |
| [02_presenter_extension](02_presenter_extension/) | Removed (see 06) | MV3 Chrome extension: captures the tab, hosts the session, gives the viewer and console links, popup and settings. No overlay on the page. | extension, popup, permissions, options, console |
| [03_tab_streaming](03_tab_streaming/) | In progress (capture works; load test open) | Tab capture and low-fps configurable WebRTC video; the overlay-in-video spike that led to the console design. | WebRTC, fps, bitrate, codecs (tab capture removed) |
| [04_viewer_site](04_viewer_site/) | In progress (viewer and console work; Pages deployment and version mismatch open) | The viewer app: video plus interactive whiteboard, on GitHub Pages and inside the extension; the presenter console was removed. | viewer, console, GitHub Pages, mobile, CSP, versioning |
| [05_release_pipeline](05_release_pipeline/) | Implemented, workflows untested | CI and Pages deploy (extension packaging and release removed). | CI, release, Web Store, privacy |
| [06_static_presenter](06_static_presenter/) | Implemented, manual picker checks open; start page, pause and video background superseded by 07 | The presenter as a static page: the browser's picker (tab, window, screen) as video source, host and console in one page; no extension needed. | presenter, getDisplayMedia, GitHub Pages, native apps, extension removal |
| [07_participant_streaming](07_participant_streaming/) | Implemented, manual checks open | Any participant streams their screen to the host; the host picks the one active stream, forwards its encoded frames to everyone, and a new `screen` background shows it. | WebRTC, encoded transforms, relay, getDisplayMedia, backgrounds, stage, presenter page, viewer |
| [08_remote_support](08_remote_support/) | Designed (not started) | Remote user support: an Electron app for the person helped shares their whole screen with a helper's support session and shows the helper's cursor, laser and emotes on a click-through overlay. | Electron, support mode, desktopCapturer, overlay, protocol handler, packaging, consent |
