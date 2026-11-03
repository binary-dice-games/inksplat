// MIT License © 2026 Binary Dice Games
/**
 * @file Who is the host and what is the room token, from Meet's activity starting state
 * (spec/08_meet_addon/DESIGN.md section 4.2), and the options both pages hand to their session.
 */
import { isToken, newToken } from '@inksplat/collab-session';
import type { RendezvousSpec } from '@inksplat/collab-session';
import { PROTOCOL } from '@inksplat/defaults';
import { MeetError, openAddonSession } from './meet-sdk';
import type { MeetAddonSession, MeetMainStageClient, MeetSidePanelClient } from './meet-sdk';
import { meetTransport } from './meet-transport';

/** What the starter puts in the starting state (`additionalData`, JSON). */
export interface MeetStart {
  p: string;
  token: string;
  starter: string;
}

/** Where the starter's side panel leaves its id for its own main stage (same tab, same origin). */
export const STARTER_KEY = 'inksplat.meet.starter';

/** A tiny storage: `sessionStorage`, or a stand-in in tests. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function sessionStore(): KeyStore {
  try {
    return sessionStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}

/** A new starting state: a fresh room token and a random starter id. */
export function newStart(): MeetStart {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const starter = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return { p: PROTOCOL, token: newToken(), starter };
}

/**
 * Reads the starting state's `additionalData`.
 * @throws {MeetError} `bad-state` when missing or malformed, `protocol` for another version
 */
export function parseStart(additionalData: string | undefined): MeetStart {
  let value: unknown;
  try {
    value = JSON.parse(additionalData ?? '');
  } catch {
    throw new MeetError('bad-state', 'inksplat has not been started in this call yet.');
  }
  const s = value as Partial<MeetStart> | null;
  if (
    !s ||
    typeof s.token !== 'string' ||
    !isToken(s.token) ||
    typeof s.starter !== 'string' ||
    typeof s.p !== 'string'
  ) {
    throw new MeetError('bad-state', 'inksplat has not been started in this call yet.');
  }
  if (s.p !== PROTOCOL) {
    throw new MeetError('protocol', 'Someone runs another version of inksplat: reload the page.');
  }
  return { p: s.p, token: s.token, starter: s.starter };
}

/** The starter's own main stage is the host; everyone else is a guest. */
export function roleFor(start: MeetStart, stored: string | null): 'host' | 'guest' {
  return stored !== null && stored === start.starter ? 'host' : 'guest';
}

/** What a page needs to make its session. */
export interface MeetPlan {
  role: 'host' | 'guest';
  token: string;
  rendezvous: RendezvousSpec[];
  /** Tells the side panel how the session is going. */
  report(status: string): void;
}

/**
 * Main stage side: opens the add-on session, finds the role and the token.
 * @throws {MeetError}
 */
export async function planMainStage(
  session?: MeetAddonSession,
  store: KeyStore = sessionStore(),
): Promise<MeetPlan> {
  const addon = session ?? (await openAddonSession());
  const client: MeetMainStageClient = await addon.createMainStageClient();
  const start = parseStart((await client.getActivityStartingState()).additionalData);
  return {
    role: roleFor(start, store.getItem(STARTER_KEY)),
    token: start.token,
    rendezvous: [{ kind: 'channel', transport: meetTransport(addon) }],
    report: (status) =>
      void client.notifySidePanel(JSON.stringify({ t: 'status', status })).catch(() => {}),
  };
}

/**
 * Side panel side: starts the activity for everyone, with this panel's tab as the host.
 * @param mainStageUrl the router page every participant's main stage loads
 */
export async function startActivity(
  client: MeetSidePanelClient,
  mainStageUrl: string,
  store: KeyStore = sessionStore(),
): Promise<void> {
  const start = newStart();
  store.setItem(STARTER_KEY, start.starter);
  await client.startActivity({ mainStageUrl, additionalData: JSON.stringify(start) });
}

/** Whether an activity is running already (its starting state parses). */
export async function activityRunning(client: MeetSidePanelClient): Promise<boolean> {
  try {
    parseStart((await client.getActivityStartingState()).additionalData);
    return true;
  } catch {
    return false;
  }
}
