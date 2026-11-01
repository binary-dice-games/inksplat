// MIT License © 2026 Binary Dice Games
/**
 * @file Screen capture for the presenter page (spec/06_static_presenter): the
 * browser's own picker (a tab, a window or a whole screen) as the video source.
 * The track goes to the session's senders through the still refresh
 * (`still-refresh.ts`, a worker that repeats a still frame so the encoder can
 * sharpen it), not a canvas relay: timers of a background page are throttled and
 * this page usually sits behind the window it shares.
 */
import { refreshStill } from './still-refresh';

/** What kind of surface the user picked (`displaySurface` of the track settings). */
export type Surface = 'browser' | 'window' | 'monitor' | 'unknown';

/** Whether the shared video shows the mouse pointer (`cursor` of `getDisplayMedia`). */
export type CursorMode = 'always' | 'motion' | 'never';

export interface DisplayCapture {
  /**
   * The captured surface, to hand to `ShareHost.setSource`; where the browser can, its frame
   * is repeated for a while once the surface is still (`still-refresh.ts`).
   */
  readonly stream: MediaStream;
  readonly surface: Surface;
  /** The captured frame size now (it changes when the shared window is resized). */
  size(): { width: number; height: number };
  /** Calls `cb` once when the source ends (the user stopped sharing, or the window closed). */
  onEnded(cb: () => void): void;
  /** Ends the capture. */
  stop(): void;
}

/**
 * The factor (>= 1) that brings a frame of `width x height` inside
 * `maxWidth x maxHeight`; 1 when it already fits (a frame is never upscaled).
 */
export function fitScale(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): number {
  if (!(width > 0) || !(height > 0)) {
    return 1;
  }
  return Math.max(1, width / maxWidth, height / maxHeight);
}

/**
 * What to tell the presenter about the chosen surface, or null. A whole screen
 * contains this page too when the page is on it, which films itself.
 */
export function surfaceWarning(surface: Surface): string | null {
  return surface === 'monitor'
    ? 'You are sharing a whole screen. If this window is on that screen, viewers see it ' +
        'too: move it to another screen, or share a window or tab instead.'
    : null;
}

function surfaceOf(track: MediaStreamTrack): Surface {
  const value = (track.getSettings() as { displaySurface?: string }).displaySurface;
  return value === 'browser' || value === 'window' || value === 'monitor' ? value : 'unknown';
}

/** Whether this browser can offer the picker. */
export function canCaptureDisplay(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/**
 * Opens the picker and captures what the user chooses. Must run from a user
 * gesture (a click).
 *
 * @param cursor whether the video shows the mouse pointer (the browser may ignore it;
 *        the default is the browser's own, which is to show it)
 * @throws {DOMException} `NotAllowedError` when the user cancels or the browser
 *         refuses; `NotSupportedError` or a `TypeError` when there is no picker
 * @throws {Error} when the chosen source has no video
 */
export async function startDisplayCapture(cursor?: CursorMode): Promise<DisplayCapture> {
  const options = {
    video: cursor ? { cursor } : true,
    audio: false,
    // The presenter page must not be offered: it would film itself.
    selfBrowserSurface: 'exclude',
    // Chrome's "share this tab instead" switches without a new picker.
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('the chosen source has no video');
  }
  const ended = new Set<() => void>();
  track.addEventListener('ended', () => ended.forEach((cb) => cb()), { once: true });
  const refresh = refreshStill(track);
  return {
    stream: refresh ? new MediaStream([refresh.track]) : stream,
    surface: surfaceOf(track),
    size() {
      const { width, height } = track.getSettings();
      return { width: width ?? 0, height: height ?? 0 };
    },
    onEnded(cb) {
      ended.add(cb);
    },
    stop() {
      refresh?.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
