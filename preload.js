/**
 * Preload script — bridges Electron IPC to renderer safely
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Server info
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  onServerReady: (cb) => ipcRenderer.on('server-ready', (_, data) => cb(data)),

  // Floor actions received from phones
  onFloorAction: (cb) => ipcRenderer.on('floor-action', (_, action) => cb(action)),

  // Clock state — push to server for floor UI
  sendClockState: (state) => ipcRenderer.send('clock-state-update', state),

  // Tournament state — push to server for floor UI
  sendTournamentState: (state) => ipcRenderer.send('tournament-state-update', state),

  // App version
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Native file dialogs
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', { filePath, content }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateInfo: () => ipcRenderer.invoke('get-update-info'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Platform
  platform: process.platform,
});
