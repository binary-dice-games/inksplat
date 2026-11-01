// MIT License © 2026 Binary Dice Games
/**
 * @file Still refresh: repeats the last captured frame for a while after the shared surface
 * stops changing, so the encoder can sharpen it.
 *
 * Chrome's screen capture delivers a frame only when the surface changes. The encoder spends
 * its first frame after a change at a low quality (the bits went to the motion) and, with no
 * frame after it, never improves it: a still page stays blurry for good. Repeating the frame
 * gives the encoder the passes it needs (measured at 3840x1822, VP8 at 1.5 Mbit/s: QP 80 to 15
 * in about 6 s). The repeats run in a worker, because the page that shares usually sits behind
 * the shared window, where its own timers are throttled to once a second or less.
 * See spec/03_tab_streaming/DESIGN.md section 4.
 */

/** How often (`everyMs`) and for how long after the last change (`forMs`) a frame is repeated. */
export interface StillRefreshOptions {
  everyMs: number;
  forMs: number;
}

/**
 * The defaults: about the default frame rate (the encoder drops what its frame rate cap does
 * not allow), long enough to converge at a low frame rate.
 */
export const STILL_REFRESH: Readonly<StillRefreshOptions> = { everyMs: 333, forMs: 12000 };

/** The worker script, next to the pages (built by `scripts/build-viewer.mjs`). */
export const STILL_REFRESH_WORKER = 'still-refresh-worker.js';

/** What `repeatStill` needs of a frame (a `VideoFrame`). */
export interface RepeatableFrame {
  /** Microseconds. */
  readonly timestamp: number;
  close(): void;
}

/**
 * Passes every frame of `readable` on to `writable`, and while no new frame comes, writes a
 * copy of the last one every `everyMs`, for `forMs` after it arrived. Copies are made with
 * `copy(frame, timestamp)`, stamped with the time elapsed since the original. Skips a repeat
 * while the writer is full. Resolves when `readable` ends (the capture stopped) or `writable`
 * fails (the output track was stopped); `writable` is closed then.
 */
export async function repeatStill<F extends RepeatableFrame>(
  readable: ReadableStream<F>,
  writable: WritableStream<F>,
  copy: (frame: F, timestamp: number) => F,
  options: StillRefreshOptions = STILL_REFRESH,
  now: () => number = () => performance.now(),
): Promise<void> {
  const reader = readable.getReader();
  const writer = writable.getWriter();
  let last: F | null = null;
  let lastAt = 0;
  let sentAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;
  const write = (frame: F) => {
    writer.write(frame).catch(() => {
      failed = true;
      void reader.cancel().catch(() => {});
    });
  };
  const schedule = () => {
    clearTimeout(timer);
    const due = sentAt + options.everyMs;
    if (last && !failed && due - lastAt <= options.forMs) {
      timer = setTimeout(repeat, Math.max(0, due - now()));
    }
  };
  const repeat = () => {
    sentAt = now();
    if (last && !failed && (writer.desiredSize ?? 0) > 0) {
      write(copy(last, last.timestamp + Math.round((sentAt - lastAt) * 1000)));
    }
    schedule();
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || failed) {
        value?.close();
        break;
      }
      last?.close();
      last = copy(value, value.timestamp);
      lastAt = sentAt = now();
      write(value);
      schedule();
    }
  } catch {
    // the capture failed
  } finally {
    clearTimeout(timer);
    last?.close();
    last = null;
    await writer.close().catch(() => {});
  }
}

interface TrackProcessor {
  readonly readable: ReadableStream<unknown>;
}
interface TrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<unknown>;
}
interface BreakoutBox {
  MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => TrackProcessor;
  MediaStreamTrackGenerator?: new (init: { kind: 'video' }) => TrackGenerator;
}

/**
 * A track that shows `track` and repeats its last frame while it is still (see the file
 * comment). The repeats run in the worker `STILL_REFRESH_WORKER`, next to the page.
 *
 * @returns the new track and `stop()` (stops the new track and the worker, not `track`); the
 *          new track ends when `track` ends. Null where the browser cannot (no
 *          `MediaStreamTrackProcessor`, `MediaStreamTrackGenerator` or `Worker`: Firefox,
 *          Safari) or the worker cannot start: send `track` itself then.
 */
export function refreshStill(
  track: MediaStreamTrack,
  options: StillRefreshOptions = STILL_REFRESH,
): { track: MediaStreamTrack; stop(): void } | null {
  const { MediaStreamTrackProcessor: Processor, MediaStreamTrackGenerator: Generator } =
    globalThis as unknown as BreakoutBox;
  if (!Processor || !Generator || typeof Worker !== 'function' || track.kind !== 'video') {
    return null;
  }
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL(STILL_REFRESH_WORKER, document.baseURI));
    const processor = new Processor({ track });
    const generator = new Generator({ kind: 'video' });
    generator.contentHint = track.contentHint;
    worker.postMessage({ readable: processor.readable, writable: generator.writable, options }, [
      processor.readable as unknown as Transferable,
      generator.writable as unknown as Transferable,
    ]);
    const w = worker;
    return {
      track: generator,
      stop() {
        generator.stop();
        w.terminate();
      },
    };
  } catch {
    worker?.terminate();
    return null;
  }
}
