# 07_participant_streaming - anyone can stream, the host picks what is on screen

Builds on `spec/01_core_features/DESIGN.md` (star session, board units, `stage`, section 4.1
media hooks), `spec/03_tab_streaming/DESIGN.md` (video parameters, codecs) and
`spec/06_static_presenter/DESIGN.md` (the presenter page, display capture, backgrounds per
canvas, a board without video). Where this document and those disagree, this one wins.

## 1. Purpose and scope

Today only the host (presenter) shares a video, chosen on the start page, and a session either
has video for its whole life or none. This project makes video a thing anybody does at any time
during a session:

- Every participant (host and guests) has a **Share screen / Stop sharing** button. It opens the
  same browser picker the host uses today (`startDisplayCapture`, `spec/06` section 3).
- Several participants may offer a stream at once; **one stream is active** at a time. The host
  picks it from a list of the streams on offer (or none).
- A new canvas background, **screen**, shows the active stream, or black when none is active.
- The star stays: a guest sends its stream only to the host; the host sends only the active
  stream to everybody. To keep latency low the host **forwards the encoded frames of a guest's
  stream as they arrive**: no decoding, no re-encoding, no jitter buffer on the relay path.
- The start page only starts a session. Every session starts as a board; streams come and go
  inside it.

Out of scope: audio, more than one stream shown at once (picture in picture, grids),
simulcast or per-viewer quality, phones as senders (no `getDisplayMedia`; the button is hidden
there, section 7), recording.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Stream** | One participant's display capture, identified by its owner's peer id (one stream per participant). |
| **Offered** | The owner is capturing and the host knows; nothing is sent unless the host asks (section 5.3). |
| **Previewed** | Sent to the host only, so the host can look before showing it. At most one at a time. |
| **Active** | The stream on the screen background, sent to everybody. At most one per session. |
| **Uplink** | A guest's send-only video transceiver to the host (new). |
| **Downlink** | The host's send-only video transceiver to each guest (exists today). |

## 3. User experience

### 3.1 Start page

One action: **Start session** (name, colour, "viewers may draw", Settings, as today). The
**Start sharing** and **Start a board without video** buttons go; the notice about what the
picker exposes moves to the share button (section 3.2). The backup dialog (Resume / Start new)
is unchanged.

### 3.2 Share button (everyone)

In the bar of both pages: **Share screen**. Pressing it opens the picker (the click is the user
gesture the picker needs). Once a surface is picked the button reads **Stop sharing**, and a
small status shows the stream's state for its owner: *Offered* ("the presenter can show it"),
*Previewed by the presenter*, or *On screen for everybody*. The page warns about a whole-screen
share as today (`surfaceWarning`). The browser's own "Stop sharing" and closing the shared window
end the stream like the button does. Starting and stopping can happen any number of times.

The first press in a page shows, once, the notice "Everything in what you share can be shown to
everyone in this session" with **Continue** / **Cancel**.

### 3.3 Streams list (host only)

A **Screen** section in the host panel:

- One row per offered stream: owner name and colour, surface kind (tab, window, screen) and size,
  with **Preview** (toggle) and **Show**. The host's own stream is listed like any other (marked
  "you"); it previews locally at no cost.
- A **None** row: no active stream (the screen background goes black).
- The active row is highlighted; **Show** on another row switches.
- The preview appears as a small video in the panel.

**Show** on a previewed stream ends its preview (it is on the screen now). When a stream is
active and the canvas the host is on does not show **screen**, the panel
offers a one-click "Show the screen on this canvas" (**Show the screen on this canvas**; it does
not change backgrounds by itself, the host may want the stream on another canvas).

Automatic choices (the host can always change them):

- The host's own new stream becomes active when nothing is active (the host pressed the button,
  the intent is clear).
- A guest's stream never becomes active by itself; the host gets a toast "Ana offers a screen"
  with **Preview** and **Show**.
- When the active stream ends (owner stops, leaves or is removed) the active stream becomes
  none; there is no automatic fallback to another stream.

### 3.4 Screen background

`screen` joins whiteboard, blackboard, wall and cork in **Background of canvas N** and replaces
today's `video` value. It shows the active stream's video letterboxed (object-fit contain) in the
board frame on black, or plain black when none is active (with a faint "Nothing is being shared"
for the host only). The `<video>` and the sheet stay in the `#zoom` element, so zoom and layout
work as today.

Default backgrounds: canvas 1 `screen`, then whiteboard, blackboard, wall, cork. Canvas 1 being
black at the start is the cost of "share and it shows" working with no extra click. (Open
question 1.)

### 3.5 Frame aspect

Board units depend on the frame's aspect (`spec/01` section 4.2). Today the aspect follows the
capture; with streams switching, the drawings would jump at every switch. So the **board frame
has a fixed aspect for the whole session**: 16:9 (`STAGE_ASPECT`), and each stream is letterboxed
into it. Boards opened from a file keep their own aspect if they carry one. (Open question 2.)

### 3.6 Owner's own view

The owner of the active stream is not sent its own stream back (it would only waste its
downlink): its screen background shows its local capture (`srcObject` = its own stream), as the
host page does today for the host. Everybody else gets the relayed copy.

## 4. Architecture

```
 guest A (source) --uplink: encoded AV1--> HOST --downlink, same frames--> guest B, C, ...
                                            |  (encoded transform: no decode, no jitter buffer)
                                            +--> decoder (only for the host's own view)
 guest D (offered, not asked) --uplink paused (encodings active:false)--> HOST
```

### 4.1 Transceivers: no renegotiation

Links are negotiated once (the guest offers, the host answers; there is no renegotiation code in
`collab-session`, and adding it would be the largest change). So every guest offer carries **two**
video transceivers from the start:

1. `recvonly` (downlink), as today;
2. `sendonly` with no track (uplink), identified by its `mid` order (second video m-line).

The host answers the first `sendonly` (as today) and the second `recvonly`. Starting a stream is
then `replaceTrack(track)` on the uplink sender and stopping is `replaceTrack(null)`; nothing is
renegotiated. The host's own capture goes to the downlinks the same way it does today.

The second m-line changes the offer shape, so the protocol id becomes `inksplat/2` (the handshake
refuses mismatches; one Pages site serves both pages, so a mismatch is a stale tab).

### 4.2 The relay: encoded frames, forwarded

WebRTC in a browser does not expose RTP packets, but it does expose **encoded frames** through
encoded transforms. Frames reach a receiver's transform once the packets of a frame are
assembled, before the jitter buffer and the decoder, and leave a sender's transform to the
packetizer and pacer: the closest the platform comes to forwarding packets, with no decode,
encode or buffering delay. What the spike (plan step 1, Chrome 153) found decides the API:

- `RTCRtpScriptTransform` accepts frames written from another peer connection's receiver and
  **never sends them** (no packets leave). Chrome's older `createEncodedStreams()` (the peer
  connection needs `encodedInsertableStreams: true` from its construction) sends them and they
  decode. So the relay uses `createEncodedStreams()` on the host's peer connections, in the page.
- A downlink needs a track for frames to flow after a source switch: a sender without one
  sends the packets but the viewer stops decoding. The placeholder is a
  `MediaStreamTrackGenerator` that is never written, so it costs no encoding and needs no
  timer.
- Every source has its own random RTP timestamp base, and a viewer drops frames whose
  timestamp jumps back: about one switch in two froze before each output got its own offset,
  so each output's timestamps go on from the last one sent (`rtpTimestamp` may be changed in a
  frame copy; the SSRC and payload type may not, and need not be).
- Each output (viewer) waits for a key frame of the source before it gets anything, after a
  switch and when it joins.

On the host (`MediaController` in `collab-session.js`, `FrameRouter` for the routing):

- **Receiver side** of every uplink: each frame of the *active* stream is copied (with the
  output's timestamp) to every downlink except the source's own, then written on to the host's
  own decoder (its screen and preview). Frames of a previewed stream go only to the decoder.
- **Sender side** of every downlink: while the host's own stream is the source its own encoder's
  frames pass (with the output's timestamp); otherwise its track is the placeholder and the
  forwarded frames are written instead; with no source nothing is written.
- **Codec per link.** Forwarded frames decode only where the source's uplink and the viewer's
  downlink use the same codec. The host picks each transceiver's codec: the first of
  `forwardCodecs` (inksplat: AV1, H.264, VP8; `packages/defaults` `FORWARD_CODECS`; without
  it, the guest's own order) that the guest's offer lists and the host's browser can. The
  **uplink** gets it by an answer with that codec alone (with its retransmission and
  error-correction helpers; for H.264 packetization mode 1 and constrained baseline first): the
  guest sends with the first codec of the answer. The **downlink** cannot: Chrome sends with
  the first codec of the guest's offer whatever the answer lists (tested), so once negotiated
  the host sets `encodings[0].codec` on the sender; where that fails the router goes by the
  codec really sent (the offer's first). A downlink whose codec differs from the shown source's uplink
  (say a Safari viewer without AV1 while a Chrome guest shares in AV1) **re-encodes**: its
  sender takes the source's decoded track and the router passes that sender's own frames
  (`FrameRouter.reencodes`), asking that sender for a key frame when it starts. Tried in Chrome
  with AV1, H.264, VP9 and VP8 (`tests/e2e/streams.test.ts`): source switches and late joiners
  decode, with no key frame requests. The host's own stream uses each link's codec.

**Fallback** (no `createEncodedStreams`, `RTCEncodedVideoFrame` or `MediaStreamTrackGenerator`:
Firefox and Safari as hosts, or `forwardFrames: false`): the host attaches the received track to
the downlinks and the browser decodes and encodes it again. It works everywhere and costs one
decode, one encode per link and a jitter buffer. `Session.relayMode` says which
(`forward` | `reencode`), and the log has a `video relay:` line.

### 4.3 Key frames

A decoder needs a key frame to start: when a viewer joins, when the active stream changes, and
after it lost packets (its browser sends a PLI to the host's sender). The forwarding host cannot
make the source's encoder produce one, so it asks:

- **Asking a guest**: the session control message `{t: 'key'}` to the source, which toggles its
  uplink encoding off and on (`setParameters`): Chrome then sends a key frame.
  `generateKeyFrame()` is not implemented in Chrome 153 and `sendKeyFrameRequest()` belongs to
  the script transform API that cannot forward (4.2). **Asking the host's own encoders**: the
  same toggle on its downlink senders.
- `FrameRouter` asks when an output starts waiting (a join, a switch, the peer becomes known),
  at most once per 500 ms, and again every 500 ms while an output still waits, at most 20 times
  in a row; one request covers all outputs.
- **Losses**: a viewer's PLI never reaches the host's code with `createEncodedStreams`, so while
  a guest's stream is forwarded the host reads the PLI and FIR counters of its downlink senders'
  stats once a second and asks the source when one grew. A lossy viewer can thus cost the source
  a key frame per 500 ms at most.

### 4.4 Rate and quality

Without transcoding the source's encoder serves everybody: its rate follows its own uplink to
the host, capped by the **host's** video settings (frame rate, bitrate, size limit, content hint;
`spec/03` section 4), which the host sends to the source in the `send` command. A viewer on a
slower link than the source's loses frames and asks for key frames (coalesced, 4.3); the frame
rate is low by design (`spec/03`), so this stays within the bitrate cap. Per-viewer adaptation
would need simulcast or transcoding and is out of scope. The host's own stream keeps today's
per-link encoders.

### 4.5 One encoder for the host's own stream

Before, the host's own stream had one encoder per viewer: N encodes of the same picture, which
at 4K and 10 viewers is most of a CPU in software. With forwarding and `forwardCodecs` the host
encodes it once (`SharedEncoder`) and the router forwards those frames, like a guest's, to every
viewer whose downlink uses that codec; a viewer on another codec keeps its own encoder fed with
the stream (`reencodes`).

- **The encoder** is a connection of the page to itself: the sending side's encoded frames go
  to the router and on to the receiving side, which decodes them and shows them nowhere.
  Measured: a receiving side that drops the frames asks for a key frame every 0.4 s, and a
  sending side that drops them stays at the start bitrate (~280 kbit/s, no feedback); a
  decoder costs far less than an encoder. The router uses it once connected (`reset`: every
  output waits for its key frame); until then each link encodes on its own.
- **Codec**: the first of `forwardCodecs` the browser can send and receive. The presenter page
  orders `FORWARD_CODECS` with the codecs this machine encodes in hardware first
  (`mediaCapabilities.encodingInfo`, `powerEfficient`; `viewer/src/codec-choice.ts`), so a Mac
  without AV1 hardware encodes in H.264 on its media engine. The page cannot force a hardware
  encoder: the browser picks it for the codec. `Session.encoderInfo()` and the log
  (`shared encoder: ...`) say which it took.
- **Rate**: one encoder serves everybody, as for a guest's stream (4.4): capped by the
  settings, not adapted per viewer; a viewer that loses frames asks for a key frame (read from
  the downlink senders' PLI counters, as for a guest).
- `sharedEncoder: false` (session option) keeps one encoder per link.

## 5. Protocol

### 5.1 Channel `screen` (reliable)

| Message | Direction | Meaning |
|---|---|---|
| `{cmd: 'offer', surface, w, h}` | guest -> host | I am capturing (surface `browser\|window\|monitor`). Repeated on size change and on a new link to the host. |
| `{cmd: 'withdraw'}` | guest -> host | I stopped. Also implied when the guest leaves (a viewer page closes its session on `pagehide`, so that is at once). |

What the host asks of a guest's uplink is not app data but session control, next to `hello`
and `removed` (`collab-session`):

| Control message | Direction | Meaning |
|---|---|---|
| `{t: 'up', active, fps, maxBitrate, scale, contentHint}` | host -> one guest | Send on your uplink (`active`) or not, with these limits (`Session.uplinkParams`). |
| `{t: 'key'}` | host -> one guest | Send a key frame now (4.3). |

The host's `accept` filter (`ShareHost.accept`) takes `screen` messages itself, checked
(`cleanScreenMessage`: only the two shapes above, sizes within limits, from a guest it knows by
the id the session stamped), and returns false: they are never delivered elsewhere nor relayed,
even when a guest sends them to everybody. A guest's `offer` gives it no power: only the host's
`up` makes its uplink carry anything, and only the host chooses the active stream.

### 5.2 Stage

`Stage` (`packages/defaults/src/index.ts`) changes:

- `video?: false` goes (every session is the same kind).
- `backgrounds` entries: `screen` replaces `video`; a stage or board file with `video` is read as
  `screen` (`cleanCanvasBackground`).
- New `screen?: {owner: string, name: string, w: number, h: number}`: the active stream, absent
  when none. Viewers use `owner` to know whether it is their own (3.6) and to show "Ana is on
  screen"; `w`/`h` lay out the letterbox before the first frame.
- `aspect` is the fixed frame aspect (3.5), no longer the capture's.
- `state` keeps `live | ended`; `paused` goes (choosing **None** is the pause).

### 5.3 Who sends what

| Stream state | Owner's uplink | Host downlinks |
|---|---|---|
| Offered | track attached, encoding `active: false` (nothing on the wire; offers carry the uplink with `active: false` from the start) | - |
| Previewed | `active: true` | - |
| Active | `active: true` | forwarded frames, except to the owner |

Keeping offered streams paused bounds the host's downlink bandwidth to two incoming streams
(active + preview) however many people offer, and nobody's screen leaves their machine before
the host asks. Switching from offered to sending costs one message round trip and one key frame.

## 6. Components

| Piece | Where | Change |
|---|---|---|
| `MediaController`, `FrameRouter` | `packages/collab-session/collab-session.js` (nymph copy) | Uplink transceiver in guest offers; host receives uplinks; forwarding of encoded frames; `up`/`key` control; recorded in the header |
| `Session` API | `collab-session.d.ts` | New calls below |
| Stage, `screen` channel | `packages/defaults` | `screen` background, `Stage.screen`/`preview`, fixed frame, `cleanScreenMessage`, `inksplat/2` |
| `ShareHost` | `viewer/src/share-host.ts` | Streams list, active / preview state, `screen` messages, what each guest is asked to send, stage |
| Share button (both pages) | `viewer/src/share-button.ts` | Button, notice, picker, owner status |
| Backgrounds | `viewer/src/sheet.ts`, `viewer/src/model.ts`, `viewer/src/save.ts` | `screen`, black fill, fixed aspect, saved pictures letterboxed |
| Pages | `present.ts`/`.html`, `main.ts`/`index.html` | Start page reduced, share button, host Screen panel, the screen shown from the right source |

`Session` API as built (TSDoc in the d.ts):

```ts
// guest
setUplink(stream: MediaStream | null): void;    // offered on the uplink, sent only when asked
// host
setRelay(source: string | null): void;          // a guest's id, the host's own id, or nothing
uplink(peerId: string): MediaStream | null;     // a guest's uplink, for the host's own view
uplinkParams(peerId: string, p: UplinkParams): void; // {active, fps, maxBitrate, scale, contentHint}
readonly relayMode: 'forward' | 'reencode';
// createSession option
forwardFrames?: boolean;                        // default true (tests force the fallback)
```

`setMedia(stream)` stays the host's own capture; until `setRelay` is called it is the source,
so code that only calls `setMedia` (nymph's tests, `room.html`) behaves as before. `ShareHost`
calls `setRelay(null)` at once and then follows the active stream. No events were needed: the
host learns of offers from the `screen` channel and key frames are handled inside the session.

### Why the relay lives in the session package

The forwarding has to be set up when the peer connections and transceivers are made (the
`encodedInsertableStreams` flag at construction, `createEncodedStreams()` before any frame),
which only `MediaController` sees; the routing (`FrameRouter`) is exported from the same file so
it is unit tested with fake frames. The copied file stays the only place that knows about
transceivers.

## 7. Platform notes

- Picker: desktop Chrome, Edge, Firefox, Safari. Phones and tablets have no `getDisplayMedia`:
  the share button is hidden there (feature check, not user agent), they still watch and draw.
- Forwarding needs Chrome's `createEncodedStreams()` (4.2) on the **host** only; sources and
  viewers send and receive plain AV1, H.264 or VP8 (or, with the fallback, any codec). A Firefox or Safari
  host re-encodes. Whether their `RTCRtpScriptTransform` can forward between peer connections
  was not tested.
- Background throttling: the relay is event driven (frames arrive, frames are written); no timers
  on the frame path, in line with `spec/06` section 3.

## 8. Security and privacy

- A guest's screen leaves its machine only after it picked a surface **and** the host asked for
  it (preview or active); the owner always sees which (3.2). The host sees a preview before
  showing it to everyone.
- The host stays the only one who decides what everyone sees; guests cannot set the active
  stream, backgrounds or relay anything.
- The owner can stop at any time and the host can switch to None or remove a participant
  (removal withdraws its stream).
- Forwarded frames are opaque bytes to the host's code: it never parses them beyond the key
  frame flag in the metadata.
- Media stays DTLS-SRTP encrypted per link; the host can see every stream it relays, as today it
  sees every drawing.

## 9. What changes for existing features

- **Pause / Resume** go; **None** in the Screen list replaces them.
- **Share again** goes; Stop sharing + Share screen replace it, for anyone.
- **Start a board without video** goes; every session starts that way.
- Video settings (frame rate, bitrate, size, codec, pointer) stay host settings; for a guest's
  stream they travel in `send` (pointer is the owner's own: it applies at the owner's picker).
- Save as PNG/SVG of a `screen` canvas draws the current frame of the active stream (as `video`
  does today) or black.
- Board files: `settings.json` backgrounds with `video` read as `screen`; the format version
  stays 1.

## 10. Testing

Unit (Vitest): `screen` message cleaning and the host's accept filter; `ShareHost` stream state
(offer, preview, show, withdraw, leave, remove, host's own stream auto-active); stage with
`screen`, `video` read as `screen`, defaults; relay logic with fake frames (forward to all but
the source, drop until key frame on switch, key frame request coalescing, mode per link).

Browser (Chrome, fake tracker, `getDisplayMedia` replaced by canvas streams with distinct
colours, as in `spec/06` section 7): a host and two guests; guest A shares, the host previews and
shows it, guest B sees A's colour on a screen canvas and A sees its own; switching to the host's
stream and to None (black); A stops and the screen goes black; a guest joining late gets a
picture (key frame path); the forwarding mode is `forward` with transforms and `reencode` when
forced off, and both deliver video. A latency check: frame stamps drawn into the canvas source
are read back at guest B and compared between forward and reencode (forward must not be slower).
As built, the browser cases are `tests/e2e/streams.test.ts` (session level, both modes, late
joiner, nothing sent before asked) and `tests/e2e/participant-streaming.test.ts` (the built
site); the latency comparison was not automated (frame clocks in a headless browser are too
noisy for a stable bound) and is on the manual checklist.

Manual (`docs/manual-testing.md`): real picker on each desktop OS, two networks, a lossy viewer
(key frames coalesced, others unaffected), Firefox and Safari as host.

## 11. Risks and open questions

Risks, as settled by the spike (4.2, 4.3) and still open:

- Chrome may retire `createEncodedStreams()` for `RTCRtpScriptTransform` before the latter can
  forward between peer connections; `tests/e2e/relay-spike.test.ts` checks the browser's
  behaviour, and the fallback keeps sessions working.
- The toggle that forces a key frame is a Chrome behaviour, not a contract; the retries hide a
  missed one, at the cost of a slower switch.
- Untested by hand: a host page in a background tab while forwarding (the path has no timers
  except the once-a-second loss check), real networks with loss.

Open questions (default in brackets, used unless the user decides otherwise):

1. Canvas 1 defaults to `screen` (black until something is shown). [yes]
2. Fixed 16:9 frame for every session; alternative: the first active stream sets the aspect and
   later ones letterbox. [fixed 16:9]
3. Should the host be able to ask a guest to stop sharing (rather than just not showing it)?
   [no: the host can show None or remove the guest]
4. Should offered streams send a 1 fps thumbnail so the list has pictures without a preview?
   [no: bandwidth and privacy; Preview is one click]
