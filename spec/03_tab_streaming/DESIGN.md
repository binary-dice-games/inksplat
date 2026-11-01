# 03_tab_streaming — tab capture and low-fps WebRTC video

> **Update: tab capture (`chrome.tabCapture`, the offscreen document and the canvas relay) was removed with the extension. Capture is now `getDisplayMedia` (`spec/06_static_presenter/DESIGN.md` section 3). The video parameters, codecs and the overlay-in-video findings still hold.**

Builds on `spec/01_core_features/DESIGN.md` (session, star topology, media
hooks in 4.1) and `spec/02_presenter_extension/DESIGN.md` (offscreen document).

## 1. Purpose and scope

Capture the shared tab's pixels and deliver them to viewers as a WebRTC video
track. The video is only a **background**: low frame rate, modest bitrate,
configurable. Drawings are not in it.

Out of scope: audio (v1), recording, simulcast/SFU, adaptive per-viewer quality
beyond what WebRTC does natively.

## 2. Capture

Chosen: `chrome.tabCapture` (design session answer), no picker.

1. Service worker calls `chrome.tabCapture.getMediaStreamId({targetTabId})`
   from a user gesture.
2. Offscreen document calls `getUserMedia({video: {mandatory:
   {chromeMediaSource:'tab', chromeMediaSourceId: id, maxFrameRate: fps,
   maxWidth, maxHeight}}})`.
3. The `MediaStream` is handed to `session.setMedia()`.

Tab capture mutes local tab audio unless re-routed; since v1 has no audio, the
tab is captured with `audio:false`, which leaves the presenter's sound alone.
Capture keeps working across navigations of the same tab. Resolution follows
the tab's viewport size and changes when the presenter resizes the window; the
`stage` message carries the new `aspect`.

## 3. The overlay-in-video problem (resolved by design)

`tabCapture` records the rendered tab, **including anything injected into it**.
The spike (`PLAN.md` step 1) measured: the overlay is in 100% of frames; Element
Capture is not available for `chrome.tabCapture` tracks (`restrictTo` and
`cropTo` are absent, and a `RestrictionTarget` cannot reach the offscreen
document over runtime messaging); hiding the overlay for each captured frame
works but hides it ~34 ms per frame, a visible blink. Chrome documents Element
Capture as self-capture only ("for now"), and Zoom/Teams avoid the problem with
an OS capture-exclusion flag that browsers lack.

**Decision:** inksplat injects nothing into the shared tab. The presenter draws in
the console (a separate window), so the video is always clean. See
`spec/02_presenter_extension/DESIGN.md` section 1. Consequence for capture: the
console must never be the shared tab (the extension refuses it).

Capture details learned in the spike, used below:

- Without size constraints tab capture delivers a cropped 800x600 frame. The
  constraints (`maxWidth`/`maxHeight`) must give the tab's own aspect: the tab
  size fitted inside the limit, never upscaled, re-applied on resize.
- A captured tab stays `visible` and keeps producing frames while another tab is
  in front, so the presenter can work in the console.
- Automation can capture without the activeTab click using
  `--allowlisted-extension-id=<id>`.

## 4. Encoding and bandwidth

Defaults and bounds live in `packages/defaults` and the options page.

| Parameter | Default | Range | Applied via |
|---|---|---|---|
| Frame rate | 3 fps | 0.5–15 | `maxFrameRate` on capture + sender `maxFramerate` |
| Max resolution | 3840×2160 (never upscale) | 640×360–3840×2160 | capture constraints and the relay canvas |
| Max bitrate | 1500 kbps | 100–8000 | `RTCRtpSender.setParameters().encodings[0].maxBitrate` |
| Content hint | `detail` | `detail`/`text`/`motion` | `track.contentHint` |

Notes:

- `contentHint = 'detail'` and `degradationPreference =
  'maintain-resolution'` keep text legible at low fps.
- A static page produces almost no frames: `getDisplayMedia` delivers a frame only when the
  surface changes. The encoder spends the first frame after a change at a low quality (the
  bits went to the motion) and, with nothing after it, never sharpens it: text stayed blurry
  for good (measured at 3840x1822, VP8 or AV1 at 1.5 Mbit/s: one frame at QP 80 to 100, then
  none). The **still refresh** (`viewer/src/still-refresh.ts`) repeats the last frame every
  333 ms for 12 s after each change, between the capture and the senders
  (`MediaStreamTrackProcessor` -> worker -> `MediaStreamTrackGenerator`); VP8 then reaches
  QP 15 in about 6 s. The loop runs in a worker because the sharing page usually sits behind
  the shared window, where its timers are throttled. Firefox and Safari send the capture as
  it is. (The extension's canvas relay used to repeat frames, which is why
  `spikes/video-quality/` measured refinement over 10 s.)
- **Sharpness (measured, `spikes/video-quality/`):** the viewer's text must not be resized
  or smeared. On a 1920×1080 text scene, error on the text pixels against the original
  (0 is perfect; mean grey-level difference):
  - sent at 1440p→720p or 1440p→1080p: 51 to 71, and it never improves, because the detail
    is gone before the encoder (the first default, 1280×720, did this to every screen
    bigger than 720p);
  - at the screen's own size: 1.2 to 2 once still, whatever the bitrate above ~600 kbps
    (a still page costs few bits; the bitrate cap is for moving content);
  - codec, 2000 kbps, 1 s / 10 s after the page went still: VP8 2.7 / 1.8, VP9 7.2 / 1.75
    (starts soft, refines slowly), AV1 1.9 / 1.6, H.264 1.2 / 1.2 (constant);
    AV1 sends 130 KB where the others send 360 to 400 KB, and costs 4 ms per 1080p frame
    (13 ms at 4K), H.264 9 and 27 ms.
  So: the capture is asked for device pixels (tab size times the display's pixel ratio,
  capped by the settings, never more because Chrome upscales to the limit), the relay
  never shrinks below the settings' maximum, and the codec order is AV1, H.264, VP9, VP8.
- **Codec order must be set on the viewer's offer.** The sender uses the first codec of the
  offer that it supports; the host's answer order is ignored (a sender preference alone left
  every session on VP8). The viewer passes `videoCodecs` to `createSession`; the host also
  sets the preference on its answer. Tested through the receiver's statistics.
- Budget rule of thumb: uplink = viewers × bitrate while the content moves, so 10 viewers
  at 1500 kbps ≈ 15 Mbps at worst; a still page needs a small fraction. The options page
  shows the worst case live and warns above ~4 Mbps.
- Pause: `track.enabled=false` / replace sender track with `null`; `stage.state`
  becomes `paused` so viewers show "presenter paused" rather than a frozen
  frame. Resume restores and requests a keyframe.

## 5. Viewer-side contract

Viewers receive a `MediaStream` through `session.on('track')` and attach it to
a muted `<video playsinline>`. Presentation rules (implemented in
`spec/04_viewer_site`): letterbox with `object-fit: contain`; the whiteboard
adapter maps board units to the displayed video rectangle; on a `stage.aspect`
change the rectangle is recomputed.

## 6. Failure behaviour

- Capture ends (tab closed, `track.onended`): share ends, `stage.state=ended`.
- Per-viewer congestion: WebRTC lowers bitrate/fps itself; the host does not
  disconnect slow viewers. Data channels are independent of video.
- Viewer without video yet: whiteboard still works over a blank background with
  a "waiting for presenter video" message.

## 7. Testing

- Spike harness with pixel-diff (frames with and without overlay).
- Playwright e2e: fixture page animating a counter; viewer asserts frames
  arrive and fps is within configured bounds (±1) using
  `getStats()` (`framesPerSecond`, `bytesSent`).
- Bitrate cap test: measured outbound bitrate ≤ cap + 20%.
- Pause/resume and resize tests assert `stage` transitions.
