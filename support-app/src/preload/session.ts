// MIT License © 2026 Binary Dice Games
/**
 * @file The session window's preload: commands in, reports out, and the port to the overlay
 * handed to the page.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/protocol';
import { PORT_MESSAGE } from '../shared/bridge';
import type { SessionBridge } from '../shared/bridge';

const bridge: SessionBridge = {
  onCommand: (cb) => {
    ipcRenderer.on(IPC.command, (_e, command) => cb(command));
  },
  report: (report) => ipcRenderer.send(IPC.report, report),
};
contextBridge.exposeInMainWorld('support', bridge);
ipcRenderer.on(IPC.port, (e) => window.postMessage(PORT_MESSAGE, '*', e.ports));
