import { contextBridge, ipcRenderer } from 'electron';

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('acc', {
  reconnect: () => ipcRenderer.invoke('acc:reconnect'),
  onConnected: (cb) => subscribe('acc:connected', cb),
  onRegistrationFailed: (cb) => subscribe('acc:registrationFailed', cb),
  onRealtimeUpdate: (cb) => subscribe('acc:realtimeUpdate', cb),
  onRealtimeCarUpdate: (cb) => subscribe('acc:realtimeCarUpdate', cb),
  onEntryList: (cb) => subscribe('acc:entryList', cb),
  onEntryListCar: (cb) => subscribe('acc:entryListCar', cb),
  getEntryList: () => ipcRenderer.invoke('acc:getEntryList'),
  onTrackData: (cb) => subscribe('acc:trackData', cb),
  onBroadcastingEvent: (cb) => subscribe('acc:broadcastingEvent', cb),
  onError: (cb) => subscribe('acc:error', cb),
  onParseError: (cb) => subscribe('acc:parseError', cb),
  onReregistering: (cb) => subscribe('acc:reregistering', cb),
  onPhysics: (cb) => subscribe('acc:physics', cb),
  onStaticTelemetry: (cb) => subscribe('acc:staticTelemetry', cb),
  onGraphics: (cb) => subscribe('acc:graphics', cb),
  onSharedMemoryError: (cb) => subscribe('acc:sharedMemoryError', cb),
});

contextBridge.exposeInMainWorld('editMode', {
  get: () => ipcRenderer.invoke('editMode:get'),
  toggle: () => ipcRenderer.invoke('editMode:toggle'),
  onChanged: (cb) => subscribe('editMode:changed', cb),
});

contextBridge.exposeInMainWorld('widgets', {
  list: () => ipcRenderer.invoke('widgets:list'),
  setEnabled: (id, enabled) =>
    ipcRenderer.invoke('widgets:setEnabled', id, enabled),
  onChanged: (cb) => subscribe('widgets:changed', cb),
});

contextBridge.exposeInMainWorld('overlay', {
  resizeStart: () => ipcRenderer.invoke('overlay:resizeStart'),
  resizeBy: (dx, dy) => ipcRenderer.invoke('overlay:resizeBy', dx, dy),
});

contextBridge.exposeInMainWorld('remote', {
  getStatus: () => ipcRenderer.invoke('remote:getStatus'),
  setEnabled: (enabled) => ipcRenderer.invoke('remote:setEnabled', enabled),
  onStatus: (cb) => subscribe('remote:status', cb),
});

contextBridge.exposeInMainWorld('app', {
  getVersion: () => ipcRenderer.invoke('app:version'),
});

contextBridge.exposeInMainWorld('profiles', {
  list: () => ipcRenderer.invoke('profiles:list'),
  create: (name) => ipcRenderer.invoke('profiles:create', name),
  rename: (oldName, newName) =>
    ipcRenderer.invoke('profiles:rename', oldName, newName),
  delete: (name) => ipcRenderer.invoke('profiles:delete', name),
  switch: (name) => ipcRenderer.invoke('profiles:switch', name),
  setEnabled: (enabled) => ipcRenderer.invoke('profiles:setEnabled', enabled),
  save: () => ipcRenderer.invoke('profiles:save'),
  onDirtyChanged: (cb) => subscribe('profiles:dirtyChanged', cb),
});
