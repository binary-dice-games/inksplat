// MIT License © 2026 Binary Dice Games
/**
 * @file The rules of consent (spec/08_remote_support/DESIGN.md sections 3.2, 5.4 and 7), free of
 * Electron so they are unit tested: how long things take, when an answer is a reflex, when links
 * are ignored after refusals, when the app is too old, and whether a reconnect reaches the host
 * that was allowed.
 */

/** Times of the consent rules, in milliseconds. */
export const TIMING = {
  /** How long the control window explains before the system's dialog asks. */
  explainMs: 3000,
  /** An Allow sooner than this after the dialog appeared is a reflex: the dialog asks again. */
  reflexMs: 1000,
  /** How long sharing goes on before the app asks "Keep sharing?". */
  checkMs: 60 * 60_000,
  /** How long that question waits for an answer before sharing stops. */
  answerMs: 60_000,
  /** How long a lost link may take to come back without asking again. */
  reconnectMs: 2 * 60_000,
  /** How long links are ignored after too many refusals. */
  blockMs: 10 * 60_000,
  /** The window in which refusals are counted. */
  refusalWindowMs: 10 * 60_000,
  /** How old a build may be before it asks to be updated (about six months). */
  maxAgeMs: 183 * 24 * 60 * 60_000,
} as const;

/** How many refusals within {@link TIMING.refusalWindowMs} block links. */
export const REFUSALS = 3;

/**
 * Counts "Don't allow" answers: after {@link REFUSALS} within the window, links are ignored for
 * {@link TIMING.blockMs} (a page that opens the app again and again, hoping for a reflex click).
 */
export class RefusalLimiter {
  private times: number[] = [];
  private until = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Records a refusal; true when links are now blocked. */
  refused(): boolean {
    const t = this.now();
    this.times = [...this.times.filter((x) => t - x < TIMING.refusalWindowMs), t];
    if (this.times.length >= REFUSALS) {
      this.until = t + TIMING.blockMs;
      this.times = [];
      return true;
    }
    return false;
  }

  /** Whether links are ignored now. */
  blocked(): boolean {
    return this.now() < this.until;
  }
}

/** Whether an Allow at `answeredAt` for a dialog shown at `shownAt` was too quick to be read. */
export function isReflex(shownAt: number, answeredAt: number): boolean {
  return answeredAt - shownAt < TIMING.reflexMs;
}

/** Whether a build made at `builtAt` is too old to connect at `now` (it asks to be updated). */
export function isTooOld(builtAt: number, now: number): boolean {
  return Number.isFinite(builtAt) && builtAt > 0 && now - builtAt > TIMING.maxAgeMs;
}

/**
 * Whether a host fingerprint `current` is the one consented to (`pinned`): a reconnect to any
 * other host, even with the same link, asks again.
 */
export function isSameHost(pinned: string | null, current: string): boolean {
  return pinned !== null && pinned.toUpperCase() === current.toUpperCase();
}
