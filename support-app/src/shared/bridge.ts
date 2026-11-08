// MIT License © 2026 Binary Dice Games
/**
 * @file What each preload exposes to its page (`window.support`): a few typed calls, never a
 * Node API (spec/08_remote_support/DESIGN.md section 4.1).
 */
import type { ControlAction, ControlState, SessionCommand, SessionReport } from './protocol';

/** The control window's bridge. */
export interface ControlBridge {
  onState(cb: (state: ControlState) => void): void;
  act(action: ControlAction): void;
}

/** The session window's bridge. */
export interface SessionBridge {
  onCommand(cb: (command: SessionCommand) => void): void;
  report(report: SessionReport): void;
}

/** The message a preload posts to its page with the port to the other window. */
export const PORT_MESSAGE = 'inksplat-support-port';
