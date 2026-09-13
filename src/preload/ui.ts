import { contextBridge, ipcRenderer } from 'electron';
import type { UIAPI, View } from '../shared/types';
const api: UIAPI = {
  snapshot: () => ipcRenderer.invoke('ui:snapshot'), toggle: mode => ipcRenderer.invoke('ui:toggle', mode),
  cancel: () => ipcRenderer.invoke('ui:cancel'), copy: id => ipcRenderer.invoke('ui:copy', id),
  insertTest: id => ipcRenderer.invoke('ui:insert-test', id), save: settings => ipcRenderer.invoke('ui:save', settings),
  importAsset: kind => ipcRenderer.invoke('ui:import-asset', kind), dictionary: () => ipcRenderer.invoke('ui:dictionary'),
  saveDictionary: value => ipcRenderer.invoke('ui:save-dictionary', value), importDictionary: () => ipcRenderer.invoke('ui:import-dictionary'),
  exportDictionary: () => ipcRenderer.invoke('ui:export-dictionary'), showSettings: () => ipcRenderer.invoke('ui:settings'),
  devices: () => ipcRenderer.invoke('ui:devices'),
  onView: callback => { ipcRenderer.on('view', (_event, view: View) => callback(view)); },
};
contextBridge.exposeInMainWorld('batty', api);
