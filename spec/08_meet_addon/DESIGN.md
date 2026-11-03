# 08_meet_addon - inksplat as a Google Meet add-on

Builds on `spec/01_core_features/DESIGN.md` (star session, rendezvous, section 4.1 media hooks),
`spec/06_static_presenter/DESIGN.md` (display capture) and `spec/07_participant_streaming/DESIGN.md`
(streams, host relay, `screen` background). Those stay as they are; this project only changes how
peers **find each other** and where the pages **run**. Where documents disagree, this one wins
for the Meet case.

## 1. Purpose and scope

Inside a Google Meet call, inksplat replaces Meet's own screen sharing: someone shares a tab,
window or screen and everybody draws on it. Meet's SDK (the **Meet add-ons SDK**, web SDK
`window.meet.addon`) replaces the WebTorrent trackers and the invite link:

- Nobody copies a link or QR code. Starting the add-on in the call starts the session; everybody
  who opens the add-on joins it.
- Video is unchanged: the star of spec 07. The session host receives every offered stream,
  forwards the active one's encoded frames to the other participants over WebRTC links the
  pages open themselves. Meet carries only the small signaling messages, never video.
- The board, tools, streams list and `screen` background are the existing ones, in an iframe.

Out of scope: Meet's native audio/video (untouched), recording or captions, Meet Live Streaming,
Chat/Slack-like integrations, Google sign-in or the Meet REST API (the add-on needs no OAuth
scope), host hand-over when the host leaves (section 8), mobile Meet apps (add-ons run in the
browser app only), and the reverse flow where a user shares in Meet and the add-on is offered
(`exposeToMeetWhenScreensharing`; a possible later project).

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Activity** | The Meet add-on's shared session in one meeting (`startActivity`). One per meeting. |
| **Starter** | The participant who starts the activity; becomes the inksplat **host**. |
| **Starting state** | Meet's `ActivityStartingState`: data every participant reads when joining the activity. Carries the room token. |
| **Co-doing channel** | Meet's `CoDoingClient`: broadcasts a byte array to every participant running the activity. Used as the rendezvous transport. |
| **Main stage / side panel** | The two Meet iframes. Separate documents, each its own JS context. |
| **Channel rendezvous** | New transport-agnostic rendezvous in `collab-session` (section 5.1). |

## 3. User experience

1. Anyone opens **Activities** in Meet and picks inksplat. The side panel opens with one
   button, **Start inksplat for everyone**, and a short notice ("Everything you share can be
   shown to everyone in this call").
2. Pressing it calls `startActivity` with the main stage URL. Meet notifies all participants;
   each who accepts gets the **main stage** loaded with the inksplat board. The starter's page is
   the presenter page (host); the others' is the viewer page (guest). No start page, no name
   form: the name and colour default from Meet (open question 1).
3. In the main stage everyone has the existing **Share screen** button and the host the Screen
   list (spec 07 section 3). The board background `screen` shows the active stream.
4. Participants who join the call later and open the add-on join the running session.
5. The side panel after start shows status only: connection state, participant count, a
   **Leave** button and, for the host, **End for everyone**. Host controls stay in the main
   stage page, where they are today.
6. If the host closes the main stage or leaves the call, the session ends for everyone: guests
   see "The presenter left. Start inksplat again to continue."

The standalone site (link, QR code, trackers) is unchanged and independent.

## 4. Architecture

```
Meet call (browser tab)
 +- side panel iframe (side-panel.html) --frame messages--+
 +- main stage iframe (main-stage.html)  <----------------+
        |  owns the Session (host or guest)
        |  Meet SDK: starting state, co-doing channel
        v
  Channel rendezvous  --sealed offers/answers--> Meet co-doing broadcast --> other participants
        |
        +-- WebRTC data + video links, star around the host (spec 01, 07), peer to peer
```

### 4.1 One owner of the session

The main stage and side panel are separate documents. The **main stage owns the session**
(it hosts the video and the board). The side panel is a thin view fed through the SDK's frame
messages (`notifySidePanel` / `notifyMainStage`). If a participant never opens the main stage
(for example declines it), they are not in the session.

### 4.2 Roles and the room token

- The starter generates the room token (`newToken()`) and the presenter key, and calls
  `startActivity` with `additionalData` (starting state) carrying only the token and the
  protocol id. The **presenter key never leaves the host's page**: only the host's page may
  run host controls, so the Meet case does not use a console link at all.
- Everyone else reads the token with `getActivityStartingState()` and creates a `guest`
  session with it.
- The token in the starting state is visible to every participant of the activity, which is
  exactly the audience of the call. It is not a URL fragment, so Pages never sees it
  (spec 01 section 4.4 holds). It is never logged.
- A second `startActivity` in the same meeting joins the running one (Meet allows one
  activity); if the first host's page is gone the new starter's token wins and the session
  restarts (section 8).

### 4.3 Why a rendezvous and not a new link type

`collab-session` already separates **finding** peers (rendezvous: trackers, manual codes,
BroadcastChannel) from **linking** them (WebRTC). Everything sent through a rendezvous is
sealed with keys derived from the token, so the carrier learns nothing. Meet's co-doing channel
is just another carrier: a broadcast of opaque bytes. Reusing the abstraction means the star,
the uplink/relay of spec 07, security checks and tests are unchanged.

## 5. The channel rendezvous

### 5.1 Contract (in `packages/collab-session`)

A new `RendezvousSpec`:

```ts
{ kind: 'channel'; transport: SignalTransport; gatherMs?: number; retryMs?: number }

interface SignalTransport {
  /** Broadcast one text message to every other participant. Rejects if it cannot. */
  send(text: string): Promise<void>;
  /** Subscribe to messages from others (own messages are ignored if echoed). Returns unsubscribe. */
  subscribe(listener: (text: string) => void): () => void;
}
```

The rendezvous must live in the copied `collab-session.js` because `makeOffer`/`makeAnswer`
and the link wiring are module-private (as for `ManualRendezvous`). The change is recorded in
the file header and `NOTICE`. The transport itself is written by the embedder
(`viewer/src/meet/`), so `collab-session` stays free of Meet code.

### 5.2 Messages and flow

Same offer/answer exchange as `TorrentRendezvous`, over the broadcast:

- **Guest -> all:** `{kind: 'offer', offerId, from, to?: undefined, sdp}` sealed. Only the host
  acts on an offer. Sent on start, and repeated every `retryMs` (default 4 s) with a fresh offer
  until a link opens, because the co-doing channel is not known to deliver to participants who
  have not subscribed yet (section 9, spike).
- **Host -> all:** `{kind: 'answer', offerId, to: guestPeerId, sdp}` sealed. Every guest
  receives it; only the offer's owner (`offerId` it made) applies it. Others drop it after the
  unseal check.
- Offers older than a bound, or from known linked peers, are ignored; the same protocol id
  check as other rendezvous (`inksplat/2`) applies.
- Large SDP: if the transport reports a size limit (`maxBytes`, optional field), messages are
  split in sequence-numbered chunks and reassembled. Not built unless the spike shows it is
  needed (plan step 1).

### 5.3 Cost and privacy of the broadcast

Every guest's offer goes to everyone: with N guests that is N offers per retry round
received by N participants. SDP is a few kB; offers stop once linked, and retries use
backoff after the first minute. Sealed content is unreadable to other participants, but they
do see that someone is trying to join. Meet itself (Google) sees the co-doing traffic: sealed,
no SDP, token or names in clear.

## 6. Meet SDK adapter (`viewer/src/meet/`)

| Piece | Responsibility |
|---|---|
| `meet-sdk.ts` | Loads the SDK script on demand, exposes a typed minimal facade: `createAddonSession`, clients, `getActivityStartingState`, `startActivity`, `createCoDoingClient`, `getMeetingInfo`. Throws `MeetError` (stable `reason`) when not inside Meet or the SDK is unavailable. |
| `meet-transport.ts` | `SignalTransport` over `CoDoingClient`: `broadcastStateUpdate` / `onCoDoingStateChanged`, UTF-8 <-> `Uint8Array`, echo filtering, optional chunking. |
| `meet-boot.ts` | Decides role (starter vs joiner) and builds the session options; shared by both entry pages. |
| `main-stage.ts` / `main-stage.html` | Entry page: boot, then the presenter page UI (host) or viewer UI (guest). |
| `side-panel.ts` / `side-panel.html` | Launcher and status. |
| `fake-meet.ts` (tests/support) | In-memory Meet SDK for tests (section 11). |

The presenter and viewer apps (`present.ts`, `main.ts`) are refactored so their boot step takes
**session options and identity from the caller** (today they read the URL fragment and the
start form). This is the only change to existing pages; the standalone behavior stays.

The SDK is loaded from Google's script URL at runtime in the two Meet pages only; the
standalone pages keep zero third-party scripts. The Pages CSP gets that one script origin on
the Meet pages (and `frame-ancestors https://meet.google.com`); see plan step 5.

## 7. Screen sharing inside the add-on

The pages call `getDisplayMedia` themselves, exactly as spec 06. In an iframe this requires the
embedding frame to grant the `display-capture` permission. Meet controls its iframes, and the
public documentation does not say whether it does. This is the largest risk of the project and
decides the design (plan step 1):

| Spike result | Consequence |
|---|---|
| Works in the main stage iframe | As designed. |
| Blocked in iframe, `window.open` popup allowed | A `MediaStream` cannot be passed between windows, so a **capture window** (`capture.html`, Pages origin) would have to own the uplink peer connection itself. That splits `Session` across two windows; update this document and the plan before building it. |
| Blocked, no popup | The add-on is a whiteboard over **Meet's own** screen share only (reverse flow, `exposeToMeetWhenScreensharing`); the project is re-scoped before step 3. |

Whichever works, `Region Capture` in Meet and the add-on's own display capture are
independent: the add-on shares what the user picks in the browser picker.

## 8. Lifecycle and failure modes

| Situation | Behavior |
|---|---|
| Host leaves / closes main stage | Session ends; guests show the end notice. No host hand-over (the host holds the relay and the presenter key; electing a new one is a separate project). |
| Guest opens add-on before the host's page is ready | Guest retries offers (5.2); status "Waiting for the presenter". |
| Guest reload / rejoin | Reads the starting state again, new peer id, new offer. |
| Co-doing channel fails or is rate limited | Rendezvous reports status `no-channel`; existing links keep working (links are direct). New joins stop until it recovers. |
| WebRTC cannot connect (corporate firewalls) | As standalone: STUN/TURN from `packages/defaults`; the log says which step failed. Meet does not relay media for us. |
| Add-on opened outside Meet | Meet pages show "Open this from a Meet call"; the link points to the standalone site. |
| Participant on an unsupported browser/platform | Meet itself says they cannot join; no inksplat handling. |

## 9. Risks and open questions

Unverified assumptions about the Meet SDK (public docs do not state them). Plan step 1 measures
each on a real test deployment and this section is updated with the answers before step 2:

1. `getDisplayMedia` and `RTCPeerConnection` work in the add-on iframes (section 7).
2. Co-doing: maximum bytes per `broadcastStateUpdate`, rate limits, whether messages reach
   participants who subscribe late, whether the sender receives its own message, ordering,
   whether the data persists (assumed: **no** persistence, **no** echo guarantee).
3. Whether the SDK exposes a stable participant identity and display name
   (`getMeetingInfo` returns the meeting; names may need to come from the user).
4. Side panel width (assumed too narrow for the board) and main stage size/aspect (board
   frame is fixed 16:9, spec 07 section 3.5).
5. Marketplace requirements for a unlisted/testing deployment, a Google Cloud project number,
   and review time for public publishing (plan step 8). Add-ons target Google Workspace
   accounts; whether consumer accounts can use a publicly published add-on must be confirmed.
6. Background throttling of the main stage when the user switches Meet tabs (the host relay is
   event driven and timer-free, spec 07 section 7; verify on Meet).

Open questions (default used unless the user decides otherwise):

1. Name and colour: from Meet if the SDK gives a display name, else a short prompt in the main
   stage. [prompt prefilled with "Meet participant"]
2. May a guest start the activity? [yes, the starter becomes host]
3. Side panel shows host controls too? [no: v1 status only]
4. Show a Meet-specific privacy notice before the first Share screen? [yes, same text as the
   standalone notice plus "Google Meet carries the connection setup, not your screen"]

## 10. Security and privacy

- Same model as spec 01 section 4.4 and spec 07 section 8: the host decides what is shown, guests
  cannot set the active stream, a guest's screen leaves its machine only after picking a surface
  **and** the host asking for it.
- Meet shows the add-on's pages and the co-doing traffic to Google. The traffic is sealed with
  keys derived from the token; the token itself is in the starting state, which Meet stores for
  the activity (that is the audience of the call). Treat the token as readable by everyone in the
  call and by Google; it grants only that one session.
- Only the host page holds host controls (no presenter key distribution). The `accept` filter
  and `ctl` handling of spec 01 stay.
- The pages are served from the Pages origin listed in `addOnOrigins`; no wildcard origins. The
  Meet pages add exactly one third-party script origin (the SDK) to the CSP.
- The privacy policy page and `docs/privacy.md` get a Meet section (what Google receives);
  Marketplace publishing requires a public privacy policy and terms link.
- No Google OAuth scope, no stored user data, no cookies.

## 11. Testing

Unit (Vitest, `tests/unit/`): the channel rendezvous with an in-memory `SignalTransport`
(offer/answer, retries, echo, wrong token ignored, chunking if built); the transport adapter
against a fake `CoDoingClient` (encoding, echo filter); `meet-boot` role selection from a fake
starting state; the Meet error codes.

Browser (Chrome, `tests/e2e/`, no internet): `tests/support/fake-meet.ts` implements
`window.meet.addon` for several tabs through a shared in-process hub (starting state, co-doing,
frame messages). Cases: starter and two joiners link without any URL or tracker; a late joiner
links; the host shows a guest's canvas-stream screen (spec 07 flow) over links made through
the fake Meet; host leaving ends guests; opened outside Meet shows the notice.

Manual (`docs/manual-testing.md`): a real Meet call on a test deployment with three browsers:
join, share a tab, switch streams, a late joiner, host leaves, Chrome plus Firefox/Safari
guests, a corporate network, side-panel and main-stage states.

Real Meet cannot run in CI; the fake follows the documented API, and plan step 1 records
where the real SDK differed.
