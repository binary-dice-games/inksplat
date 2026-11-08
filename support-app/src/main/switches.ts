// MIT License © 2026 Binary Dice Games
/**
 * @file Command-line switches a packaged app refuses to start with (spec/08_remote_support
 * DESIGN.md section 7.3 R14): they would let another program drive the app (debugging ports,
 * Node inspector, V8 flags) or weaken it (certificate errors, extensions, proxies), and so
 * borrow its permission to record the screen. Fuses turn the Node ones off as well; this check
 * covers the Chromium ones.
 */

const FORBIDDEN = [
  /^--inspect/i,
  /^--debug/i,
  /^--remote-debugging/i,
  /^--remote-allow-origins/i,
  /^--js-flags/i,
  /^--ignore-certificate-errors/i,
  /^--load-extension/i,
  /^--proxy-server/i,
  /^--proxy-pac-url/i,
  /^--host-rules/i,
  /^--host-resolver-rules/i,
  /^--disable-web-security/i,
  /^--no-sandbox/i,
  /^--disable-gpu-sandbox/i,
  /^--renderer-cmd-prefix/i,
  /^--gpu-launcher/i,
  /^--utility-cmd-prefix/i,
  /^--browser-subprocess-path/i,
];

/** The forbidden switches in `argv` before any `--` (after it everything is an argument). */
export function forbiddenSwitches(argv: readonly string[]): string[] {
  const sep = argv.indexOf('--');
  const head = sep >= 0 ? argv.slice(1, sep) : argv.slice(1);
  return head.filter((a) => FORBIDDEN.some((re) => re.test(a)));
}
