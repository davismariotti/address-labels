const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  init: invoke('app:init'),
  savePeople: invoke('people:save'),
  updateSettings: invoke('settings:update'),
  openPrint: invoke('print:open'),
  printInit: invoke('print:init'),
  printClose: invoke('print:close'),
  printers: invoke('print:printers'),
  printNative: invoke('print:native'),
  printPdf: invoke('print:pdf'),
  outputData: invoke('output:data'),
  outputReady: (id) => ipcRenderer.send('output:ready', id),
  listBackups: invoke('backups:list'),
  restoreBackup: invoke('backups:restore'),
  chooseBackup: invoke('dialog:restore-choose'),
  showDataFolder: invoke('folder:show'),
  openLog: invoke('log:open'),
  quit: invoke('app:quit'),
  importLegacy: invoke('legacy:import'),
  exportCopy: invoke('export:copy'),
  setUnsaved: invoke('app:unsaved'),
  saveProjects: invoke('projects:save'),
  chooseRestoreFile: invoke('dialog:restore-file'),
  setProjectMenu: invoke('menu:projects'),
  onPrintCompleted: (cb) => ipcRenderer.on('print:completed', (_e, run) => cb(run)),
  logError: invoke('log:error'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
});
