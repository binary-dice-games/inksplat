// MIT License © 2026 Binary Dice Games
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repeatStill } from '../../viewer/src/still-refresh';

// The still refresh's loop (viewer/src/still-refresh.ts) with stand-in frames and a fake clock:
// what comes in passes on, a still frame is repeated with growing timestamps for a while, and
// everything ends with the source or the output.

interface Frame {
  id: string;
  timestamp: number;
  closed: boolean;
  close(): void;
}

const frame = (id: string, timestamp: number): Frame => ({
  id,
  timestamp,
  closed: false,
  close() {
    this.closed = true;
  },
});

function rig(options = { everyMs: 100, forMs: 350 }, highWaterMark = 4) {
  let push!: ReadableStreamDefaultController<Frame>;
  const readable = new ReadableStream<Frame>({ start: (c) => void (push = c) });
  const out: Frame[] = [];
  let fail = false;
  const writable = new WritableStream<Frame>(
    {
      write(f) {
        if (fail) throw new Error('track stopped');
        out.push(f);
      },
    },
    new CountQueuingStrategy({ highWaterMark }),
  );
  const copies: Frame[] = [];
  const copy = (f: Frame, timestamp: number) => {
    const c = frame(`${f.id.replace(/'$/, '')}'`, timestamp);
    copies.push(c);
    return c;
  };
  const done = repeatStill(readable, writable, copy, options, () => Date.now());
  return {
    push: (f: Frame) => push.enqueue(f),
    end: () => push.close(),
    failNext: () => void (fail = true),
    out,
    copies,
    done,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('repeatStill', () => {
  it('repeats a still frame every everyMs for forMs, with growing timestamps', async () => {
    const r = rig();
    r.push(frame('a', 5_000_000));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.out.map((f) => f.id)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1000);
    // 100, 200, 300 ms after it arrived; 400 is past forMs
    expect(r.out.map((f) => f.id)).toEqual(['a', "a'", "a'", "a'"]);
    expect(r.out.map((f) => f.timestamp)).toEqual([5_000_000, 5_100_000, 5_200_000, 5_300_000]);
    r.end();
    await r.done;
  });

  it('starts over with each new frame and drops the copy of the old one', async () => {
    const r = rig();
    r.push(frame('a', 0));
    await vi.advanceTimersByTimeAsync(150);
    r.push(frame('b', 150_000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.out.map((f) => f.id)).toEqual(['a', "a'", 'b', "b'", "b'", "b'"]);
    expect(r.copies[0]?.closed).toBe(true); // the kept copy of 'a'
    r.end();
    await r.done;
  });

  it('skips repeats while the output is full', async () => {
    const r = rig({ everyMs: 100, forMs: 1000 }, 0);
    r.push(frame('a', 0));
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.out.map((f) => f.id)).toEqual(['a']);
    r.end();
    await r.done;
  });

  it('ends when the source ends, closing the kept copy', async () => {
    const r = rig();
    r.push(frame('a', 0));
    await vi.advanceTimersByTimeAsync(50);
    r.end();
    await r.done;
    expect(r.copies.every((c) => c.closed)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.out.map((f) => f.id)).toEqual(['a']);
  });

  it('ends when the output fails', async () => {
    const r = rig();
    r.push(frame('a', 0));
    await vi.advanceTimersByTimeAsync(0);
    r.failNext();
    await vi.advanceTimersByTimeAsync(100);
    await r.done;
    expect(r.out.map((f) => f.id)).toEqual(['a']);
  });
});
