/* Address book view: list, search, ticks, adding / editing / deleting people. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

async function open(people, env) {
  const dir = H.tmpDir();
  H.seed(dir, people);
  return H.launch(dir, env);
}

test('loads the real 82 entries sorted by name, with ids added to the file', async () => {
  const { app, win, dir } = await open(H.fixture('large.json'));
  await expect(win.locator('.row')).toHaveCount(82);
  const got = await H.names(win);
  // A leading "The" is ignored for sorting ("The Alder Family" files under A) but still shown.
  const key = (n) => n.replace(/^the\s+(?=\S)/i, '');
  expect(got).toEqual([...got].sort((a, b) => key(a).localeCompare(key(b), 'en', { sensitivity: 'base' })));
  const idx = (n) => got.indexOf(n);
  expect(idx('The Alder Family')).toBeLessThan(idx('Bea and Jo'));
  expect(idx('The Alder Family')).toBeGreaterThan(idx('Alan Pike'));
  expect(got.filter((n) => /^The /.test(n)).length).toBeGreaterThan(10);
  expect(new Set(H.readPeople(dir).map((p) => p.id)).size).toBe(82);
  await expect(win.locator('.side-item[aria-current="page"] .label')).toHaveText('Address book');
  await app.close();
});

test('search: case, diacritics, curly vs straight apostrophes; Esc clears', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  await win.fill('#search', 'ZOE');
  await expect(win.locator('.row')).toHaveCount(1);
  await win.fill('#search', "Kapa'a");
  await expect(win.locator('.row .name')).toHaveText(['The Fenwick Family']);
  await win.fill('#search', 'alder');
  await expect(win.locator('.row')).toHaveCount(2);
  await win.press('#search', 'Escape');
  await expect(win.locator('#search')).toHaveValue('');
  await expect(win.locator('.row')).toHaveCount(10);
  await win.fill('#search', 'zzzzz');
  await expect(win.locator('.empty h2')).toHaveText('No matches for “zzzzz”');
  await win.click('.empty .btn');
  await expect(win.locator('.row')).toHaveCount(10);
  await app.close();
});

test('same-name rows show their address; Pip shows a "No address" warning', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  const ayalas = win.locator('.row', { has: win.locator('.name', { hasText: 'The Alder Family' }) });
  await expect(ayalas).toHaveCount(2);
  await expect(ayalas.nth(0).locator('.addr')).not.toHaveText(await ayalas.nth(1).locator('.addr').innerText());
  await expect(H.row(win, 'Pip').locator('.addr')).toContainText('No address');
  await app.close();
});

test('Address book: ticks, Select all / none on shown rows, the Ticked filter, hint, and no copies or chips', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  await expect(win.locator('#summary')).toContainText('Nothing ticked · 10 people');
  await expect(win.locator('#summary')).toContainText('To print, open a project.');
  await expect(win.locator('#print')).toHaveCount(0);
  await expect(win.locator('.row .copies')).toHaveCount(0);
  await expect(win.locator('.row .chip')).toHaveCount(0);
  await win.fill('#search', 'alder');
  await expect(win.locator('#select-all')).toHaveText('Select all 2 shown');
  await win.click('#select-all');
  await win.fill('#search', '');
  await expect(win.locator('#summary')).toContainText('2 ticked');
  await win.click('[data-filter="ticked"]');
  await expect(win.locator('.row')).toHaveCount(2);
  await win.click('#select-none');
  await expect(win.locator('.empty h2')).toBeVisible();
  await expect(win.locator('#add-to-project')).toHaveAttribute('aria-disabled', 'true');
  await app.close();
});

test('ticks are not saved: they clear on restart and when the view changes', async () => {
  const dir = H.tmpDir();
  H.seed(dir, H.fixture('small.json'));
  let ctx = await H.launch(dir);
  await H.checkNames(ctx.win, ['Pip']);
  await expect(ctx.win.locator('#summary')).toContainText('1 ticked');
  await H.createProject(ctx.win, 'Temp', ['Pip']);
  await ctx.win.click('.side-item[data-view="book"]');
  await expect(ctx.win.locator('#summary')).toContainText('Nothing ticked');
  await H.checkNames(ctx.win, ['Pip']);
  await H.wait(300);
  await ctx.app.close();
  ctx = await H.launch(dir);
  await expect(ctx.win.locator('#summary')).toContainText('Nothing ticked');
  await ctx.app.close();
});

test('add person: appears in sorted position, focused; saved with an id', async () => {
  const { app, win, dir } = await open(H.fixture('small.json'));
  await win.click('#add');
  await win.fill('.modal input[aria-label="Name"]', 'Zed Example');
  await win.fill('.modal textarea', '1 Main St\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  const names = await H.names(win);
  expect(names[names.length - 1]).toBe('Zed Example');
  await expect(H.row(win, 'Zed Example')).toBeFocused();
  await H.settle();
  const saved = H.readPeople(dir).find((p) => p.name === 'Zed Example');
  expect(saved.id).toBeTruthy();
  expect(saved.address[0]).toMatchObject({ line1: '1 Main St', line2: 'Town, CA 90000', version: 1 });
  await app.close();
});

test('add person: a name is required', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  await win.click('#add');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .field-error')).toHaveText('Name is required');
  await win.keyboard.press('Escape');
  await expect(win.locator('.modal')).toHaveCount(0);
  await app.close();
});

test('edit: "Fix a typo" keeps one address; "They moved" keeps history; "Use this again"', async () => {
  const { app, win, dir } = await open(H.fixture('small.json'));
  const edit = () => H.row(win, 'Ned and Zoë Birch').locator('button.edit').click();
  await edit();
  await win.fill('.modal textarea', '500 Mill Wy\nSampleton, CA 90002');
  await win.click('.modal .btn.primary');
  await H.settle();
  let p = H.readPeople(dir).find((x) => x.name === 'Ned and Zoë Birch');
  expect(p.address).toHaveLength(1);
  expect(p.address[0].line1).toBe('500 Mill Wy');
  await edit();
  await win.check('.modal input[value="moved"]');
  await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await H.settle();
  p = H.readPeople(dir).find((x) => x.name === 'Ned and Zoë Birch');
  expect(p.address).toHaveLength(2);
  expect(Math.max(...p.address.map((a) => a.version))).toBe(2);
  await expect(H.row(win, 'Ned and Zoë Birch').locator('.addr')).toContainText('1 New Rd');
  await edit();
  await expect(win.locator('.modal')).toContainText('Previous addresses (1)');
  expect(await win.locator('.modal').innerText()).not.toMatch(/version/i);
  await win.click('.modal .history .btn');
  await H.settle();
  p = H.readPeople(dir).find((x) => x.name === 'Ned and Zoë Birch');
  expect(Math.max(...p.address.map((a) => a.version))).toBe(3);
  await expect(H.row(win, 'Ned and Zoë Birch').locator('.addr')).toContainText('Mill Wy');
  await app.close();
});

test('a person with no address gets "Add address"', async () => {
  const { app, win, dir } = await open(H.fixture('small.json'));
  await H.row(win, 'Pip').locator('button.edit').click();
  await expect(win.locator('.modal')).toContainText('Add address');
  await win.fill('.modal textarea', '1 Main St\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await H.settle();
  expect(H.readPeople(dir).find((p) => p.name === 'Pip').address[0].version).toBe(1);
  await app.close();
});

test('form warnings: more than 4 lines and exact duplicates need a second click', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  await win.click('#add');
  await win.fill('.modal input[aria-label="Name"]', 'Long Address');
  await win.fill('.modal textarea', 'a\nb\nc\nd\ne');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .warn-note')).toContainText('more than 4 lines');
  await expect(win.locator('.modal .btn.primary')).toHaveText('Save anyway');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal')).toHaveCount(0);
  await win.click('#add');
  await win.fill('.modal input[aria-label="Name"]', 'Pip');
  await win.click('.modal .btn.primary');
  await expect(win.locator('.modal .warn-note')).toContainText('same name and address');
  await win.keyboard.press('Escape');
  await app.close();
});

test('delete is immediate with an Undo toast; undo restores the person', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  await H.row(win, 'Pip').locator('button.edit').click();
  await win.click('.modal .btn.danger');
  await expect(win.locator('.modal')).toHaveCount(0);
  await expect(win.locator('.row')).toHaveCount(9);
  await expect(win.locator('.toast')).toContainText('Deleted Pip.');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(win.locator('.row')).toHaveCount(10);
  await app.close();
});

test('keyboard: arrows move focus, Space ticks, Return opens edit', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  await win.locator('.row').first().focus();
  await win.keyboard.press('ArrowDown');
  const second = win.locator('.row').nth(1);
  await expect(second).toBeFocused();
  await win.keyboard.press(' ');
  await expect(second.locator('input.check')).toBeChecked();
  await win.keyboard.press('Enter');
  await expect(win.locator('.modal')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.locator('.modal')).toHaveCount(0);
  await app.close();
});

test('empty address book shows the empty state', async () => {
  const { app, win } = await open('[]');
  await expect(win.locator('.empty h2')).toHaveText('No addresses yet');
  await expect(win.locator('.empty .btn.primary')).toHaveText('Add person');
  await app.close();
});

test('closing the main window quits the app', async () => {
  const { app, win } = await open(H.fixture('small.json'));
  const closed = new Promise((r) => app.process().once('exit', r));
  await win.close();
  await closed;
});
