import { contextBridge, ipcRenderer } from 'electron';
import type { UIAPI, View } from '../shared/types';

const api: UIAPI = {
  snapshot: () => ipcRenderer.invoke('ui:snapshot'),
  toggle: mode => ipcRenderer.invoke('ui:toggle', mode),
  cancel: () => ipcRenderer.invoke('ui:cancel'),
  copy: id => ipcRenderer.invoke('ui:copy', id),
  copyText: text => ipcRenderer.invoke('ui:copy-text', text),
  insertTest: id => ipcRenderer.invoke('ui:insert-test', id),
  save: settings => ipcRenderer.invoke('ui:save', settings),
  importAsset: kind => ipcRenderer.invoke('ui:import-asset', kind),
  download: id => ipcRenderer.invoke('ui:download', id),
  cancelDownload: id => ipcRenderer.invoke('ui:cancel-download', id),
  useAsset: id => ipcRenderer.invoke('ui:use-asset', id),
  removeAsset: id => ipcRenderer.invoke('ui:remove-asset', id),
  dictionary: () => ipcRenderer.invoke('ui:dictionary'),
  saveDictionary: value => ipcRenderer.invoke('ui:save-dictionary', value),
  importDictionary: () => ipcRenderer.invoke('ui:import-dictionary'),
  exportDictionary: () => ipcRenderer.invoke('ui:export-dictionary'),
  history: () => ipcRenderer.invoke('ui:history'),
  deleteHistory: id => ipcRenderer.invoke('ui:delete-history', id),
  clearHistory: () => ipcRenderer.invoke('ui:clear-history'),
  showSettings: () => ipcRenderer.invoke('ui:settings'),
  hideOverlay: () => ipcRenderer.invoke('ui:hide-overlay'),
  overlayHover: inside => ipcRenderer.invoke('ui:overlay-hover', inside),
  suspendShortcuts: suspended => ipcRenderer.invoke('ui:suspend-shortcuts', suspended),
  openLink: name => ipcRenderer.invoke('ui:open-link', name),
  devices: () => ipcRenderer.invoke('ui:devices'),
  onView: callback => {
    ipcRenderer.on('view', (_event, view: View) => callback(view));
  },
};
contextBridge.exposeInMainWorld('batty', api);
