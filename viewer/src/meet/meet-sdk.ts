// MIT License © 2026 Binary Dice Games
/**
 * @file The part of the Google Meet add-ons web SDK (`window.meet.addon`) that inksplat uses,
 * typed small, and the loading of the SDK script. See spec/08_meet_addon/DESIGN.md section 6.
 */

/** The SDK script (the only third-party script, on the Meet pages only). */
export const MEET_SDK_URL = 'https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js';

/** A failure the page can explain: `reason` is a stable code. */
export class MeetError extends Error {
  constructor(
    readonly reason: 'not-in-meet' | 'sdk-unavailable' | 'no-project' | 'bad-state' | 'protocol',
    message: string,
  ) {
    super(message);
  }
}

/** What to tell the person when the add-on cannot start. */
export function meetProblem(e: unknown): string {
  if (e instanceof MeetError) {
    return e.reason === 'not-in-meet'
      ? 'Open inksplat from the Activities button of a Google Meet call.'
      : e.message;
  }
  return 'inksplat could not start in this call.';
}

export interface ActivityStartingState {
  additionalData?: string;
  mainStageUrl?: string;
  sidePanelUrl?: string;
}

export interface CoDoingState {
  bytes: Uint8Array;
}

export interface CoDoingDelegate {
  activityTitle: string;
  onCoDoingStateChanged(state: CoDoingState): void;
}

export interface CoDoingClient {
  broadcastStateUpdate(state: CoDoingState): Promise<void>;
}

/** Calls both frames have. */
export interface MeetClient {
  getActivityStartingState(): ActivityStartingState | Promise<ActivityStartingState>;
}

export interface MeetSidePanelClient extends MeetClient {
  startActivity(starting: ActivityStartingState): Promise<void>;
  notifyMainStage(message: string): Promise<void>;
  frameToFrameMessage?: ((message: string) => void) | null;
}

export interface MeetMainStageClient extends MeetClient {
  notifySidePanel(message: string): Promise<void>;
  frameToFrameMessage?: ((message: string) => void) | null;
}

export interface MeetAddonSession {
  createSidePanelClient(): Promise<MeetSidePanelClient>;
  createMainStageClient(): Promise<MeetMainStageClient>;
  createCoDoingClient(delegate: CoDoingDelegate): CoDoingClient;
}

export interface MeetGlobal {
  addon: {
    createAddonSession(options: { cloudProjectNumber: string }): Promise<MeetAddonSession>;
  };
}

/** Meet adds `meet_sdk` to the URLs of the frames it opens; without it we are not in a call. */
export function insideMeet(search: string = location.search): boolean {
  return new URLSearchParams(search).has('meet_sdk');
}

/** The Google Cloud project number the build put in the page (`inksplat-meet-project`). */
export function cloudProject(doc: Document = document): string {
  const value = doc.querySelector('meta[name="inksplat-meet-project"]')?.getAttribute('content');
  if (!value || !/^\d+$/.test(value)) {
    throw new MeetError(
      'no-project',
      'This build has no Google Cloud project number for the add-on.',
    );
  }
  return value;
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = () => resolve();
    el.onerror = () =>
      reject(new MeetError('sdk-unavailable', 'The Google Meet SDK could not be loaded.'));
    document.head.append(el);
  });
}

/**
 * Loads the SDK (unless `window.meet` exists already, as in tests) and starts the add-on session.
 * @throws {MeetError} `not-in-meet`, `sdk-unavailable`, `no-project`
 */
export async function openAddonSession(): Promise<MeetAddonSession> {
  const g = globalThis as { meet?: MeetGlobal };
  if (!g.meet) {
    if (!insideMeet()) {
      throw new MeetError('not-in-meet', 'Open inksplat from a Google Meet call.');
    }
    await loadScript(MEET_SDK_URL);
  }
  if (!g.meet) {
    throw new MeetError('sdk-unavailable', 'The Google Meet SDK could not be loaded.');
  }
  try {
    return await g.meet.addon.createAddonSession({ cloudProjectNumber: cloudProject() });
  } catch (e) {
    if (e instanceof MeetError) {
      throw e;
    }
    throw new MeetError('sdk-unavailable', e instanceof Error ? e.message : 'The Meet SDK failed.');
  }
}
