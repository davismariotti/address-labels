/* Archiving: a frozen, read-only copy of a project that no longer follows address changes. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const PEOPLE = H.withIds(H.fixture('small.json'));
const BECKA = ['Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001'];
const NATE = ['500 Mill Way', 'Sampleton, CA 90002'];

function printedProject() {
  const pr = H.project('Christmas 2025', ['p5', 'p7', 'p4'], { runs: [H.printRun([['p5', 'Bea and Jo', BECKA], ['p7', 'Ned and Zoë Birch', NATE], ['p4', 'Pip', []]])] });
  pr.recipients[0].copies = 2;
  return pr;
}
async function open({ projects = [printedProject()], view, env, people = PEOPLE } = {}) {
  const dir = H.tmpDir();
  H.seed(dir, people);
  H.seedProjects(dir, projects);
  H.seedSettings(dir, { activeView: (view ? projects.find((p) => p.name === view) : projects[0]).id });
  return H.launch(dir, env);
}
const toast = (win) => win.locator('.toast .msg');
async function archiveCurrent(win) { await H.menu(win, 'Archive project'); }
async function editPerson(win, name, fn) { await win.click('.side-item[data-view="book"]'); await H.row(win, name).locator('button.edit').click(); await fn(); await win.click('.modal .btn.primary'); }

test('archive from ⋯: moves under Archived, read-only banner, no editing controls, limited menu', async () => {
  const { app, win } = await open();
  await archiveCurrent(win);
  await expect(toast(win)).toHaveText('Archived Christmas 2025.');
  await expect(win.locator('#side-items .side-heading')).toHaveText(['Projects', 'Archived']);
  await expect(H.side(win, 'Christmas 2025')).toHaveClass(/archived/);
  await expect(win.locator('.banner.neutral')).toContainText('This project is read-only and shows names and addresses as they were then.');
  await expect(win.locator('#add')).toBeHidden();
  await expect(win.locator('#select-all')).toBeHidden();
  await expect(win.locator('.row input.check')).toHaveCount(0);
  await expect(win.locator('.row .copies')).toHaveCount(0);
  await expect(win.locator('.row button.edit')).toHaveCount(0);
  await expect(win.locator('#print')).toHaveCount(0);
  await expect(win.locator('#summary')).toContainText('3 people · archived');
  await win.click('#more-btn');
  await expect(win.locator('.menu .menu-item')).toHaveText(['Copy to new project…', 'Unarchive', 'Rename project…', 'Delete project']);
  await expect(H.row(win, 'Bea and Jo').locator('.badge-copies')).toHaveText('×2');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Printed Jan 1');
  await app.close();
});

test('an archived project does not change when people are edited, moved, renamed, or deleted', async () => {
  const { app, win, dir } = await open();
  await archiveCurrent(win);
  await editPerson(win, 'Bea and Jo', async () => {
    await win.fill('.modal input[aria-label="Name"]', 'Sam Renamed');
    await win.check('.modal input[value="moved"]');
    await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  });
  await H.row(win, 'Ned and Zoë Birch').locator('button.edit').click();
  await win.click('.modal .btn.danger');
  await H.side(win, 'Christmas 2025').click();
  await expect(win.locator('.row .name')).toHaveText(['Bea and Jo', 'Ned and Zoë Birch', 'Pip']);
  await expect(H.row(win, 'Bea and Jo').locator('.addr')).toContainText('100 Example Blvd #200');
  await expect(win.locator('.row .chip')).toHaveText(['Printed Jan 1', 'Printed Jan 1', 'Printed Jan 1']); // never "Address changed"
  await H.settle();
  const saved = H.readProjects(dir)[0];
  expect(saved.archivedAt).toBeTruthy();
  expect(saved.snapshot.find((s) => s.personId === 'p5')).toMatchObject({ name: 'Bea and Jo', lines: BECKA, version: 1 });
  await app.close();
});

test('the same edits DO show in a non-archived copy of the project', async () => {
  const live = H.project('Live', ['p5']);
  const { app, win } = await open({ projects: [printedProject(), live], view: 'Christmas 2025' });
  await archiveCurrent(win);
  await editPerson(win, 'Bea and Jo', async () => { await win.fill('.modal input[aria-label="Name"]', 'Sam Renamed'); });
  await H.side(win, 'Live').click();
  await expect(win.locator('.row .name')).toHaveText(['Sam Renamed']);
  await H.side(win, 'Christmas 2025').click();
  await expect(H.row(win, 'Bea and Jo')).toBeVisible();
  await app.close();
});

test('archived projects survive a restart and are not pruned when people are deleted', async () => {
  const { app, win, dir, userData } = await open();
  await archiveCurrent(win);
  await win.click('.side-item[data-view="book"]');
  await H.row(win, 'Pip').locator('button.edit').click();
  await win.click('.modal .btn.danger');
  await H.settle();
  await app.close();
  const ctx = await H.launch(dir, {}, { userData });
  await H.side(ctx.win, 'Christmas 2025').click();
  await expect(ctx.win.locator('.row .name')).toContainText(['Pip']);
  await expect(ctx.win.locator('.banner.neutral')).toBeVisible();
  await ctx.app.close();
});

test('Unarchive returns to live addresses; Undo on the Archive toast also works', async () => {
  const { app, win } = await open();
  await archiveCurrent(win);
  await win.click('.toast .btn:has-text("Undo")');
  await expect(win.locator('.banner.neutral')).toHaveCount(0);
  await expect(win.locator('#print')).toBeVisible();
  await archiveCurrent(win);
  await win.click('.banner.neutral .btn:has-text("Unarchive")');
  await expect(toast(win)).toHaveText('Unarchived Christmas 2025.');
  await expect(win.locator('#side-items .side-heading')).toHaveText(['Projects']);
  await expect(win.locator('.row input.check')).toHaveCount(3);
  await app.close();
});

test('Copy to new project from an archive: preselected, recipients and copies carried, live addresses, no status', async () => {
  const { app, win } = await open();
  await archiveCurrent(win);
  await win.click('.banner.neutral .btn:has-text("Copy to new project…")');
  await expect(win.locator('.modal select[aria-label="Start from"]')).toHaveValue(/proj-/);
  await expect(win.locator('.modal select[aria-label="Start from"] option:checked')).toHaveText('Copy of Christmas 2025 (archived)');
  await win.fill('.modal input[aria-label="Project name"]', 'Christmas 2026');
  await win.click('.modal .btn.primary');
  await expect(H.side(win, 'Christmas 2026')).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('.row')).toHaveCount(3);
  await expect(H.row(win, 'Bea and Jo').locator('.badge-copies')).toHaveText('×2');
  await expect(win.locator('.row .chip')).toHaveText(['Not printed', 'Not printed', 'Not printed']);
  await expect(win.locator('.row input.check:checked')).toHaveCount(3);
  await app.close();
});

test('archived projects are sources for Add people and New project, but not in Add to project…', async () => {
  const live = H.project('Live', ['p6']);
  const { app, win } = await open({ projects: [printedProject(), live], view: 'Christmas 2025' });
  await archiveCurrent(win);
  await H.side(win, 'Live').click();
  await win.click('#add');
  await expect(win.locator('.modal select[aria-label="Source"] option')).toHaveText(['Address book', 'Christmas 2025 (archived)']);
  await win.selectOption('.modal select[aria-label="Source"]', { label: 'Christmas 2025 (archived)' });
  await win.locator('.pick-row[data-id="p5"] input').check();
  await win.click('#add-n');
  await expect(H.row(win, 'Bea and Jo').locator('.badge-copies')).toHaveText('×2'); // copies came from the archive
  await win.click('.side-item[data-view="book"]');
  await H.checkNames(win, ['Pip']);
  await win.click('#add-to-project');
  await expect(win.locator('.menu .menu-item')).toHaveText(['Live', 'New project…']);
  await app.close();
});

test('the View menu and ⌘ shortcuts list only active projects', async () => {
  const live = H.project('Live', ['p6']);
  const { app, win } = await open({ projects: [printedProject(), live], view: 'Christmas 2025' });
  await archiveCurrent(win);
  await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'View').submenu.items.map((i) => i.label).join('|'))).toContain('Live');
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'View').submenu.items.map((i) => i.label));
  expect(labels).not.toContain('Christmas 2025');
  await expect(H.side(win, 'Live')).toHaveAttribute('title', 'Live (⌘2)');
  await app.close();
});

test('an archived project cannot be printed, and ⌘P does nothing there', async () => {
  const { app, win } = await open({ env: { ADDRESS_LABELS_TEST_PRINT: 'ok' } });
  await archiveCurrent(win);
  await app.evaluate(({ Menu }) => { Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'Print Labels…').click(); });
  await H.wait(600);
  expect(app.windows().some((w) => w.url().includes('print.html'))).toBe(false);
  await app.close();
});

test('holds do not reach an archived project', async () => {
  const { app, win } = await open();
  await archiveCurrent(win);
  await win.click('.side-item[data-view="book"]');
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: /^Needs an address update$/ }).click();
  await H.side(win, 'Christmas 2025').click();
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Printed Jan 1');
  await expect(win.locator('[data-filter="hold"]')).toHaveCount(0);
  await app.close();
});

test('History of an archived project is read-only', async () => {
  const { app, win } = await open();
  await archiveCurrent(win);
  await win.click('#history-btn');
  await expect(win.locator('.run')).toHaveCount(1);
  await expect(win.locator('.run-head .btn:has-text("Undo run")')).toHaveCount(0);
  await expect(win.locator('#didnt')).toBeHidden();
  await win.click('.run-head .btn[aria-label="Show people"]');
  await expect(win.locator('.entry input.check:not([disabled])')).toHaveCount(0);
  await app.close();
});

test('archived projects can be renamed and deleted', async () => {
  const { app, win } = await open();
  await archiveCurrent(win);
  await H.menu(win, 'Rename project…');
  await win.fill('.modal input[aria-label="Project name"]', 'Xmas 2025 (done)');
  await win.click('.modal .btn.primary');
  await expect(H.side(win, 'Xmas 2025 (done)')).toBeVisible();
  await H.menu(win, 'Delete project');
  await win.click('#confirm-delete'); // it has print history
  await expect(H.side(win, 'Xmas 2025 (done)')).toHaveCount(0);
  await app.close();
});
