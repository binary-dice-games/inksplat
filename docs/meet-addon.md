# inksplat as a Google Meet add-on

Inside a Meet call, inksplat replaces Meet's screen sharing: anyone shares a tab, window or
screen and everybody draws on it. Meet only introduces the participants to each other; the video
and the drawings go directly between their browsers, as on the standalone site. Design:
[spec/08_meet_addon/DESIGN.md](../spec/08_meet_addon/DESIGN.md).

## How people use it

1. In the call, open **Activities** and pick inksplat. The side panel opens.
2. Press **Start inksplat for everyone**. Meet asks everybody to join; each who accepts gets the
   board in the main stage. Whoever pressed the button is the presenter (the page with the
   controls, as `present.html`); everyone else sees the viewer page.
3. Anyone presses **Share screen**; the presenter chooses which stream everybody sees.

If the presenter closes the main stage or leaves, the session ends for everyone.

## Pages

| Page | Who loads it |
|------|--------------|
| `side-panel.html` | The side panel: starts the activity, shows status |
| `meet-stage.html` | Every main stage; sends the starter to `meet-host.html`, the others to `meet-guest.html` |
| `meet-host.html`, `meet-guest.html` | The presenter and viewer pages with Meet's SDK allowed and the Meet mode on |

`site/` contains them next to `index.html` and `present.html`, which stay free of any third-party
script. The Meet pages load Google's SDK script (`www.gstatic.com`) and nothing else.

## Setting up a deployment

1. Create a Google Cloud project and note its **project number**; enable the Google Workspace
   Marketplace SDK and the Google Meet add-ons API (the Meet add-ons documentation lists the exact
   steps).
2. Build the site with the number: `INKSPLAT_MEET_PROJECT=<number> npm run build:site` (or set it
   in the environment of `cmake --build build --target site`). Without it the Meet pages say the
   build has no project number.
3. Publish the site over HTTPS (see [publishing.md](publishing.md)).
4. Make the add-on deployment (manifest) in the Google Cloud console with:
   - `sidePanelUri`: `<site>/side-panel.html`
   - `mainStageUri`: `<site>/meet-stage.html`
   - `addOnOrigins`: the origin of the site (`https://...`, no path, no wildcard you do not own)
5. Install the test deployment for your account and start it in a call. Publishing for everyone
   goes through the Workspace Marketplace review; it needs a public privacy policy
   (`<site>/privacy.html`) and terms.

## Known limits

- Not verified against a real call yet (spec/08 plan step 1 and 8): whether Meet lets the add-on's
  frames call `getDisplayMedia`, how large and how fast the co-doing messages may be, and whether
  the starter's tab keeps its `sessionStorage` between the side panel and the main stage. The
  automated tests use a fake of the SDK.
- No host hand-over: the session ends when the presenter leaves.
- GitHub Pages cannot send a `frame-ancestors` header; the pages can be framed by anyone.
- Meet's mobile apps do not run add-ons.
