// MIT License © 2026 Binary Dice Games
/**
 * @file Whether this page is a Meet add-on variant of the presenter or viewer page. The build
 * writes `<meta name="inksplat-meet">` into those variants only
 * (spec/08_meet_addon/DESIGN.md section 6); the standalone pages never see Meet code run.
 */

/** True on the Meet variants of the pages. */
export function meetMode(doc: Document = document): boolean {
  return doc.querySelector('meta[name="inksplat-meet"]') !== null;
}
