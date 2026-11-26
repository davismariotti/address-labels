const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'labels-e2e-')); }
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')); }
/** Deterministic ids (p0, p1, …) so tests can seed projects that point at people. */
const withIds = (people) => people.map((p, i) => ({ id: p.id || `p${i}`, ...p }));
function seed(dir, people) { fs.writeFileSync(path.join(dir, 'addresses.json'), typeof people === 'string' ? people : JSON.stringify(people, null, 2)); }
function seedProjects(dir, projects) { fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ version: 1, projects }, null, 2)); }
function seedSettings(dir, obj) { fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(obj)); }
const readPeople = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'addresses.json'), 'utf8'));
const readProjects = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8')).projects;
const readSettings = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));

let seq = 0;
/** A project literal for seeding projects.json. */
function project(name, personIds, extra = {}) {
  return {
    id: `proj-${++seq}-${name.replace(/\W+/g, '').toLowerCase()}`, name, createdAt: '2026-01-01T00:00:00.000Z',
    recipients: personIds.map((personId) => ({ personId, copies: 1, selected: true })), runs: [], ...extra,
  };
}
/** A print run literal. `entries` are [personId, name, lines]. */
function printRun(entries, at = '2026-01-01T10:00:00.000Z', extra = {}) {
  return {
    id: `run-${++seq}`, at, kind: 'print', startCell: 1, sheetCount: 1, undoneAt: null,
    entries: entries.map(([personId, name, lines]) => ({ personId, name, copies: 1, lines, undoneAt: null })), ...extra,
  };
}

/**
 * Every launch gets its own Electron user-data folder. The app holds a single-instance lock keyed to that
 * folder, so without this, tests running in parallel would find each other's apps and quit.
 */
async function launch(dir, env = {}, opts = {}) {
  const userData = opts.userData || tmpDir();
  const app = await electron.launch({ args: [ROOT, `--user-data-dir=${userData}`], env: { ...process.env, ADDRESS_LABELS_DATA: dir, ...env } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => { throw new Error('renderer error: ' + e.message); });
  await win.waitForSelector('#list');
  return { app, win, dir, userData };
}

async function printWindow(app) {
  for (let i = 0; i < 50; i++) {
    const w = app.windows().find((x) => x.url().includes('print.html'));
    if (w) { await w.waitForSelector('#stage .sheet'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('print window did not open');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (win, name) => win.locator('.row', { has: win.locator('.name', { hasText: new RegExp('^' + esc(name) + '$') }) });
const names = (win) => win.locator('.row .name').allInnerTexts();
const side = (win, name) => win.locator('.side-item', { has: win.locator('.label', { hasText: new RegExp('^' + esc(name) + '$') }) });

async function checkNames(win, list) {
  for (const n of list) await row(win, n).locator('input.check').check();
}

/**
 * Create a project from the Address book. `who` is 'all', a list of names, or null for an empty project.
 * Leaves the new project open.
 */
async function createProject(win, name, who = 'all') {
  if (who === 'all') await win.click('#select-all');
  else if (who && who.length) await checkNames(win, who);
  if (who) await win.click('#new-from-selection'); else await win.click('.side-item.add');
  await win.fill('.modal input[aria-label="Project name"]', name);
  await win.click('.modal .btn.primary');
  await win.waitForSelector(`.side-item[aria-current="page"]:has-text("${name}")`);
}

/** In a project: click Print Labels…, then Print… in the dialog (use ADDRESS_LABELS_TEST_PRINT=ok). */
async function printOut(app, win, { start } = {}) {
  await win.click('#print');
  const pw = await printWindow(app);
  if (start) { await pw.fill('#start', String(start)); await pw.press('#start', 'Enter'); }
  await pw.click('#print');
  return pw;
}

/** Open the ⋯ menu and click an item. */
async function menu(win, label) {
  await win.click('#more-btn');
  await win.locator('.menu .menu-item', { hasText: label }).click();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until the print dialog window is gone (it closes asynchronously after Print… or Cancel). */
async function printClosed(app) {
  for (let i = 0; i < 100; i++) {
    if (!app.windows().some((w) => w.url().includes('print.html') && !w.isClosed())) return;
    await wait(50);
  }
  throw new Error('print window did not close');
}
/** Wait for the debounced projects save. */
const settle = () => wait(500);

module.exports = {
  launch, printWindow, tmpDir, fixture, withIds, seed, seedProjects, seedSettings, readPeople, readProjects, readSettings,
  project, printRun, row, names, side, checkNames, createProject, printOut, menu, wait, printClosed, settle, ROOT, FIXTURES,
};
