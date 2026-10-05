const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, powerSaveBlocker, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const vm = require('vm');

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
// The second instance of the dual-instance fallback (--port=NNNN or SPC_PORT) must not grab the HDMI output as well.
const isSecondaryInstance = process.argv.some(function(a) { return a.indexOf('--port=') === 0; }) || !!process.env.SPC_PORT;
// The primary copy's data folder holds the shared hot-update files. A second copy gets its OWN data folder, otherwise Chromium
// gives it an empty, never-saved storage (the first copy holds the lock) and everything it holds is lost on quit or crash.
const primaryUserData = app.getPath('userData');
if (isSecondaryInstance) {
  const secondaryData = path.join(app.getPath('appData'), path.basename(primaryUserData) + '-port' + serverPort);
  try { fs.mkdirSync(secondaryData, { recursive: true }); app.setPath('userData', secondaryData); app.setPath('sessionData', secondaryData); }
  catch (e) { console.error('Could not set a separate data folder for the second copy: ' + e.message); }
}
let mainScreenWindow = null;      // the venue's main screen: full screen on the HDMI output, shows /display?screen=main
let mainScreenSuppressed = false; // set when the TD closes it from the desk; cleared by Reopen
let mainScreenSyncTimer = null;
let displayBlockerId = null;      // keeps the display from sleeping while the main-screen window is open
let serverIsUp = false;

// ── Update config ─────────────────────────────────────────────────────────────
const UPDATE_REPO = 'sgpokerchamps/spc-app';
const UPDATE_BRANCH = 'main';

function getUpdateDir() {
  var p = path.join(primaryUserData, 'updates'); // both copies run the same hot-updated files
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

function downloadGitHub(filename, ref) {
  return new Promise(function(resolve, reject) {
    var url = 'https://raw.githubusercontent.com/' + UPDATE_REPO + '/' + (ref || UPDATE_BRANCH) + '/' + filename;
    https.get(url, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, function(r2) {
          var d = ''; r2.setEncoding('utf8'); r2.on('data', function(c) { d += c; }); r2.on('end', function() { resolve(d); }); r2.on('error', reject);
        }).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      var d = ''; res.setEncoding('utf8'); res.on('data', function(c) { d += c; }); res.on('end', function() { resolve(d); }); res.on('error', reject);
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
      serverIsUp = true;
      localIP = getLocalIP();
      scheduleMainScreenSync();
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

let powerBlockerId = null;
let storageFlushTimer = null;

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
      // Multi-event rebuild: every live event's clock must keep ticking and broadcasting while the
      // window is minimised or hidden, so timers are not throttled when the window is in the background.
      backgroundThrottling: false,
    },
    icon: path.join(assetsPath, 'icons', 'spc.png'),
    show: false,
  });

  // Stop macOS App Nap from suspending the app while events are running.
  try {
    if (powerBlockerId === null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    console.log('[SPC] backgroundThrottling=false, powerSaveBlocker id=' + powerBlockerId);
  } catch (e) {
    console.error('powerSaveBlocker failed: ' + e.message);
  }

  // Chromium batches localStorage writes and only commits them to disk seconds to a minute later, so a crash
  // (kill -9, power loss of the app) could lose the latest busts and registrations. Flush pending storage often.
  if (storageFlushTimer === null) {
    storageFlushTimer = setInterval(() => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.session.flushStorageData(); } catch (e) {}
    }, 2000);
  }

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

// ── Main screen (venue HDMI output) ───────────────────────────
// A frameless full-screen window loading the served display page, so the main screen is pinned by the server exactly like
// the side screen and never follows the desk's focus. It lives on the first display that is NOT the one the desk window is on
// (a "not primary" rule would find nothing in clamshell mode, where the HDMI becomes the primary display).
function chooseMainScreenDisplay(displays, deskDisplayId) {
  for (var i = 0; i < displays.length; i++) { if (displays[i].id !== deskDisplayId) return displays[i]; }
  return null;
}
function deskDisplayId() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) return screen.getDisplayMatching(mainWindow.getBounds()).id;
  } catch (e) {}
  return screen.getPrimaryDisplay().id;
}
function describeDisplay(d) {
  if (!d) return null;
  return (d.label && d.label.length ? d.label : 'Display ' + d.id) + ' ' + d.bounds.width + 'x' + d.bounds.height;
}
function mainScreenStatusInfo() {
  var ext = chooseMainScreenDisplay(screen.getAllDisplays(), deskDisplayId());
  return {
    open: !!(mainScreenWindow && !mainScreenWindow.isDestroyed()),
    displayName: mainScreenWindow && !mainScreenWindow.isDestroyed() ? describeDisplay(screen.getDisplayMatching(mainScreenWindow.getBounds())) : null,
    externalAvailable: !!ext,
    externalName: describeDisplay(ext),
    secondaryInstance: isSecondaryInstance,
    suppressed: mainScreenSuppressed
  };
}
function stopDisplayBlocker() {
  try { if (displayBlockerId !== null && powerSaveBlocker.isStarted(displayBlockerId)) powerSaveBlocker.stop(displayBlockerId); } catch (e) {}
  displayBlockerId = null;
}
function closeMainScreenWindow() {
  var w = mainScreenWindow; mainScreenWindow = null;
  stopDisplayBlocker();
  try { if (w && !w.isDestroyed()) w.destroy(); } catch (e) {}
}
function openMainScreenWindow(display) {
  if (!display || !serverIsUp) return false;
  if (mainScreenWindow && !mainScreenWindow.isDestroyed()) {
    // already open: make sure it is on the right display
    try {
      var cur = screen.getDisplayMatching(mainScreenWindow.getBounds());
      if (cur.id !== display.id) { closeMainScreenWindow(); } else { return true; }
    } catch (e) { closeMainScreenWindow(); }
  }
  var b = display.bounds;
  var w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, enableLargerThanScreen: true, skipTaskbar: true, show: false, backgroundColor: '#000000', title: 'SPC Main Screen',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  mainScreenWindow = w;
  var url = 'http://127.0.0.1:' + serverPort + '/display?screen=main';
  var load = function() { if (mainScreenWindow === w && !w.isDestroyed()) w.loadURL(url).catch(function() {}); };
  w.webContents.on('did-fail-load', function() { setTimeout(load, 3000); });   // server not ready yet, or restarting
  w.webContents.on('will-navigate', function(e) { e.preventDefault(); });
  w.webContents.setWindowOpenHandler(function() { return { action: 'deny' }; });
  w.once('ready-to-show', function() {
    if (w.isDestroyed()) return;
    try {
      if (process.platform === 'darwin') {
        // macOS keeps the menu bar visible on a secondary display in (simple) full screen. Instead: a frameless window exactly on the
        // display's bounds at the screen-saver level, which draws above the menu bar and the Dock.
        w.setAlwaysOnTop(true, 'screen-saver');
        // skipTransformProcessType: without it Electron turns the whole app into a background agent (no Dock icon, no app menu bar).
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        w.setBounds(display.bounds);
        try { if (app.dock) app.dock.show(); } catch (e) {}   // belt and braces: keep the normal Dock icon and app menu
      } else {
        w.setFullScreen(true);
      }
    } catch (e) { console.error('main screen placement failed: ' + e.message); }
    w.showInactive();
  });
  w.on('closed', function() { if (mainScreenWindow === w) { mainScreenWindow = null; stopDisplayBlocker(); } });
  try { displayBlockerId = powerSaveBlocker.start('prevent-display-sleep'); } catch (e) { console.error('display blocker failed: ' + e.message); }
  load();
  console.log('[SPC] main screen window opened on ' + describeDisplay(display));
  return true;
}
// Open, move or close the main-screen window to match the displays that are connected right now.
function syncMainScreen() {
  if (mainScreenSuppressed || isSecondaryInstance || !serverIsUp || !app.isReady()) return;
  var ext = chooseMainScreenDisplay(screen.getAllDisplays(), deskDisplayId());
  if (!ext) { closeMainScreenWindow(); return; }
  openMainScreenWindow(ext);
}
// Display events arrive in bursts; wait for them to settle.
function scheduleMainScreenSync() {
  clearTimeout(mainScreenSyncTimer);
  mainScreenSyncTimer = setTimeout(syncMainScreen, 600);
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

// Main screen (venue HDMI output), driven from the desk's Screens panel
ipcMain.handle('main-screen-status', () => mainScreenStatusInfo());
ipcMain.handle('main-screen-open', () => { mainScreenSuppressed = false; if (!isSecondaryInstance) syncMainScreen(); return mainScreenStatusInfo(); });
ipcMain.handle('main-screen-close', () => { mainScreenSuppressed = true; closeMainScreenWindow(); return mainScreenStatusInfo(); });

// ── Update IPC ────────────────────────────────────────────────────────────────
// ── Safe update: stage everything in memory, ask, then apply together ─────────────
// (The older 'check-for-updates' below writes each file as soon as it is downloaded and is kept only for app packages
// whose renderer still calls it.)
const UPDATE_FILES = ['app.html', 'server.js', 'styles.css'].concat([
  '00_qrcode.js', '01_constants.js', '02_utils.js', '03_poty.js', '04_setup.js', '05_home.js',
  '06_sidebar.js', '07_views.js', '08_payouts.js', '09_potyview.js', '10_tournament.js'].map(function(n) { return 'js/' + n; }));
const STAGE_MAX_AGE_MS = 10 * 60 * 1000;
let stagedUpdate = null;

// Download every update file (all from one commit when the commit id is known), validate each one, and report which
// would change. Writes NOTHING. download(relPath, ref) -> Promise<string>; resolveRef() -> Promise<string>.
async function stageUpdateCore(download, resolveRef, updateDir) {
  var ref = UPDATE_BRANCH;
  try { var r = await resolveRef(); if (r) ref = r; } catch (e) { /* fall back to the branch name */ }
  var files = {};
  for (var i = 0; i < UPDATE_FILES.length; i++) {
    var rel = UPDATE_FILES[i];
    var content = await download(rel, ref);
    if (typeof content !== 'string') throw new Error(rel + ' did not download');
    if (rel === 'app.html' && !(content.length > 1000 && content.indexOf('<!DOCTYPE') === 0)) throw new Error('app.html invalid (' + content.length + ' bytes)');
    if (rel === 'server.js') {
      if (content.length < 500) throw new Error('server.js invalid (' + content.length + ' bytes)');
      try { new vm.Script(content); } catch (e) { throw new Error('server.js does not parse: ' + e.message); }
    }
    if (rel === 'styles.css' && content.length < 1000) throw new Error('styles.css invalid (' + content.length + ' bytes)');
    if (rel.indexOf('js/') === 0 && content.length < 200) throw new Error(rel + ' invalid (' + content.length + ' bytes)');
    files[rel] = content;
  }
  var changed = [];
  UPDATE_FILES.forEach(function(rel) {
    var cur = null;
    try { cur = fs.readFileSync(path.join(updateDir, rel), 'utf8'); } catch (e) {}
    if (cur !== files[rel]) changed.push(rel);
  });
  return { at: Date.now(), ref: ref, files: files, changed: changed };
}
// updates/previous/ holds the files the last update replaced (previous/files/<rel>) and previous/meta.json.
function snapshotForRollback(staged, updateDir, now) {
  // Built aside as previous.new; it replaces 'previous' only after the update itself has succeeded, so a failed update never
  // costs you the older rollback point.
  var prev = path.join(updateDir, 'previous.new');
  fs.rmSync(prev, { recursive: true, force: true });
  fs.mkdirSync(path.join(prev, 'files'), { recursive: true });
  var had = [], added = [], oldAt = null;
  staged.changed.forEach(function(rel) {
    var src = path.join(updateDir, rel);
    if (fs.existsSync(src)) {
      var dst = path.join(prev, 'files', rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      had.push(rel);
    } else added.push(rel);
  });
  var tsFile = path.join(updateDir, 'updated_at.txt');
  if (fs.existsSync(tsFile)) { oldAt = fs.readFileSync(tsFile, 'utf8').trim(); fs.copyFileSync(tsFile, path.join(prev, 'files', 'updated_at.txt')); }
  fs.writeFileSync(path.join(prev, 'meta.json'), JSON.stringify({ appliedAt: now, ref: String(staged.ref || ''), previousUpdatedAt: oldAt, had: had, added: added }), 'utf8');
}
function rollbackInfoCore(updateDir) {
  try {
    var m = JSON.parse(fs.readFileSync(path.join(updateDir, 'previous', 'meta.json'), 'utf8'));
    return { exists: true, appliedAt: m.appliedAt, previousUpdatedAt: m.previousUpdatedAt, ref: String(m.ref || '').slice(0, 7), count: (m.had || []).length + (m.added || []).length };
  } catch (e) { return { exists: false }; }
}
// Put the files back that the last update replaced, and remove the ones it added. All-or-nothing: every saved file is checked
// first, each is written to a temp name, then renamed. The snapshot is removed afterwards (no flip-flopping between versions).
function rollbackCore(updateDir) {
  var prev = path.join(updateDir, 'previous'), m;
  try { m = JSON.parse(fs.readFileSync(path.join(prev, 'meta.json'), 'utf8')); } catch (e) { return { success: false, error: 'There is no previous version saved.' }; }
  var restore = (m.had || []).slice(); if (m.previousUpdatedAt !== null && m.previousUpdatedAt !== undefined) restore.push('updated_at.txt');
  var tmps = [];
  try {
    restore.forEach(function(rel) { if (!fs.existsSync(path.join(prev, 'files', rel))) throw new Error('the saved copy of ' + rel + ' is missing'); });
    restore.forEach(function(rel) {
      var dest = path.join(updateDir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
      var tmp = dest + '.rollback-tmp'; fs.copyFileSync(path.join(prev, 'files', rel), tmp); tmps.push([tmp, dest]);
    });
    tmps.forEach(function(p) { fs.renameSync(p[0], p[1]); });
    (m.added || []).forEach(function(rel) { try { fs.unlinkSync(path.join(updateDir, rel)); } catch (e) {} });
    fs.rmSync(prev, { recursive: true, force: true });
    return { success: true, restored: restore.length, removed: (m.added || []).length };
  } catch (err) {
    tmps.forEach(function(p) { try { fs.unlinkSync(p[0]); } catch (e) {} });
    return { success: false, error: err.message + '. Nothing was changed.' };
  }
}
// Write the changed files: each to a temp name first, then rename them all. On any failure the temp files are removed
// and the existing files are left exactly as they were.
function applyStagedCore(staged, updateDir, now) {
  if (!staged || (now - staged.at) > STAGE_MAX_AGE_MS) return { success: false, error: 'No fresh update is staged. Check again.' };
  var tmps = [];
  try {
    // Save what is about to be replaced so the last update can be rolled back (only the most recent one is kept).
    // If this fails nothing is changed.
    try { snapshotForRollback(staged, updateDir, now); }
    catch (e) { try { fs.rmSync(path.join(updateDir, 'previous.new'), { recursive: true, force: true }); } catch (e2) {} return { success: false, error: 'Could not save the previous version, so nothing was changed: ' + e.message }; }
    staged.changed.forEach(function(rel) {
      var dest = path.join(updateDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      var tmp = dest + '.update-tmp';
      fs.writeFileSync(tmp, staged.files[rel], 'utf8');
      tmps.push([tmp, dest]);
    });
    tmps.forEach(function(p) { fs.renameSync(p[0], p[1]); });
    fs.writeFileSync(path.join(updateDir, 'updated_at.txt'), new Date().toISOString(), 'utf8');
    try { fs.rmSync(path.join(updateDir, 'previous'), { recursive: true, force: true }); fs.renameSync(path.join(updateDir, 'previous.new'), path.join(updateDir, 'previous')); } catch (e) { /* update is applied; just no rollback point */ }
    return { success: true, files: staged.changed.slice() };
  } catch (err) {
    tmps.forEach(function(p) { try { fs.unlinkSync(p[0]); } catch (e) {} });
    try { fs.rmSync(path.join(updateDir, 'previous.new'), { recursive: true, force: true }); } catch (e) {}
    return { success: false, error: err.message };
  }
}
function resolveUpdateRef() {
  return new Promise(function(resolve, reject) {
    https.get({ hostname: 'api.github.com', path: '/repos/' + UPDATE_REPO + '/commits/' + UPDATE_BRANCH,
      headers: { 'User-Agent': 'spc-tournament-director', 'Accept': 'application/vnd.github+json' } }, function(res) {
      var d = ''; res.setEncoding('utf8'); res.on('data', function(c) { d += c; });
      res.on('end', function() { try { var j = JSON.parse(d); resolve(j && typeof j.sha === 'string' && /^[0-9a-f]{40}$/.test(j.sha) ? j.sha : null); } catch (e) { resolve(null); } });
      res.on('error', reject);
    }).on('error', reject);
  });
}
ipcMain.handle('update-stage', async () => {
  try {
    stagedUpdate = await stageUpdateCore(downloadGitHub, resolveUpdateRef, getUpdateDir());
    return { success: true, changed: stagedUpdate.changed.slice(), total: UPDATE_FILES.length, ref: String(stagedUpdate.ref).slice(0, 7) };
  } catch (err) {
    stagedUpdate = null;
    return { success: false, error: err.message };
  }
});
ipcMain.handle('rollback-info', () => rollbackInfoCore(getUpdateDir()));
ipcMain.handle('rollback-update', () => rollbackCore(getUpdateDir()));
ipcMain.handle('update-apply', async () => {
  var r = applyStagedCore(stagedUpdate, getUpdateDir(), Date.now());
  if (r.success) { stagedUpdate = null; try { ensureUpdateAssets(); } catch (e) {} }
  return r;
});

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

    var stylesCss = await downloadGitHub('styles.css');
    if (stylesCss && stylesCss.length > 1000) {
      fs.writeFileSync(path.join(updateDir, 'styles.css'), stylesCss, 'utf8');
      results.push('styles.css (' + Math.round(stylesCss.length / 1024) + 'KB)');
    } else {
      return { success: false, error: 'styles.css invalid (' + (stylesCss ? stylesCss.length : 0) + ' bytes)' };
    }

    // js/ folder — fixed list matching the current 10-file split.
    // If a new file gets added to the split later, add its name here too.
    var updateJsDir = path.join(updateDir, 'js');
    if (!fs.existsSync(updateJsDir)) fs.mkdirSync(updateJsDir, { recursive: true });
    var jsFiles = [
      '00_qrcode.js', '01_constants.js', '02_utils.js', '03_poty.js', '04_setup.js', '05_home.js',
      '06_sidebar.js', '07_views.js', '08_payouts.js', '09_potyview.js', '10_tournament.js',
    ];
    for (var i = 0; i < jsFiles.length; i++) {
      var jsName = jsFiles[i];
      var jsContent = await downloadGitHub('js/' + jsName);
      if (jsContent && jsContent.length > 200) {
        fs.writeFileSync(path.join(updateJsDir, jsName), jsContent, 'utf8');
        results.push('js/' + jsName + ' (' + Math.round(jsContent.length / 1024) + 'KB)');
      } else {
        return { success: false, error: 'js/' + jsName + ' invalid (' + (jsContent ? jsContent.length : 0) + ' bytes)' };
      }
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
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();   // not "no windows": the main-screen window may still be open
  });
  screen.on('display-added', scheduleMainScreenSync);
  screen.on('display-removed', scheduleMainScreenSync);
  screen.on('display-metrics-changed', scheduleMainScreenSync);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeMainScreenWindow();
  if (syncServer) syncServer.stop();
});
