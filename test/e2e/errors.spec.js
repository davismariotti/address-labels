const { test, expect } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const electronPath = require('electron');
const deletePip = async (win) => { await H.row(win, 'Pip').locator('button.edit').click(); await win.click('.modal .btn.danger'); };

test('corrupt file: blocking dialog, file untouched; Quit exits', async () => {
  const dir = H.tmpDir();
  const bad = '[ {"name": "A", } ]';
  H.seed(dir, bad);
  const { app, win } = await H.launch(dir);
  await expect(win.locator('.modal')).toContainText('Your address file could not be read');
  await expect(win.locator('.modal')).toContainText('addresses.json is damaged');
  expect(fs.readFileSync(path.join(dir, 'addresses.json'), 'utf8')).toBe(bad);
  // typing into the app must not write to the broken file
  await new Promise((r) => setTimeout(r, 600));
  expect(fs.readFileSync(path.join(dir, 'addresses.json'), 'utf8')).toBe(bad);
  const exited = new Promise((r) => app.process().once('exit', r));
  await win.click('.modal .btn:has-text("Quit")');
  await exited;
});

test('corrupt file: restore latest backup renames the broken file and loads the list', async () => {
  const dir = H.tmpDir();
  H.seed(dir, '{ nope');
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.writeFileSync(path.join(dir, 'backups', 'addresses-2025-01-01T00-00-00-000Z.json'), JSON.stringify([{ id: 'x', name: 'From Backup', address: [] }]));
  const { app, win } = await H.launch(dir);
  await win.click('.modal .btn.primary');
  await expect(win.locator('.row .name')).toHaveText(['From Backup']);
  expect(fs.readdirSync(dir).some((n) => n.startsWith('addresses.broken-'))).toBe(true);
  expect(H.readPeople(dir)[0].name).toBe('From Backup');
  await app.close();
});

test('corrupt file with no backups: restore reports that nothing is available', async () => {
  const dir = H.tmpDir();
  H.seed(dir, '{ nope');
  const { app, win } = await H.launch(dir);
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .field-error')).toHaveText('No valid backup found.');
  await app.close();
});

test('invalid entries: banner names them, they are left untouched and saved back', async () => {
  const dir = H.tmpDir();
  H.seed(dir, [{ id: '1', name: 'Good', address: [], nickname: 'g' }, { id: '2', address: [] }]);
  const { app, win } = await H.launch(dir);
  await expect(win.locator('.banner')).toContainText('1 entry in addresses.json could not be read');
  await expect(win.locator('.row')).toHaveCount(1);
  await win.click('#add');
  await win.fill('.modal input[aria-label="Name"]', 'Another');
  await win.click('.modal .btn.primary');
  await H.settle();
  const saved = H.readPeople(dir);
  expect(saved).toHaveLength(3);
  expect(saved.find((p) => p.id === '1').nickname).toBe('g');
  expect(saved.find((p) => p.id === '2')).toBeTruthy();
  await app.close();
});

test('migration writes a pre-migration copy outside the rolling backups', async () => {
  const dir = H.tmpDir();
  H.seed(dir, [{ name: 'No Id', address: [] }]);
  const { app } = await H.launch(dir);
  expect(fs.readdirSync(dir).filter((n) => n.startsWith('addresses.pre-migration-'))).toHaveLength(1);
  expect(H.readPeople(dir)[0].id).toBeTruthy();
  await app.close();
});

test('save failure: banner with Retry, title shows Edited, Retry recovers', async () => {
  const dir = H.tmpDir();
  H.seed(dir, H.fixture('small.json'));
  const { app, win } = await H.launch(dir);
  await H.wait(300);
  fs.chmodSync(dir, 0o500);
  try {
    await deletePip(win);
    await expect(win.locator('.banner.error')).toContainText('Could not save addresses.json', { timeout: 8000 });
    await expect(win.locator('.banner.error')).toContainText('Retry');
    expect(await win.title()).toBe('Address Labels — Edited');
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  await win.click('.banner.error .btn:has-text("Retry")');
  await expect(win.locator('.banner.error')).toHaveCount(0);
  expect(H.readPeople(dir).find((p) => p.name === 'Pip')).toBeUndefined();
  await app.close();
});

test('save failure: closing offers an export, which writes the unsaved list', async () => {
  const dir = H.tmpDir();
  const exportPath = path.join(H.tmpDir(), 'copy.json');
  H.seed(dir, H.fixture('small.json'));
  const { app, win } = await H.launch(dir, { ADDRESS_LABELS_TEST_EXPORT: exportPath });
  await H.wait(300);
  fs.chmodSync(dir, 0o500);
  try {
    await deletePip(win);
    await expect(win.locator('.banner.error')).toBeVisible({ timeout: 8000 });
  } finally { /* keep read-only until the quit flow runs */ }
  const calls = await app.evaluate(({ dialog }) => {
    globalThis.__asked = [];
    dialog.showMessageBox = async (_w, o) => { globalThis.__asked.push(o.message); return { response: 0 }; }; // "Export a copy…"
    return 0;
  });
  void calls;
  const exited = new Promise((r) => app.process().once('exit', r));
  // A real window close (what the red button does); Playwright's page.close() would bypass it.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await exited;
  fs.chmodSync(dir, 0o700);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  expect(exported).toHaveLength(9);
  expect(exported.find((p) => p.name === 'Pip')).toBeUndefined();
});

test('invalid settings.json: defaults and a one-time notice', async () => {
  const dir = H.tmpDir();
  H.seed(dir, H.fixture('small.json'));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ broken');
  const { app, win } = await H.launch(dir);
  await expect(win.locator('.banner')).toContainText('could not be read and were reset');
  await app.close();
});

test('Restore from Backup… (File menu) restores the chosen backup', async () => {
  const dir = H.tmpDir();
  H.seed(dir, [{ id: 'a', name: 'Current', address: [] }]);
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.writeFileSync(path.join(dir, 'backups', 'addresses-2025-01-01T00-00-00-000Z.json'), JSON.stringify([{ id: 'b', name: 'Older', address: [] }]));
  const { app, win } = await H.launch(dir);
  await app.evaluate(({ dialog, Menu }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'Restore from Backup…').click();
  });
  await expect(win.locator('.row .name')).toHaveText(['Older']);
  expect(fs.readdirSync(path.join(dir, 'backups')).length).toBeGreaterThanOrEqual(2); // the replaced file was backed up
  await app.close();
});

test('single instance: a second launch exits and the first window stays', async () => {
  const dir = H.tmpDir();
  H.seed(dir, H.fixture('small.json'));
  const { app, userData } = await H.launch(dir);
  // The lock is keyed to the user-data folder, so the second launch must share it (tests normally don't).
  const r = spawnSync(electronPath, [H.ROOT, `--user-data-dir=${userData}`], { env: { ...process.env, ADDRESS_LABELS_DATA: dir }, timeout: 20000 });
  expect(r.status).toBe(0);
  expect(app.windows()).toHaveLength(1);
  await app.close();
});

test('first run with a legacy addresses.json offers an import and copies it only on accept', async () => {
  const dir = H.tmpDir();
  const legacyDir = H.tmpDir();
  const legacy = path.join(legacyDir, 'addresses.json');
  fs.writeFileSync(legacy, JSON.stringify(H.fixture('small.json')));
  const { app, win } = await H.launch(dir, { ADDRESS_LABELS_LEGACY: legacy });
  await expect(win.locator('.empty h2')).toHaveText('No addresses yet');
  expect(fs.existsSync(path.join(dir, 'addresses.json'))).toBe(false); // nothing copied yet
  await win.click('.empty .btn:has-text("Import addresses.json")');
  await expect(win.locator('.row')).toHaveCount(10);
  expect(H.readPeople(dir).every((p) => p.id)).toBe(true);
  await app.close();
});
