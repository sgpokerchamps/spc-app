const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');

// ── Paths ─────────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const resourcesPath = isDev ? __dirname : process.resourcesPath;
const assetsPath = path.join(resourcesPath, 'assets');
const srcPath = path.join(__dirname, 'src');

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let syncServer = null;
// Port can be set via SPC_PORT env var or --port=NNNN arg; defaults to 3456
let serverPort = (function() {
  var portArg = process.argv.find(function(a) { return a.indexOf('--port=') === 0; });
  if (portArg) return parseInt(portArg.split('=')[1], 10) || 3456;
  if (process.env.SPC_PORT) return parseInt(process.env.SPC_PORT, 10) || 3456;
  return 3456;
})();
let localIP = null;

// ── Update config ─────────────────────────────────────────────────────────────
const UPDATE_REPO = 'sgpokerchamps/spc-app';
const UPDATE_BRANCH = 'main';

function getUpdateDir() {
  var p = path.join(app.getPath('userData'), 'updates');
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

// Recursively copy a directory
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureUpdateAssets() {
  var updateDir = getUpdateDir();
  // Mirror fonts and lib from bundle if missing
  const bundleFonts = path.join(srcPath, 'fonts');
  const bundleLib = path.join(srcPath, 'lib');
  const updateFonts = path.join(updateDir, 'fonts');
  const updateLib = path.join(updateDir, 'lib');
  if (!fs.existsSync(updateFonts) && fs.existsSync(bundleFonts)) copyDir(bundleFonts, updateFonts);
  if (!fs.existsSync(updateLib) && fs.existsSync(bundleLib)) copyDir(bundleLib, updateLib);
}

function downloadGitHub(filename) {
  return new Promise(function(resolve, reject) {
    var url = 'https://raw.githubusercontent.com/' + UPDATE_REPO + '/' + UPDATE_BRANCH + '/' + filename;
    https.get(url, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, function(r2) {
          var d = ''; r2.on('data', function(c) { d += c; }); r2.on('end', function() { resolve(d); }); r2.on('error', reject);
        }).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      var d = ''; res.on('data', function(c) { d += c; }); res.on('end', function() { resolve(d); }); res.on('error', reject);
    }).on('error', reject);
  });
}

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

// ── Start sync server ─────────────────────────────────────────────────────────
function startSyncServer() {
  try {
    var updateDir = getUpdateDir();
    var updatedServer = path.join(updateDir, 'server.js');
    if (fs.existsSync(updatedServer)) {
      console.log('Loading server.js from updates folder');
      syncServer = require(updatedServer);
    } else {
      syncServer = require('./server');
    }
    syncServer.start(serverPort, (port) => {
      serverPort = port;
      localIP = getLocalIP();
      console.log(`Sync server running at http://${localIP}:${serverPort}`);
      if (mainWindow) {
        mainWindow.webContents.send('server-ready', { ip: localIP, port: serverPort });
      }
    });

    syncServer.onFloorAction((action) => {
      if (mainWindow) {
        mainWindow.webContents.send('floor-action', action);
      }
    });

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
    title: 'SPC Tournament Director (port ' + serverPort + ')',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(assetsPath, 'icons', 'spc.png'),
    show: false,
  });

  var updateDir = getUpdateDir();
  var updatedHtml = path.join(updateDir, 'app.html');
  if (fs.existsSync(updatedHtml)) {
    ensureUpdateAssets();
    console.log('Loading app.html from updates folder: ' + updatedHtml);
    mainWindow.loadFile(updatedHtml);
  } else {
    mainWindow.loadFile(path.join(srcPath, 'app.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (localIP) {
      mainWindow.webContents.send('server-ready', { ip: localIP, port: serverPort });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

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
  } catch (e) {}
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.on('clock-state-update', (event, state) => {
  if (syncServer) syncServer.broadcastClockState(state);
});

ipcMain.on('tournament-state-update', (event, state) => {
  if (syncServer) syncServer.broadcastTournamentState(state);
});

ipcMain.handle('get-server-info', () => ({
  ip: localIP, port: serverPort,
  url: localIP ? `http://${localIP}:${serverPort}` : null,
}));

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  return await dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('write-file', async (event, { filePath, content }) => {
  try { fs.writeFileSync(filePath, content, 'utf8'); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('read-file', async (event, { filePath }) => {
  try { return { success: true, content: fs.readFileSync(filePath, 'utf8') }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

// ── Update IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', async () => {
  try {
    var updateDir = getUpdateDir();
    var results = [];

    var appHtml = await downloadGitHub('app.html');
    if (appHtml && appHtml.length > 1000 && appHtml.indexOf('<!DOCTYPE') === 0) {
      fs.writeFileSync(path.join(updateDir, 'app.html'), appHtml, 'utf8');
      results.push('app.html (' + Math.round(appHtml.length / 1024) + 'KB)');
      // Make sure fonts and lib are available next to the updated html
      ensureUpdateAssets();
    } else {
      return { success: false, error: 'app.html invalid (' + (appHtml ? appHtml.length : 0) + ' bytes)' };
    }

    var serverJs = await downloadGitHub('server.js');
    if (serverJs && serverJs.length > 500) {
      fs.writeFileSync(path.join(updateDir, 'server.js'), serverJs, 'utf8');
      results.push('server.js (' + Math.round(serverJs.length / 1024) + 'KB)');
    }

    fs.writeFileSync(path.join(updateDir, 'updated_at.txt'), new Date().toISOString(), 'utf8');
    return { success: true, files: results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-update-info', () => {
  try {
    var updateDir = getUpdateDir();
    var tsFile = path.join(updateDir, 'updated_at.txt');
    if (fs.existsSync(tsFile)) {
      return { hasUpdates: true, updatedAt: fs.readFileSync(tsFile, 'utf8').trim() };
    }
    return { hasUpdates: false };
  } catch (e) { return { hasUpdates: false }; }
});

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
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
