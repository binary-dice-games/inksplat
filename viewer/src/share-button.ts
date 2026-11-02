// MIT License © 2026 Binary Dice Games
/**
 * @file The **Share screen / Stop sharing** button of both pages
 * (spec/07_participant_streaming/DESIGN.md section 3.2): the one-time notice, the browser's
 * picker, the end of a capture, and what the owner of a stream is told about it. What the
 * capture is used for (the host's own stream, a guest's uplink) is the page's business.
 */
import type { Stage } from '@inksplat/defaults';
import { canCaptureDisplay, startDisplayCapture, surfaceWarning } from './display-capture';
import type { DisplayCapture } from './display-capture';

/** Where one's own stream stands: not shared, on offer, previewed by the host, on the screen. */
export type OwnerStatus = 'idle' | 'offered' | 'previewed' | 'live';

/** The status of `me`'s stream in `stage`, while `sharing` (a capture runs). */
export function ownerStatus(stage: Stage | null, me: string | null, sharing: boolean): OwnerStatus {
  if (!sharing || !me) {
    return 'idle';
  }
  if (stage?.screen?.owner === me) {
    return 'live';
  }
  return stage?.preview === me ? 'previewed' : 'offered';
}

/** What the owner reads next to the button; the host decides alone, so it reads less. */
export function statusText(status: OwnerStatus, isHost: boolean): string {
  switch (status) {
    case 'idle':
      return '';
    case 'offered':
      return isHost ? 'Your screen is ready to show' : 'The presenter can show your screen';
    case 'previewed':
      return 'The presenter is looking at your screen';
    case 'live':
      return 'On screen for everybody';
  }
}

/** Plays `stream` in `v` unless it already does (compared by track: streams get rewrapped). */
export function playIn(v: HTMLVideoElement, stream: MediaStream | null): void {
  const now = (v.srcObject as MediaStream | null)?.getVideoTracks()[0] ?? null;
  if (now === (stream?.getVideoTracks()[0] ?? null)) {
    return;
  }
  v.srcObject = stream;
  if (stream) {
    v.play().catch(() => {});
  }
}

/** The text of the share button. */
export function buttonText(sharing: boolean): string {
  return sharing ? 'Stop sharing' : 'Share screen';
}

const NOTICE_KEY = 'inksplat.shareNotice';

function noticeSeen(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberNotice(): void {
  try {
    localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // private window: asked again next time
  }
}

export interface ShareButtonOptions {
  button: HTMLButtonElement;
  /**
   * The notice shown before the first share in this browser, with a `button[value=continue]`
   * and a `button[value=cancel]`; its Continue click is the gesture that opens the picker.
   */
  notice: HTMLDialogElement;
  /** A capture began. */
  onStart(capture: DisplayCapture): void;
  /** The capture ended: the button, the browser's own "Stop sharing", or the window closed. */
  onStop(): void;
  /** The captured size changed. */
  onResize?(width: number, height: number): void;
  /** Tells the person something (why the picker gave nothing, the whole-screen warning). */
  toast(text: string): void;
}

/** The share button of a page. */
export interface ShareButton {
  /** The running capture, or null. */
  capture(): DisplayCapture | null;
  /** Ends the running capture, if any (the page's session ended). */
  stop(): void;
}

/** Why the picker gave nothing, for a person. */
export function captureProblem(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Sharing was cancelled or blocked.';
  }
  return 'This browser could not capture that: ' + (e instanceof Error ? e.message : String(e));
}

/**
 * Wires the share button. It is hidden where the browser has no picker (phones): those people
 * still watch and draw.
 */
export function wireShareButton(options: ShareButtonOptions): ShareButton {
  const { button, notice } = options;
  let current: DisplayCapture | null = null;
  let picking = false;
  /** Plays the capture where nobody sees it, to hear when its size changes. */
  const sizer = document.createElement('video');
  sizer.muted = true;
  sizer.addEventListener('resize', () => {
    if (current && sizer.videoWidth > 0) {
      options.onResize?.(sizer.videoWidth, sizer.videoHeight);
    }
  });

  const render = (): void => {
    button.textContent = buttonText(current !== null);
    button.setAttribute('aria-pressed', String(current !== null));
  };

  const end = (): void => {
    const was = current;
    current = null;
    sizer.srcObject = null;
    render();
    if (was) {
      was.stop();
      options.onStop();
    }
  };

  const pick = async (): Promise<void> => {
    if (picking) {
      return;
    }
    picking = true;
    try {
      const next = await startDisplayCapture();
      current?.stop();
      current = next;
      next.onEnded(() => {
        if (current === next) {
          end();
        }
      });
      sizer.srcObject = next.stream;
      sizer.play().catch(() => {});
      render();
      options.onStart(next);
      const warning = surfaceWarning(next.surface);
      if (warning) {
        options.toast(warning);
      }
    } catch (e) {
      options.toast(captureProblem(e));
    } finally {
      picking = false;
    }
  };

  button.hidden = !canCaptureDisplay();
  render();
  button.addEventListener('click', () => {
    if (current) {
      end();
    } else if (noticeSeen()) {
      void pick();
    } else {
      notice.returnValue = '';
      notice.showModal();
    }
  });
  notice
    .querySelector<HTMLButtonElement>('button[value=continue]')
    ?.addEventListener('click', () => {
      rememberNotice();
      notice.close('continue');
      void pick(); // this click is the gesture the picker needs
    });
  notice
    .querySelector<HTMLButtonElement>('button[value=cancel]')
    ?.addEventListener('click', () => notice.close('cancel'));

  return { capture: () => current, stop: end };
}
