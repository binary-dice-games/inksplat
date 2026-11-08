// MIT License © 2026 Binary Dice Games
/** @file The overlay's preload: only the port from the session window, handed to the page. */
import { ipcRenderer } from 'electron';
import { IPC } from '../shared/protocol';
import { PORT_MESSAGE } from '../shared/bridge';

ipcRenderer.on(IPC.port, (e) => window.postMessage(PORT_MESSAGE, '*', e.ports));
