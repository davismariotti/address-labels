const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('./store.js');
const Projects = require('../shared/projects.js');
const { layout } = require('../shared/layout.js');

app.setName('Address Labels');

// ---------- data folder ----------
function resolveDataDir() {
  if (process.env.ADDRESS_LABELS_DATA) return path.resolve(process.env.ADDRESS_LABELS_DATA);
  return app.isPackaged ? app.getPath('userData') : path.resolve(__dirname, '..', '..');
}
const dataDir = resolveDataDir();
const store = createStore(dataDir);
let settings = null; // { nudge, checkedIds, notice? }
let mainWindow = null;
let printWindow = null;
let printPayload = null;
const outputPayloads = new Map();

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const w = printWindow || mainWindow;
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

// ---------- global error logging ----------
process.on('uncaughtException', (e) => store.log('error', `uncaughtException: ${e.stack || e}`));
process.on('unhandledRejection', (e) => store.log('error', `unhandledRejection: ${e && e.stack ? e.stack : e}`));

// ---------- windows ----------
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};
const rendererFile = (name) => path.join(__dirname, '..', 'renderer', name);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 720, minWidth: 900, minHeight: 520,
    title: 'Address Labels',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#00000000',
    show: false,
    webPreferences,
  });
  mainWindow.loadFile(rendererFile('index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('render-process-gone', (_e, d) => store.log('error', `renderer gone: ${d.reason}`));
  mainWindow.on('close', async (e) => {
    if (!hasUnsaved() || forceClose) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'warning', message: 'Your latest changes could not be saved.',
      detail: 'You can export a copy of your list before quitting.',
      buttons: ['Export a copy…', 'Quit anyway', 'Cancel'], defaultId: 0, cancelId: 2,
    });
    if (r.response === 0) { const x = await exportCopy(unsavedExport()); if (x.ok) { forceClose = true; app.quit(); } }
    else if (r.response === 1) { forceClose = true; app.quit(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openPrintWindow(payload) {
  if (printWindow) { printWindow.focus(); return; }
  printPayload = payload;
  printWindow = new BrowserWindow({
    width: 960, height: 680, minWidth: 920, minHeight: 640,
    parent: mainWindow, modal: true,
    title: payload.test ? 'Print Alignment Test' : payload.projectName ? `Print Labels — ${payload.projectName}` : 'Print Labels',
    minimizable: false, maximizable: false,
    show: false,
    webPreferences,
  });
  printWindow.loadFile(rendererFile('print.html'));
  printWindow.once('ready-to-show', () => printWindow.show());
  printWindow.on('closed', () => { printWindow = null; printPayload = null; });
}

// ---------- output (print / PDF) ----------
async function withOutputWindow(job, fn) {
  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  outputPayloads.set(id, job);
  const win = new BrowserWindow({ show: false, width: 816, height: 1056, webPreferences });
  try {
    const ready = new Promise((resolve) => ipcMain.once(`output:ready:${id}`, resolve));
    await win.loadFile(rendererFile('output.html'), { query: { id } });
    await ready;
    return await fn(win);
  } finally {
    outputPayloads.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

const pdfOptions = { pageSize: 'Letter', printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } };

async function savePdf(job) {
  const parent = printWindow || mainWindow;
  // Test hook: skip the native save dialog and write to this path.
  const res = process.env.ADDRESS_LABELS_TEST_PDF
    ? { canceled: false, filePath: process.env.ADDRESS_LABELS_TEST_PDF }
    : await dialog.showSaveDialog(parent, {
      title: 'Save as PDF', defaultPath: path.join(app.getPath('documents'), 'Address Labels.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const data = await withOutputWindow(job, (win) => win.webContents.printToPDF(pdfOptions));
    fs.writeFileSync(res.filePath, data);
    return { ok: true, path: res.filePath };
  } catch (e) {
    store.log('error', `savePdf failed: ${e.message}`);
    return { ok: false, error: `Could not write to ${path.dirname(res.filePath)}: ${e.message}` };
  }
}

function printNative(job) {
  // Test hook: replace the system print step with a fixed outcome.
  const hook = process.env.ADDRESS_LABELS_TEST_PRINT;
  if (hook === 'ok') return Promise.resolve({ ok: true });
  if (hook === 'cancel') return Promise.resolve({ ok: false, canceled: true });
  if (hook === 'fail') return Promise.resolve({ ok: false, error: 'Printing failed: test failure' });
  return withOutputWindow(job, (win) => new Promise((resolve) => {
    win.webContents.print(
      { silent: false, printBackground: true, margins: { marginType: 'none' }, pageSize: 'Letter', scaleFactor: 100 },
      (success, reason) => {
        if (success) resolve({ ok: true });
        else if (/cancel/i.test(reason || '')) resolve({ ok: false, canceled: true });
        else { store.log('warn', `print failed: ${reason}`); resolve({ ok: false, error: `Printing failed: ${reason || 'unknown error'}` }); }
      },
    );
  }));
}

// ---------- IPC ----------
function legacyCandidate() {
  const candidate = process.env.ADDRESS_LABELS_LEGACY || path.join(os.homedir(), 'Documents', 'addresses', 'addresses.json');
  return candidate !== store.file && fs.existsSync(candidate) ? candidate : null;
}

ipcMain.handle('app:init', () => {
  const loaded = store.load();
  settings = store.loadSettings();
  let pl = store.loadProjects();
  let migrated = null;
  let migrationError = null;
  if (pl.status === 'missing' && loaded.status === 'ok') {
    const m = store.migrateProjects(loaded.people);
    if (m.error) migrationError = m.error;
    if (m.migrated || m.error === undefined) {
      migrated = m.migrated;
      settings = store.loadSettings();
      pl = store.loadProjects();
    }
  }
  // Orphaned recipients are pruned at launch only, so undoing a person delete can still restore them.
  if (pl.status === 'ok' && loaded.status === 'ok') pl = { ...pl, projects: store.pruneOrphans(pl.projects, loaded.people.map((p) => p.id)) };
  return {
    ...loaded, settings, dataDir, projects: pl, migrated, migrationError,
    legacyFound: loaded.status === 'missing' ? !!legacyCandidate() : false,
  };
});
ipcMain.handle('projects:save', (_e, projects) => store.saveProjects(projects));
ipcMain.handle('people:save', (_e, people) => store.save(people));
ipcMain.handle('settings:update', (_e, patch) => {
  settings = { ...settings, ...patch, nudge: { ...settings.nudge, ...(patch.nudge || {}) } };
  const r = store.saveSettings(settings);
  if (printWindow && patch.nudge) printWindow.webContents.send('settings:changed', settings);
  return r;
});
ipcMain.handle('print:open', (_e, payload) => { openPrintWindow(payload); });
ipcMain.handle('print:init', () => ({ payload: printPayload, settings }));
ipcMain.handle('print:close', () => { if (printWindow) printWindow.close(); });
ipcMain.handle('print:printers', async () => {
  if (process.env.ADDRESS_LABELS_TEST_NO_PRINTER) return []; // test hook
  try { return (await (printWindow || mainWindow).webContents.getPrintersAsync()).map((p) => p.name); } catch { return []; }
});
/** Tell the main window a print / PDF finished, so it can record a run. The print window never writes project files. */
function notifyCompleted(kind, job) {
  if (!mainWindow || !printPayload || !printPayload.projectId) return;
  const sheetCount = layout(job.labels, job.startCell, job.nudge).sheetCount;
  mainWindow.webContents.send('print:completed', {
    projectId: printPayload.projectId, kind, startCell: job.startCell, sheetCount, at: new Date().toISOString(),
    entries: Projects.entriesFromLabels(job.labels),
  });
}
ipcMain.handle('print:native', async (_e, job) => { const r = await printNative(job); if (r.ok) notifyCompleted('print', job); return r; });
ipcMain.handle('print:pdf', async (_e, job) => { const r = await savePdf(job); if (r.ok) notifyCompleted('pdf', job); return r; });
ipcMain.handle('output:data', (_e, id) => outputPayloads.get(id));
ipcMain.on('output:ready', (_e, id) => ipcMain.emit(`output:ready:${id}`));
ipcMain.handle('backups:list', (_e, kind) => store.listBackups(kind === 'projects' ? 'projects' : 'addresses'));
ipcMain.handle('backups:restore', (_e, name, kind) => (kind === 'projects' ? store.restoreProjectsBackup(name) : store.restoreBackup(name)));
ipcMain.handle('dialog:restore-file', async () => {
  const r = await dialog.showMessageBox(mainWindow, {
    type: 'question', message: 'Restore from Backup', detail: 'Which file do you want to restore?',
    buttons: ['Addresses', 'Projects', 'Cancel'], cancelId: 2, defaultId: 0,
  });
  return r.response === 0 ? 'addresses' : r.response === 1 ? 'projects' : null;
});
ipcMain.handle('folder:show', () => { shell.showItemInFolder(fs.existsSync(store.file) ? store.file : dataDir); });
ipcMain.handle('log:open', () => openLog());
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('legacy:import', () => {
  const src = legacyCandidate();
  if (!src) return { ok: false, error: 'No addresses.json found to import.' };
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.copyFileSync(src, store.file); } catch (e) { return { ok: false, error: e.message }; }
  const loaded = store.load();
  return { ok: true, ...loaded };
});
async function exportCopy(people) {
  const res = process.env.ADDRESS_LABELS_TEST_EXPORT
    ? { canceled: false, filePath: process.env.ADDRESS_LABELS_TEST_EXPORT }
    : await dialog.showSaveDialog(mainWindow, {
      title: 'Export a copy', defaultPath: path.join(app.getPath('documents'), 'addresses-copy.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(res.filePath, JSON.stringify(people, null, 2)); return { ok: true, path: res.filePath }; } catch (e) { return { ok: false, error: e.message }; }
}
ipcMain.handle('export:copy', (_e, people) => exportCopy(people));

// Unsaved changes (a save is failing): remember them so quitting can offer an export.
let unsavedPeople = null;
let unsavedProjects = null;
let forceClose = false;
const hasUnsaved = () => !!(unsavedPeople || unsavedProjects);
ipcMain.handle('app:unsaved', (_e, payload) => {
  unsavedPeople = (payload && payload.people) || null;
  unsavedProjects = (payload && payload.projects) || null;
});
const unsavedExport = () => (unsavedProjects ? { addresses: unsavedPeople, projects: { version: 1, projects: unsavedProjects } } : unsavedPeople);
ipcMain.handle('log:error', (_e, msg) => { store.log('error', `renderer: ${msg}`); });
ipcMain.handle('dialog:restore-choose', async (_e, items) => {
  const r = await dialog.showMessageBox(mainWindow, {
    type: 'question', message: 'Restore from Backup', detail: 'Choose a backup to restore. Your current file is saved as a backup first.',
    buttons: [...items.slice(0, 8), 'Cancel'], cancelId: Math.min(items.length, 8),
  });
  return r.response < Math.min(items.length, 8) ? items[r.response] : null;
});

// ---------- menu ----------
function send(action) {
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  if (w) w.webContents.send('menu', action);
}
async function openLog() {
  const f = path.join(dataDir, 'logs', 'app.log');
  if (fs.existsSync(f)) await shell.openPath(f); else shell.showItemInFolder(dataDir);
}
let projectNames = [];
ipcMain.handle('menu:projects', (_e, names) => { projectNames = Array.isArray(names) ? names.slice(0, 8) : []; buildMenu(); });
function buildMenu() {
  const template = [
    { label: 'Address Labels', submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'New Person', accelerator: 'CmdOrCtrl+N', click: () => send('new-person') },
      { label: 'New Project…', accelerator: 'Shift+CmdOrCtrl+N', click: () => send('new-project') },
      { label: 'Add People…', accelerator: 'Shift+CmdOrCtrl+A', click: () => send('add-people') },
      { label: 'Project History…', accelerator: 'CmdOrCtrl+Y', click: () => send('history') },
      { type: 'separator' },
      { label: 'Print Labels…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
      { label: 'Save as PDF…', click: () => send('save-pdf') },
      { label: 'Print Alignment Test Page…', click: () => send('alignment-test') },
      { type: 'separator' },
      { label: 'Restore from Backup…', click: () => send('restore-backup') },
      { label: 'Show Data Folder in Finder', click: () => shell.showItemInFolder(fs.existsSync(store.file) ? store.file : dataDir) },
      { type: 'separator' },
      { label: 'Close Window', accelerator: 'CmdOrCtrl+W', role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('select-all') },
      { type: 'separator' },
      { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      { label: 'Alignment', accelerator: 'CmdOrCtrl+Alt+A', click: () => send('alignment') },
    ] },
    { label: 'View', submenu: [
      { label: 'Address Book', accelerator: 'CmdOrCtrl+1', click: () => send('view:book') },
      ...projectNames.map((name, i) => ({ label: name, accelerator: `CmdOrCtrl+${i + 2}`, click: () => send(`view:project:${i}`) })),
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    { label: 'Help', submenu: [{ label: 'Open Log', click: () => openLog() }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- lifecycle ----------
app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png')); } catch { /* icon is cosmetic */ }
  }
  buildMenu();
  createMainWindow();
  app.on('activate', () => { if (!mainWindow) createMainWindow(); });
});
app.on('window-all-closed', () => app.quit());
