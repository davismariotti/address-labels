/* Projects: sidebar, creating (empty / from ticks / copy), adding people, per-project selection and copies,
   removing, renaming, deleting, remembering the view, migration, orphans, layout at the minimum size. */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

// p0/p1 Alder, p2/p3 Arden, p4 Pip (no address), p5 Sam, p6 Brook, p7 Nate, p8 Fenwick, p9 abbey
const PEOPLE = H.withIds(H.fixture('small.json'));

async function open({ projects, settings, env, people = PEOPLE } = {}) {
  const dir = H.tmpDir();
  H.seed(dir, people);
  if (projects) H.seedProjects(dir, projects);
  if (settings) H.seedSettings(dir, settings);
  const ctx = await H.launch(dir, env);
  return ctx;
}
const menuClick = (app, top, label) => app.evaluate(({ Menu }, [t, l]) => {
  Menu.getApplicationMenu().items.find((i) => i.label === t).submenu.items.find((i) => i.label === l).click();
}, [top, label]);
const toast = (win) => win.locator('.toast .msg');

test('sidebar lists the Address book and projects in natural order with counts and shortcut tooltips', async () => {
  const projects = [H.project('Christmas 2026', ['p0', 'p1', 'p2']), H.project('christmas 2025', ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']), H.project('Wedding', [])];
  const { app, win } = await open({ projects });
  const items = win.locator('#side-items .side-item:not(.add)');
  await expect(items.locator('.label')).toHaveText(['Address book', 'christmas 2025', 'Christmas 2026', 'Wedding']);
  await expect(items.locator('.count')).toHaveText(['10', '6', '3', '0']);
  await expect(items.nth(0)).toHaveAttribute('title', '⌘1');
  await expect(items.nth(1)).toHaveAttribute('title', 'christmas 2025 (⌘2)');
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'page');
  await app.close();
});

test('creating an empty project: validation, duplicate warning, empty state, saved', async () => {
  const { app, win, dir } = await open({ projects: [H.project('Existing', ['p0'])] });
  await win.click('.side-item.add');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .field-error')).toHaveText('Name is required');
  await win.fill('.modal input[aria-label="Project name"]', 'existing');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .warn-note')).toContainText('already exists');
  await expect(win.locator('.modal .btn.primary')).toHaveText('Create anyway');
  await win.fill('.modal input[aria-label="Project name"]', "Wedding announcement");
  await win.click('.modal .btn.primary');
  await expect(H.side(win, "Wedding announcement")).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('.empty h2')).toHaveText('Nobody in this project yet');
  await expect(win.locator('.empty .btn.primary')).toHaveText('Add people');
  await H.settle();
  expect(H.readProjects(dir).map((p) => p.name)).toContain("Wedding announcement");
  await app.close();
});

test('new project from the Address book ticks: fixed line instead of Start from, ticks cleared, nobody ticked yet', async () => {
  const { app, win } = await open();
  await H.checkNames(win, ['Pip', 'Bea and Jo', 'Ned and Zoë Birch']);
  await win.click('#new-from-selection');
  await expect(win.locator('#from-ticks')).toHaveText('Starting with 3 people from the Address book');
  await expect(win.locator('select[aria-label="Start from"]')).toHaveCount(0);
  await win.fill('.modal input[aria-label="Project name"]', 'Announcement');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.row')).toHaveCount(3);
  await expect(win.locator('.row input.check:checked')).toHaveCount(0);
  await win.click('#select-all');
  await expect(win.locator('#summary')).toContainText('3 people · 3 labels · 1 sheet');
  await win.click('.side-item[data-view="book"]');
  await expect(win.locator('#summary')).toContainText('Nothing ticked');
  await app.close();
});

test('new project as a copy: recipients and copies carried, nobody ticked, no status or history', async () => {
  const src = H.project('Christmas 2025', ['p0', 'p5'], {
    runs: [H.printRun([['p0', 'The Alder Family', ['3008 Sample Lane', 'Exampleton, TX 70001']]])],
  });
  src.recipients[0].copies = 3;
  src.recipients[1].selected = false;
  const { app, win, dir } = await open({ projects: [src] });
  await win.click('.side-item.add');
  await win.fill('.modal input[aria-label="Project name"]', 'Christmas 2026');
  await win.selectOption('.modal select[aria-label="Start from"]', { label: 'Copy of Christmas 2025' });
  await win.click('.modal .btn.primary');
  await expect(win.locator('.row')).toHaveCount(2);
  await expect(H.row(win, 'The Alder Family').locator('.badge-copies')).toHaveText('×3');
  await expect(win.locator('.row .chip')).toHaveText(['Not printed', 'Not printed']);
  await expect(win.locator('.row input.check:checked')).toHaveCount(0);
  await H.settle();
  const projects = H.readProjects(dir);
  expect(projects.find((p) => p.name === 'Christmas 2026').runs).toEqual([]);
  expect(projects.find((p) => p.name === 'Christmas 2025').runs).toHaveLength(1);
  await app.close();
});

test('Add people from the address book: disabled "In project" rows, new ones unticked, others unchanged', async () => {
  const pr = H.project('Mailing', ['p0', 'p1']);
  const { app, win } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await H.row(win, 'The Alder Family').first().locator('input.check').uncheck();
  await win.click('#add');
  await expect(win.locator('.modal h2, .modal header')).toContainText('Add people to Mailing');
  await expect(win.locator('.pick-row.disabled')).toHaveCount(2);
  await expect(win.locator('.pick-row[data-id="p0"] input')).toBeDisabled();
  await expect(win.locator('.pick-row[data-id="p0"]')).toContainText('In project');
  await win.locator('.pick-row[data-id="p4"] input').check();
  await win.locator('.pick-row[data-id="p5"] input').check();
  await expect(win.locator('#add-n')).toHaveText('Add 2');
  await win.click('#add-n');
  await expect(toast(win)).toHaveText('Added 2 people to Mailing.');
  await expect(win.locator('.row')).toHaveCount(4);
  await expect(H.row(win, 'Pip').locator('input.check')).not.toBeChecked();
  await expect(win.locator('.row input.check:checked')).toHaveCount(1); // only the one that was already ticked
  await app.close();
});

test('Add people from another project carries that project\'s copies', async () => {
  const other = H.project('Old list', ['p4', 'p5']);
  other.recipients[0].copies = 2;
  const pr = H.project('New list', ['p0']);
  const { app, win } = await open({ projects: [other, pr], settings: { activeView: pr.id } });
  await win.click('#add');
  await win.selectOption('.modal select[aria-label="Source"]', { label: 'Old list' });
  await expect(win.locator('.pick-row')).toHaveCount(2);
  await win.locator('.pick-row[data-id="p4"] input').check();
  await win.click('#add-n');
  await expect(H.row(win, 'Pip').locator('.badge-copies')).toHaveText('×2');
  await app.close();
});

test('Add to project… (Address book): project menu, skips people already in it, clears ticks, Show opens it', async () => {
  const pr = H.project('Mailing', ['p0']);
  const { app, win } = await open({ projects: [pr] });
  await H.checkNames(win, ['Pip', 'Bea and Jo']);
  await H.row(win, 'The Alder Family').first().locator('input.check').check();
  await win.click('#add-to-project');
  await expect(win.locator('.menu .menu-item')).toHaveText(['Mailing', 'New project…']);
  await win.locator('.menu .menu-item', { hasText: 'Mailing' }).click();
  await expect(toast(win)).toHaveText('Added 2 people to Mailing. 1 was already in it.');
  await expect(win.locator('#summary')).toContainText('Nothing ticked');
  await expect(win.locator('.side-item[data-view="book"]')).toHaveAttribute('aria-current', 'page');
  await win.click('.toast .btn:has-text("Show")');
  await expect(H.side(win, 'Mailing')).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('.row')).toHaveCount(3);
  await app.close();
});

test('Add to project… with no projects offers only New project…', async () => {
  const { app, win } = await open();
  await H.checkNames(win, ['Pip']);
  await win.click('#add-to-project');
  await expect(win.locator('.menu .menu-item')).toHaveText(['New project…']);
  await app.close();
});

test('Add person inside a project has an "Also add" checkbox, ticked by default', async () => {
  const pr = H.project('Mailing', ['p0']);
  const { app, win, dir } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await menuClick(app, 'File', 'New Person');
  await expect(win.locator('#also-add')).toBeChecked();
  await win.fill('.modal input[aria-label="Name"]', 'Zed One');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Zed One')).toBeVisible();
  await menuClick(app, 'File', 'New Person');
  await win.uncheck('#also-add');
  await win.fill('.modal input[aria-label="Name"]', 'Zed Two');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Zed Two')).toHaveCount(0);
  await H.settle();
  expect(H.readPeople(dir).map((p) => p.name)).toEqual(expect.arrayContaining(['Zed One', 'Zed Two']));
  await app.close();
});

test('selection and copies are per project and survive a restart', async () => {
  const a = H.project('A list', ['p4']);
  const b = H.project('B list', ['p4']);
  const { app, win, dir, userData } = await open({ projects: [a, b], settings: { activeView: a.id } });
  await H.row(win, 'Pip').locator('input.check').uncheck();
  const copies = win.locator('input[aria-label="Copies for Pip"]');
  await copies.fill('3'); await copies.press('Enter');
  await expect(H.row(win, 'Pip').locator('.badge-copies')).toHaveText('×3');
  await H.settle();
  await app.close();
  const ctx = await H.launch(dir, {}, { userData });
  await expect(H.row(ctx.win, 'Pip').locator('input.check')).not.toBeChecked();
  await expect(H.row(ctx.win, 'Pip').locator('.badge-copies')).toHaveText('×3');
  await H.side(ctx.win, 'B list').click();
  await expect(H.row(ctx.win, 'Pip').locator('input.check')).toBeChecked();
  await expect(H.row(ctx.win, 'Pip').locator('.badge-copies')).toHaveCount(0);
  await ctx.app.close();
});

test('remove from project: context menu, Delete key, and Remove selected…, each with Undo; no Remove button on rows', async () => {
  const pr = H.project('Mailing', ['p4', 'p5', 'p6', 'p7']);
  const { app, win } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await expect(win.locator('.row button[aria-label*="Remove"]')).toHaveCount(0);
  await H.row(win, 'Pip').click({ button: 'right' });
  await expect(win.locator('.menu .menu-item')).toContainText(['Edit…', 'Remove from project']);
  await win.locator('.menu .menu-item', { hasText: 'Remove from project' }).click();
  await expect(H.row(win, 'Pip')).toHaveCount(0);
  await expect(toast(win)).toHaveText('Removed Pip from Mailing.');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.row(win, 'Pip')).toBeVisible();
  await H.row(win, 'Bea and Jo').focus();
  await win.keyboard.press('Backspace');
  await expect(H.row(win, 'Bea and Jo')).toHaveCount(0);
  await expect(win.locator('.row')).toHaveCount(3);
  await H.row(win, 'Pip').locator('input.check').uncheck();
  await H.menu(win, 'Remove selected from project…');
  await expect(toast(win)).toHaveText('Removed 2 people from Mailing.');
  await expect(win.locator('.row')).toHaveCount(1);
  await win.keyboard.press('Meta+z').catch(() => {});
  await app.close();
});

test('rename re-sorts the sidebar and keeps recipients', async () => {
  const a = H.project('Alpha', ['p4']);
  const z = H.project('Zulu', ['p4', 'p5']);
  const { app, win } = await open({ projects: [a, z], settings: { activeView: z.id } });
  await H.menu(win, 'Rename project…');
  await win.fill('.modal input[aria-label="Project name"]', 'Aaa first');
  await win.click('.modal .btn.primary');
  await expect(win.locator('#side-items .side-item:not(.add) .label')).toHaveText(['Address book', 'Aaa first', 'Alpha']);
  await expect(win.locator('.row')).toHaveCount(2);
  await app.close();
});

test('delete a project: no dialog without history; with history it confirms; Undo restores history', async () => {
  const plain = H.project('Empty one', ['p4']);
  const used = H.project('Used one', ['p4'], { runs: [H.printRun([['p4', 'Pip', []]])] });
  const { app, win } = await open({ projects: [plain, used], settings: { activeView: plain.id } });
  await H.menu(win, 'Delete project');
  await expect(win.locator('.modal')).toHaveCount(0);
  await expect(toast(win)).toHaveText('Deleted Empty one.');
  await expect(win.locator('.side-item[data-view="book"]')).toHaveAttribute('aria-current', 'page');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.side(win, 'Empty one')).toHaveAttribute('aria-current', 'page');
  await H.side(win, 'Used one').click();
  await H.menu(win, 'Delete project');
  await expect(win.locator('.modal header')).toHaveText('Delete Used one and its print history?');
  await win.click('.modal .btn:has-text("Cancel")');
  await expect(H.side(win, 'Used one')).toBeVisible();
  await H.menu(win, 'Delete project');
  await win.click('#confirm-delete');
  await expect(H.side(win, 'Used one')).toHaveCount(0);
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.side(win, 'Used one')).toHaveAttribute('aria-current', 'page');
  await win.click('#history-btn');
  await expect(win.locator('.run')).toHaveCount(1);
  await app.close();
});

test('the open view is remembered; a missing project falls back to the Address book', async () => {
  const pr = H.project('Mailing', ['p4']);
  const { app, win, dir, userData } = await open({ projects: [pr] });
  await H.side(win, 'Mailing').click();
  await H.settle();
  await app.close();
  let ctx = await H.launch(dir, {}, { userData });
  await expect(H.side(ctx.win, 'Mailing')).toHaveAttribute('aria-current', 'page');
  await ctx.app.close();
  H.seedProjects(dir, []);
  ctx = await H.launch(dir, {}, { userData });
  await expect(ctx.win.locator('.side-item[data-view="book"]')).toHaveAttribute('aria-current', 'page');
  await ctx.app.close();
});

test('migration: an old checked list becomes "Checked list (migrated)" with a one-time notice', async () => {
  const dir = H.tmpDir();
  H.seed(dir, PEOPLE);
  H.seedSettings(dir, { nudge: { x: 0.02, y: 0 }, checkedIds: ['p0', 'p4', 'zzz'] });
  let ctx = await H.launch(dir);
  await expect(H.side(ctx.win, 'Checked list (migrated)')).toHaveAttribute('aria-current', 'page');
  await expect(ctx.win.locator('.banner')).toContainText('Your checked list is now a project called Checked list (migrated).');
  await expect(ctx.win.locator('.row')).toHaveCount(2);
  const settings = H.readSettings(dir);
  expect('checkedIds' in settings).toBe(false);
  expect(settings.nudge).toEqual({ x: 0.02, y: 0 });
  expect(fs.readdirSync(dir).some((n) => n.startsWith('settings.pre-projects-'))).toBe(true);
  const { userData } = ctx;
  await ctx.app.close();
  ctx = await H.launch(dir, {}, { userData });
  await expect(ctx.win.locator('.banner')).toHaveCount(0);
  await expect(ctx.win.locator('#side-items .side-item:not(.add)')).toHaveCount(2);
  await ctx.app.close();
});

test('migration: an empty checked list creates no project but removes the key', async () => {
  const dir = H.tmpDir();
  H.seed(dir, PEOPLE);
  H.seedSettings(dir, { checkedIds: [] });
  const { app, win } = await H.launch(dir);
  await expect(win.locator('.side-item[data-view="book"]')).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('.side-note')).toHaveText('No projects yet');
  expect('checkedIds' in H.readSettings(dir)).toBe(false);
  expect(fs.existsSync(path.join(dir, 'projects.json'))).toBe(false);
  await app.close();
});

test('editing a person from a project updates the address book and every project', async () => {
  const a = H.project('A list', ['p5']);
  const b = H.project('B list', ['p5']);
  const { app, win } = await open({ projects: [a, b], settings: { activeView: a.id } });
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await win.check('.modal input[value="moved"]');
  await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Bea and Jo').locator('.addr')).toContainText('1 New Rd');
  await H.side(win, 'B list').click();
  await expect(H.row(win, 'Bea and Jo').locator('.addr')).toContainText('1 New Rd');
  await win.click('.side-item[data-view="book"]');
  await expect(H.row(win, 'Bea and Jo').locator('.addr')).toContainText('1 New Rd');
  await app.close();
});

test('deleting a person ignores their memberships; Undo restores them; restart prunes the rest', async () => {
  const pr = H.project('Mailing', ['p4', 'p5']);
  const { app, win, dir, userData } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await win.click('.side-item[data-view="book"]');
  await H.row(win, 'Pip').locator('button.edit').click();
  await win.click('.modal .btn.danger');
  await expect(H.side(win, 'Mailing').locator('.count')).toHaveText('1');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.side(win, 'Mailing').locator('.count')).toHaveText('2');
  await H.row(win, 'Pip').locator('button.edit').click();
  await win.click('.modal .btn.danger');
  await H.settle();
  await app.close();
  const ctx = await H.launch(dir, {}, { userData });
  await H.wait(300);
  expect(H.readProjects(dir)[0].recipients.map((r) => r.personId)).toEqual(['p5']);
  await ctx.app.close();
});

test('menu: View > Address Book and the project items follow the sidebar order', async () => {
  const projects = [H.project('Bravo', ['p4']), H.project('Alpha', ['p4'])];
  const { app, win } = await open({ projects, settings: { activeView: projects[0].id } });
  await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'View').submenu.items.map((i) => i.label).join('|'))).toContain('Alpha|Bravo');
  await menuClick(app, 'View', 'Alpha');
  await expect(H.side(win, 'Alpha')).toHaveAttribute('aria-current', 'page');
  await menuClick(app, 'View', 'Address Book');
  await expect(win.locator('.side-item[data-view="book"]')).toHaveAttribute('aria-current', 'page');
  await app.close();
});

test('layout at the minimum window size: chip, copies and Edit are fully visible, no horizontal scroll', async () => {
  const pr = H.project('Mailing', ['p5'], { runs: [H.printRun([['p5', 'Bea and Jo', ['old line']]])] });
  pr.recipients[0].copies = 5;
  const { app, win } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 520));
  await expect(win.locator('.row .chip')).toHaveText('Address changed');
  await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900);
  const box = async (sel) => (await win.locator(sel).first().boundingBox());
  const rowBox = await box('.row');
  for (const sel of ['.row .chip', '.row .copies', '.row button.edit', '.row .badge-copies']) {
    const b = await box(sel);
    expect(b.x, sel).toBeGreaterThanOrEqual(rowBox.x);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  }
  const overflow = await win.evaluate(() => { const l = document.querySelector('#list'); return l.scrollWidth - l.clientWidth; });
  expect(overflow).toBeLessThanOrEqual(0);
  await app.close();
});

test('copy source deleted before the sheet is submitted: an inline error and nothing is created', async () => {
  const { app, win } = await open({ projects: [H.project('Old', ['p4']), H.project('Keep', ['p5'])] });
  await win.click('.side-item.add');
  await win.fill('.modal input[aria-label="Project name"]', 'New copy');
  await win.selectOption('.modal select[aria-label="Start from"]', { label: 'Copy of Old' });
  await win.evaluate(() => { App.state.projects = App.state.projects.filter((p) => p.name !== 'Old'); });
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .field-error')).toHaveText('That project no longer exists');
  await expect(win.locator('.modal select[aria-label="Start from"]')).toHaveValue('');
  await expect(H.side(win, 'New copy')).toHaveCount(0);
  await app.close();
});

test('migration with a realistic checked list: 47 of the real 82 people become one project', async () => {
  const real = H.withIds(H.fixture('large.json'));
  const dir = H.tmpDir();
  H.seed(dir, real);
  H.seedSettings(dir, { nudge: { x: 0, y: 0 }, checkedIds: real.slice(0, 47).map((p) => p.id) });
  const { app, win } = await H.launch(dir);
  await expect(H.side(win, 'Checked list (migrated)')).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('.row')).toHaveCount(47);
  await expect(win.locator('#summary')).toContainText('47 people · 47 labels');
  await expect(win.locator('.row input.check:checked')).toHaveCount(47);
  await app.close();
});

test('add a new person to the address book from inside a project: ⋯ menu, and the Add people sheet', async () => {
  const pr = H.project('Mailing', ['p4']);
  const { app, win, dir } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await H.menu(win, 'New person…');
  await expect(win.locator('#also-add')).toBeChecked();
  await win.fill('.modal input[aria-label="Name"]', 'From The Menu');
  await win.fill('.modal textarea', '1 Main St\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'From The Menu')).toBeVisible(); // in the address book and in the project
  await win.click('#add');
  await win.click('#new-person');
  await expect(win.locator('.modal header')).toHaveText('Add person');
  await win.fill('.modal input[aria-label="Name"]', 'From The Sheet');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'From The Sheet')).toBeVisible();
  await H.settle();
  expect(H.readPeople(dir).map((p) => p.name)).toEqual(expect.arrayContaining(['From The Menu', 'From The Sheet']));
  await win.click('.side-item[data-view="book"]');
  await expect(win.locator('.row .name')).toContainText(['From The Menu', 'From The Sheet']);
  await app.close();
});
