// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MS, layerWhileMoving } from '../../viewer/src/zoom-layer';

/** An adapter whose view is set by hand; `change()` tells its listeners. */
function fakeAdapter() {
  let view = { scale: 1, x: 0, y: 0 };
  const listeners = new Set<() => void>();
  return {
    view: () => view,
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    set(next: Partial<typeof view>) {
      view = { ...view, ...next };
      listeners.forEach((cb) => cb());
    },
    listeners,
  };
}

describe('the layer of the zoomed content', () => {
  afterEach(() => vi.useRealTimers());

  it('is there while the content is zoomed or panned, and goes once it stops', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const adapter = fakeAdapter();
    const stop = layerWhileMoving(el, adapter);
    expect(el.style.willChange).toBe('');

    // A change that moves nothing (a resize, the stage) leaves it alone.
    adapter.set({});
    expect(el.style.willChange).toBe('');

    adapter.set({ scale: 1.5 });
    expect(el.style.willChange).toBe('transform');
    vi.advanceTimersByTime(SETTLE_MS - 50);
    // Every step of the gesture keeps it a little longer.
    adapter.set({ x: -40 });
    vi.advanceTimersByTime(SETTLE_MS - 50);
    expect(el.style.willChange).toBe('transform');
    vi.advanceTimersByTime(60);
    expect(el.style.willChange).toBe('');

    // Stopping takes it off and listens no more.
    adapter.set({ scale: 2 });
    expect(el.style.willChange).toBe('transform');
    stop();
    expect(el.style.willChange).toBe('');
    expect(adapter.listeners.size).toBe(0);
  });
});
