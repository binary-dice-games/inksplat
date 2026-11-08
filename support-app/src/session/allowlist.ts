// MIT License © 2026 Binary Dice Games
/**
 * @file The marks that reach the overlay (spec/08_remote_support/DESIGN.md section 7.3 R2): the
 * helper's cursor position, laser points, pings and emotes from the fixed set, each rebuilt from
 * checked fields. Nothing else of the whiteboard channel (items, text, pictures, files, avatars,
 * notes, links) ever reaches the person's screen, so the helper cannot draw a fake dialog there.
 */
import { EMOTES, EMOTE_LEVELS } from '@inksplat/collab-whiteboard';

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const TOOLS = new Set(['pointer', 'cursor', 'laser', 'emote', 'magnify']);
/** The most points of one laser message (as the whiteboard sends them). */
export const MAX_LASER_POINTS = 400;
/** Board units go a little past the frame (1000 wide); far beyond is refused. */
const LIMIT = 100_000;

const coord = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMIT;
const page = (n: unknown): number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < 5 ? (n as number) : 0;

/**
 * The mark rebuilt from `input` if it is one the overlay may draw, else null: `cur` (position
 * and tool, or hidden), `laser` (points), `ping` and `emote` (a name of the emote wheel).
 */
export function cleanMark(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const m = input as Record<string, unknown>;
  switch (m.t) {
    case 'cur':
      if (m.hide === true) {
        return { t: 'cur', hide: true };
      }
      if (!coord(m.x) || !coord(m.y)) {
        return null;
      }
      return {
        t: 'cur',
        x: m.x,
        y: m.y,
        pg: page(m.pg),
        ...(typeof m.tool === 'string' && TOOLS.has(m.tool) ? { tool: m.tool } : {}),
      };
    case 'laser': {
      const pts = m.pts;
      if (
        typeof m.id !== 'string' ||
        !ID.test(m.id) ||
        !Number.isInteger(m.seq) ||
        (m.seq as number) < 0 ||
        !Array.isArray(pts) ||
        pts.length === 0 ||
        pts.length > MAX_LASER_POINTS ||
        pts.length % 2 !== 0 ||
        !pts.every(coord)
      ) {
        return null;
      }
      return { t: 'laser', id: m.id, seq: m.seq, pts: [...pts], pg: page(m.pg) };
    }
    case 'ping':
      if (typeof m.id !== 'string' || !ID.test(m.id) || !coord(m.x) || !coord(m.y)) {
        return null;
      }
      return { t: 'ping', id: m.id, x: m.x, y: m.y, pg: page(m.pg) };
    case 'emote':
      if (
        typeof m.id !== 'string' ||
        !ID.test(m.id) ||
        typeof m.name !== 'string' ||
        !EMOTES.includes(m.name) ||
        !coord(m.x) ||
        !coord(m.y) ||
        !Number.isInteger(m.level) ||
        (m.level as number) < 1 ||
        (m.level as number) > EMOTE_LEVELS
      ) {
        return null;
      }
      return { t: 'emote', id: m.id, name: m.name, x: m.x, y: m.y, level: m.level, pg: page(m.pg) };
    default:
      return null;
  }
}
