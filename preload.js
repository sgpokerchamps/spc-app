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

  // Main screen (venue HDMI output)
  openMainScreen: () => ipcRenderer.invoke('main-screen-open'),
  closeMainScreen: () => ipcRenderer.invoke('main-screen-close'),
  mainScreenStatus: () => ipcRenderer.invoke('main-screen-status'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),   // older: writes files immediately
  stageUpdate: () => ipcRenderer.invoke('update-stage'),            // newer: download and check, change nothing
  applyUpdate: () => ipcRenderer.invoke('update-apply'),
  rollbackInfo: () => ipcRenderer.invoke('rollback-info'),          // is there a saved previous version, and when
  rollbackUpdate: () => ipcRenderer.invoke('rollback-update'),      // put the files of the last update back (then restartApp)            // then write the staged files together
  getUpdateInfo: () => ipcRenderer.invoke('get-update-info'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Platform
  platform: process.platform,
});
