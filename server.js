const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const http = require('http');

// ── Paths ─────────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const resourcesPath = isDev ? __dirname : process.resourcesPath;
const assetsPath = path.join(resourcesPath, 'assets');
const srcPath = path.join(__dirname, 'src');

// ── Update paths ──────────────────────────────────────────────────────────────
const UPDATE_REPO = 'sgpokerchamps/spc-app'; // GitHub repo for updates
const UPDATE_BRANCH = 'main';
let updatePath = null; // set after app.whenReady

function getUpdatePath() {
  const p = path.join(app.getPath('userData'), 'updates');
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function getAppHtmlPath() {
  if (updatePath) {
    const updated = path.join(updatePath, 'app.html');
    if (fs.existsSync(updated)) {
      console.log('Loading app.html from updates folder');
      return updated;
    }
  }
  return path.join(srcPath, 'app.html');
}

function getServerPath() {
  if (updatePath) {
    const updated = path.join(updatePath, 'server.js');
    if (fs.existsSync(updated)) {
      console.log('Loading server.js from updates folder');
      return updated;
    }
  }
  return path.join(__dirname, 'server.js');
}

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let syncServer = null;
let serverPort = 3456;
let localIP = null;

// ── Get local IP ──────────────────────────────────────────────────────────────
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ── Download file from GitHub ─────────────────────────────────────────────────
function downloadFile(filename) {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_BRANCH}/${filename}`;
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        https.get(response.headers.location, (r2) => {
          let data = '';
          r2.on('data', (chunk) => { data += chunk; });
          r2.on('end', () => resolve(data));
          r2.on('error', reject);
        }).on('error', reject);
        return;
      }
      if (response.statusCode === 404) {
        reject(new Error(`${filename} not found in repo ${UPDATE_REPO}`));
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} fetching ${filename}`));
        return;
      }
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve(data));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(30000, () => { request.destroy(); reject(new Error('Download timeout')); });
  });
}

// ── Start sync server ─────────────────────────────────────────────────────────
function startSyncServer() {
  try {
    const serverPath = getServerPath();
    syncServer = require(serverPath);
    syncServer.start(serverPort, (port) => {
      serverPort = port;
      localIP = getLocalIP();
      console.log(`Sync server running at http://${localIP}:${serverPort}`);
      if (mainWindow) {
        mainWindow.webContents.send('server-ready', { ip: localIP, port: serverPort });
      }
    });

    // Forward floor actions to main window
    syncServer.onFloorAction((action) => {
      if (mainWindow) {
        mainWindow.webContents.send('floor-action', action);
      }
    });

    // Forward clock state requests
    syncServer.onClockRequest(() => {
      if (mainWindow) {
        mainWindow.webContents.send('clock-state-request');
      }
    });
  } catch (err) {
    console.error('Could not start sync server:', err.message);
  }
}

// ── Create main window ────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#06090a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(assetsPath, 'icons', 'spc.png'),
    show: false,
  });

  mainWindow.loadFile(getAppHtmlPath());

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (localIP) {
      mainWindow.webContents.send('server-ready', { ip: localIP, port: serverPort });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(assetsPath, 'icons', 'spc.png'));
    const trayIcon = icon.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('SPC Tournament Director');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show App', click: () => { if (mainWindow) mainWindow.show(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) mainWindow.show(); });
  } catch (e) {
    // Tray is optional
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// App sends clock state to server (for floor UI)
ipcMain.on('clock-state-update', (event, state) => {
  if (syncServer) syncServer.broadcastClockState(state);
});

// App sends tournament state to server (for floor UI)
ipcMain.on('tournament-state-update', (event, state) => {
  if (syncServer) syncServer.broadcastTournamentState(state);
});

// Get server info
ipcMain.handle('get-server-info', () => ({
  ip: localIP,
  port: serverPort,
  url: localIP ? `http://${localIP}:${serverPort}` : null,
}));

// Get app version
ipcMain.handle('get-version', () => app.getVersion());

// Show save dialog
ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

// Show open dialog
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Write file
ipcMain.handle('write-file', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Read file
ipcMain.handle('read-file', async (event, { filePath }) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// User data path for saves
ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

// ── Update IPC handlers ──────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', async () => {
  try {
    const results = [];

    // Download app.html
    const appHtml = await downloadFile('app.html');
    if (appHtml && appHtml.length > 1000) {
      fs.writeFileSync(path.join(updatePath, 'app.html'), appHtml, 'utf8');
      results.push('app.html (' + Math.round(appHtml.length / 1024) + 'KB)');
    }

    // Download server.js
    const serverJs = await downloadFile('server.js');
    if (serverJs && serverJs.length > 500) {
      fs.writeFileSync(path.join(updatePath, 'server.js'), serverJs, 'utf8');
      results.push('server.js (' + Math.round(serverJs.length / 1024) + 'KB)');
    }

    if (results.length === 0) {
      return { success: false, error: 'No valid files downloaded' };
    }

    // Write timestamp
    fs.writeFileSync(path.join(updatePath, 'updated_at.txt'), new Date().toISOString(), 'utf8');

    return { success: true, files: results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-update-info', () => {
  try {
    const tsFile = path.join(updatePath, 'updated_at.txt');
    if (fs.existsSync(tsFile)) {
      return { hasUpdates: true, updatedAt: fs.readFileSync(tsFile, 'utf8').trim() };
    }
    return { hasUpdates: false };
  } catch (e) {
    return { hasUpdates: false };
  }
});

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  updatePath = getUpdatePath();
  startSyncServer();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (syncServer) syncServer.stop();
});
