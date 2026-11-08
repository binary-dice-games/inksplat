// MIT License © 2026 Binary Dice Games
/**
 * @file Updates of a packaged app (spec/08_remote_support/DESIGN.md sections 6.3 and 7.3 R11):
 * from this repository's GitHub Releases, downloaded in the background and installed when the
 * app quits, never during a session. The updater installs only builds signed by the same
 * publisher (Windows: the Authenticode publisher; macOS: the Developer ID). Linux builds do not
 * update themselves (an AppImage update carries no signature the updater checks): the app asks
 * to be downloaded again when it is too old.
 */
import { autoUpdater } from 'electron-updater';

/** Checks for an update once, quietly; errors only mean no update this time. */
export function checkForUpdates(): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  autoUpdater.checkForUpdates().catch(() => {});
}
