// MIT License © 2026 Binary Dice Games
/**
 * @file The worker of `still-refresh.ts`: receives `{readable, writable, options}` (the
 * capture's frames and the output track's sink) once, repeats still frames until the capture
 * ends, then closes itself. Built as `still-refresh-worker.js`.
 */
import { repeatStill } from './still-refresh';
import type { StillRefreshOptions } from './still-refresh';

interface Start {
  readable: ReadableStream<VideoFrame>;
  writable: WritableStream<VideoFrame>;
  options: StillRefreshOptions;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Start>) => void) | null;
  close(): void;
};

scope.onmessage = (e) => {
  scope.onmessage = null;
  const { readable, writable, options } = e.data;
  void repeatStill(
    readable,
    writable,
    (frame, timestamp) => new VideoFrame(frame, { timestamp }),
    options,
  ).finally(() => scope.close());
};
