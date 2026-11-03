// MIT License © 2026 Binary Dice Games
/**
 * @file The `channel` rendezvous' carrier over Meet's co-doing broadcast
 * (spec/08_meet_addon/DESIGN.md section 5).
 */
import type { SignalTransport } from '@inksplat/collab-session';
import type { MeetAddonSession } from './meet-sdk';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Broadcasts text to everyone else running the activity, and hears them. The SDK may echo our
 * own broadcast; the rendezvous ignores messages it cannot use, so an echo is harmless.
 * @param maxBytes the SDK's message limit if known (unmeasured: see DESIGN section 9)
 */
export function meetTransport(session: MeetAddonSession, maxBytes?: number): SignalTransport {
  const listeners = new Set<(text: string) => void>();
  const client = session.createCoDoingClient({
    activityTitle: 'inksplat',
    onCoDoingStateChanged: (state) => {
      let text: string;
      try {
        text = decoder.decode(state.bytes);
      } catch {
        return;
      }
      for (const listener of [...listeners]) {
        listener(text);
      }
    },
  });
  return {
    ...(maxBytes ? { maxBytes } : {}),
    send: (text) => client.broadcastStateUpdate({ bytes: encoder.encode(text) }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
