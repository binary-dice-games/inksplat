// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  REFUSALS,
  RefusalLimiter,
  TIMING,
  isReflex,
  isSameHost,
  isTooOld,
} from '../../support-app/src/main/consent';

// The rules of consent (spec/08_remote_support/DESIGN.md sections 3.2, 5.4 and 7).

describe('consent', () => {
  it('pauses links for ten minutes after three refusals within ten minutes', () => {
    let now = 1_000_000;
    const limiter = new RefusalLimiter(() => now);
    expect(REFUSALS).toBe(3);
    expect(limiter.refused()).toBe(false);
    now += 60_000;
    expect(limiter.refused()).toBe(false);
    expect(limiter.blocked()).toBe(false);
    now += 60_000;
    expect(limiter.refused()).toBe(true);
    expect(limiter.blocked()).toBe(true);
    now += TIMING.blockMs - 1;
    expect(limiter.blocked()).toBe(true);
    now += 1;
    expect(limiter.blocked()).toBe(false);
  });

  it('forgets refusals older than the window', () => {
    let now = 0;
    const limiter = new RefusalLimiter(() => now);
    limiter.refused();
    limiter.refused();
    now += TIMING.refusalWindowMs;
    expect(limiter.refused()).toBe(false);
    expect(limiter.blocked()).toBe(false);
  });

  it('takes an Allow quicker than a second for a reflex', () => {
    expect(isReflex(1000, 1999)).toBe(true);
    expect(isReflex(1000, 2000)).toBe(false);
  });

  it('explains for 3 s, checks after an hour, waits a minute, and allows 2 minutes to reconnect', () => {
    expect(TIMING).toMatchObject({
      explainMs: 3000,
      checkMs: 3_600_000,
      answerMs: 60_000,
      reconnectMs: 120_000,
    });
  });

  it('asks a build older than about six months to be updated', () => {
    const built = Date.UTC(2026, 0, 1);
    expect(isTooOld(built, built + 100 * 86_400_000)).toBe(false);
    expect(isTooOld(built, built + 200 * 86_400_000)).toBe(true);
    expect(isTooOld(0, Date.now())).toBe(false);
  });

  it('reconnects without asking only to the host that was allowed', () => {
    expect(isSameHost('AB:CD', 'ab:cd')).toBe(true);
    expect(isSameHost('AB:CD', 'AB:CE')).toBe(false);
    expect(isSameHost(null, 'AB:CD')).toBe(false);
  });
});
