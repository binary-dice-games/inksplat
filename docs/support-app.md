# inksplat Support — the desktop app for remote support

inksplat Support lets a helper see one person's screen and point at it. The helper starts a
**support session** on the presenter page; the person opens the link, installs the app once, and
allows it. The app shares the whole screen and draws the helper's cursor, laser, pings and
emotes on a transparent overlay on the person's own screen. The helper can only look and point,
never click or type. Design and threat model:
[../spec/08_remote_support/DESIGN.md](../spec/08_remote_support/DESIGN.md).

## Layout

| Path | Contents |
|---|---|
| `support-app/src/main/` | Main process: links, consent (`controller.ts`, `consent.ts`), displays, pages on `app://support/`, updates |
| `support-app/src/preload/` | One preload per window: the only bridge to the main process |
| `support-app/src/session/` | The hidden session window: the guest session, the capture, the marks allowlist |
| `support-app/src/overlay/` | The overlay: the whiteboard, read only, over the shared display |
| `support-app/src/control/` | The control window and the bar while sharing |
| `support-app/src/shared/` | Messages between the processes, and the texts (English, Spanish) |
| `support-app/electron-builder.json` | Installers, link scheme, fuses, signing |

The helper's side is the presenter page (`viewer/src/present.ts`, `viewer/src/share-host.ts`);
the link's landing page is `viewer/src/support.html`.

## Build and run

```sh
cmake --build build --target support-app      # support-app/dist
npm start -w support-app                       # build and start it (no link: it waits for one)
npx electron support-app -- "inksplat-support://join#inksplat=<token>"   # with a link
```

To try a whole session by hand, start a support session on the presenter page (served locally,
see [testing.md](testing.md)), copy the link, take the part after `#`, and start the app as above
with `inksplat-support://join#` in front of it. A development run does not register the link
scheme; a packaged one does.

## Package

```sh
cmake --build build --target support-package  # installers for this system, in support-app/release
npm run package:dir -w support-app             # an unpacked build only (no installer)
```

| System | Installer | Notes |
|---|---|---|
| Windows 10 2004+ / 11 | `inksplat-Support-Setup.exe` (x64 and arm64) | Per user, no admin rights |
| macOS 12+ | `inksplat-Support.dmg` (universal) | Hardened runtime; asks for Screen Recording once |
| Linux | `inksplat-Support.deb`, `inksplat-Support.AppImage` | The `.deb` is the one offered: an AppImage cannot use Chromium's sandbox on Ubuntu 24.04 and later, and the app refuses to run without it |

Unsigned builds work for testing but frighten the people the app is for. See Signing below.

## Signing

The release workflow signs when these secrets are set in the `support-release` environment
(Settings → Environments); without them it builds unsigned and says so in the log.

| Secret | What it is |
|---|---|
| `MAC_CSC_LINK` | The **Developer ID Application** certificate with its private key, exported from Keychain Access as `.p12`, then base64 (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CSC_KEY_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_ID` | The Apple Account of the developer team, for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password of that account (account.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | The team's ten-character ID (developer.apple.com → Membership) |
| `WIN_CSC_LINK` | A Windows code signing certificate as base64 of a `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Its password |

macOS needs the Apple Developer Program; with the certificate and the notarization secrets the
`.dmg` is signed, notarized and opens without a warning. Windows code signing certificates
issued today keep their key on a hardware token or a cloud service and cannot be exported as a
`.pfx`; for those, electron-builder signs through the service instead (for example Microsoft's
Trusted Signing with `win.azureSignOptions`), which the workflow does not do yet. Linux packages
are not signed.

## Release

Set the version in `support-app/package.json`, then push a tag `support-v<version>`.
`.github/workflows/support-release.yml` checks, tests and packages the app on the three systems
in the protected `support-release` environment (a second maintainer approves; the signing
secrets live there) and attaches the installers to a **draft** release. Publish the draft after
checking it: the landing page links to `releases/latest/download/<installer>` and the updater of
Windows and macOS builds reads the latest published release. Linux builds do not update
themselves.

## Security in short

- Nothing is captured before the person presses **Allow** in the system's own dialog, which no
  window of the app can click; the helper's name and a six-digit safety code are in it.
- While sharing, a coloured border and a bar with **Stop** are on screen; closing or hiding
  either stops. A screen lock, sleep, an hour without confirmation, or a reconnect to another
  host stops too.
- The helper's messages reach only a read-only whiteboard that draws the cursor, laser, pings and
  emotes; nothing else of the board gets through.
- Pages are sandboxed, have no Node, and a strict CSP; a packaged build has the fuses that turn
  off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, and refuses debugging switches.

The tests: `support_*` in [testing.md](testing.md); the manual checks are items 77 to 90 of
[manual-testing.md](manual-testing.md).
