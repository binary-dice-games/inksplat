// MIT License © 2026 Binary Dice Games
/**
 * @file The decisions of the support landing page (spec/08_remote_support section 3.2), free of
 * DOM code: which system the visitor has, which installer to offer, and the app link the page's
 * address carries.
 */
import {
  SUPPORT_DOWNLOADS,
  SUPPORT_RELEASES,
  parseInvite,
  supportAppUrl,
} from '@inksplat/defaults';

/** The systems the support app is built for, or `other` (a phone, a tablet, anything else). */
export type SupportSystem = 'windows' | 'mac' | 'linux' | 'other';

/**
 * The visitor's system from the browser's user agent and platform. Phones and tablets are
 * `other`: the app runs on a desktop only.
 */
export function detectSystem(userAgent: string, platform = ''): SupportSystem {
  const ua = `${userAgent} ${platform}`;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return 'other';
  }
  if (/Windows|Win32|Win64/i.test(ua)) {
    return 'windows';
  }
  if (/Macintosh|Mac OS X|MacIntel/i.test(ua)) {
    return 'mac';
  }
  if (/Linux|X11/i.test(ua)) {
    return 'linux';
  }
  return 'other';
}

/** The installer to download for `system` (Linux: the AppImage), or null for `other`. */
export function downloadUrl(system: SupportSystem): string | null {
  switch (system) {
    case 'windows':
      return SUPPORT_RELEASES + SUPPORT_DOWNLOADS.windows;
    case 'mac':
      return SUPPORT_RELEASES + SUPPORT_DOWNLOADS.mac;
    case 'linux':
      return SUPPORT_RELEASES + SUPPORT_DOWNLOADS.linux;
    default:
      return null;
  }
}

/** Every installer, for the "other systems" list: [label, url]. */
export function allDownloads(): [string, string][] {
  return [
    ['Windows', SUPPORT_RELEASES + SUPPORT_DOWNLOADS.windows],
    ['macOS', SUPPORT_RELEASES + SUPPORT_DOWNLOADS.mac],
    ['Linux (AppImage)', SUPPORT_RELEASES + SUPPORT_DOWNLOADS.linux],
    ['Linux (Debian, Ubuntu)', SUPPORT_RELEASES + SUPPORT_DOWNLOADS.linuxDeb],
  ];
}

/** The app link (`inksplat-support://join#...`) for the page's hash, or null for a bad link. */
export function appUrlFromHash(hash: string): string | null {
  const invite = parseInvite(hash);
  return invite ? supportAppUrl(invite) : null;
}

/** The name of a system as the page says it. */
export function systemName(system: SupportSystem): string {
  return { windows: 'Windows', mac: 'macOS', linux: 'Linux', other: 'your computer' }[system];
}
