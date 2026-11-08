// MIT License © 2026 Binary Dice Games
/** @file The control window's preload: its state in, the person's actions out. */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/protocol';
import type { ControlBridge } from '../shared/bridge';

const bridge: ControlBridge = {
  onState: (cb) => {
    ipcRenderer.on(IPC.state, (_e, state) => cb(state));
  },
  act: (action) => ipcRenderer.send(IPC.action, action),
};
contextBridge.exposeInMainWorld('support', bridge);
