import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureAPI, CaptureCommand } from '../shared/types';
const api: CaptureAPI = {
  onCommand: callback => { ipcRenderer.on('capture-command', (_event, command: CaptureCommand) => callback(command)); },
  frame: (id, sequence, samples) => ipcRenderer.invoke('capture:frame', id, sequence, samples),
  started: (id, rate) => ipcRenderer.invoke('capture:started', id, rate),
  stopped: id => ipcRenderer.invoke('capture:stopped', id),
  failed: (id, code) => ipcRenderer.invoke('capture:failed', id, code),
  onDevices: callback => { ipcRenderer.on('devices-request', () => { void callback().then(items => ipcRenderer.send('devices-response', items)).catch(() => ipcRenderer.send('devices-response', [])); }); },
};
contextBridge.exposeInMainWorld('capture', api);
