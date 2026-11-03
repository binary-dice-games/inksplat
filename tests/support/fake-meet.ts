// MIT License © 2026 Binary Dice Games
/**
 * @file A fake of the Google Meet add-ons web SDK (`window.meet.addon`), as far as inksplat
 * uses it (spec/08_meet_addon/DESIGN.md section 11). Pages of one hub (one fake call) share the
 * activity starting state and a co-doing broadcast. The same source runs in node (unit tests)
 * and is injected into browser pages (`page.addInitScript`). It follows the documented API; the
 * real SDK was not available (plan step 1), so it may differ in details.
 */
import type { MeetAddonSession, MeetGlobal } from '../../viewer/src/meet/meet-sdk';

/**
 * Source of a function `(hub, options) => MeetGlobal`. Options: `echo` makes a broadcast reach
 * its sender too; `fail` makes `broadcastStateUpdate` reject while true (`{ value: boolean }`).
 */
const SOURCE = `
(hub, options = {}) => {
  const mem = (globalThis.__fakeMeetState ??= new Map());
  const store = (() => { try { return localStorage; } catch { return null; } })();
  const key = 'fakemeet:' + hub + ':state';
  const read = () => (store ? store.getItem(key) : mem.get(key) ?? null);
  const write = (v) => (store ? store.setItem(key, v) : mem.set(key, v));
  const fail = options.fail ?? { value: false };
  return {
    addon: {
      async createAddonSession({ cloudProjectNumber }) {
        if (!/^[0-9]+$/.test(String(cloudProjectNumber))) throw new Error('bad project number');
        return {
          async createSidePanelClient() {
            return {
              frameToFrameMessage: null,
              getActivityStartingState: () => ({ additionalData: read() ?? undefined }),
              async startActivity(state) {
                write(state.additionalData);
                if (options.navigate !== false && typeof location !== 'undefined') {
                  location.assign(state.mainStageUrl);
                }
              },
              async notifyMainStage() {},
            };
          },
          async createMainStageClient() {
            return {
              frameToFrameMessage: null,
              getActivityStartingState: () => ({ additionalData: read() ?? undefined }),
              async notifySidePanel() {},
            };
          },
          createCoDoingClient(delegate) {
            const bc = new BroadcastChannel('fakemeet:' + hub + ':codoing');
            bc.onmessage = (e) => delegate.onCoDoingStateChanged({ bytes: e.data });
            return {
              async broadcastStateUpdate(state) {
                if (fail.value) throw new Error('co-doing unavailable');
                bc.postMessage(state.bytes);
                if (options.echo) delegate.onCoDoingStateChanged({ bytes: state.bytes });
              },
            };
          },
        };
      },
    },
  };
}`;

export interface FakeMeetOptions {
  echo?: boolean;
  navigate?: boolean;
  fail?: { value: boolean };
}

/** A fake `meet` global for pages of the call `hub` (use in node). */
export function fakeMeet(hub: string, options: FakeMeetOptions = {}): MeetGlobal {
  const make = (0, eval)(`(${SOURCE})`) as (h: string, o: FakeMeetOptions) => MeetGlobal;
  return make(hub, { navigate: false, ...options });
}

/** The addon session of a fake call, for tests that need it directly. */
export function fakeSession(hub: string, options: FakeMeetOptions = {}): Promise<MeetAddonSession> {
  return fakeMeet(hub, options).addon.createAddonSession({ cloudProjectNumber: '1' });
}

/** The init script that installs the fake as `window.meet` in a browser page. */
export function fakeMeetInit(): { script: (hub: string) => string } {
  return { script: (hub) => `window.meet = (${SOURCE})(${JSON.stringify(hub)});` };
}
