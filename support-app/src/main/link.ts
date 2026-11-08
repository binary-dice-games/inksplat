// MIT License © 2026 Binary Dice Games
/**
 * @file Where the app link is on the command line (spec/08_remote_support/DESIGN.md section 4.1,
 * 7.3 R10). The protocol is registered with a `--` separator, so the link is the one argument
 * after it and is never read as a switch; on macOS links come from `open-url` instead.
 */
import { SUPPORT_SCHEME, SUPPORT_URL_MAX } from '@inksplat/defaults';

/**
 * The app link in `argv`: the argument after `--` if there is one, else the last argument that
 * starts with the app's scheme (a desktop file without the separator); null when there is none
 * or it is too long. The link is not checked here: `parseSupportUrl` does that.
 */
export function linkFromArgv(argv: readonly string[]): string | null {
  const sep = argv.indexOf('--');
  const candidates = sep >= 0 ? argv.slice(sep + 1, sep + 2) : argv.slice(1);
  const prefix = `${SUPPORT_SCHEME}:`;
  const link = [...candidates].reverse().find((a) => a.toLowerCase().startsWith(prefix));
  return link !== undefined && link.length <= SUPPORT_URL_MAX ? link : null;
}
