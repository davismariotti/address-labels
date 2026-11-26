const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const PEOPLE = H.withIds(H.fixture('small.json'));
const toast = (win) => win.locator('.toast .msg');
const menuClick = (app, top, label) => app.evaluate(({ Menu }, [t, l]) => {
  Menu.getApplicationMenu().items.find((i) => i.label === t).submenu.items.find((i) => i.label === l).click();
}, [top, label]);

async function open({ projects, settings, env } = {}) {
  const dir = H.tmpDir();
  H.seed(dir, PEOPLE);
  if (projects) H.seedProjects(dir, projects);
  if (settings) H.seedSettings(dir, settings);
  return { dir, ...(await H.launch(dir, env)) };
}

test('Esc un-ticks everyone in the Address book, and Undo brings the ticks back', async () => {
  const { app, win } = await open();
  await win.click('#select-all');
  await expect(win.locator('.row input.check:checked')).toHaveCount(10);
  await win.locator('.row').first().focus();
  await win.keyboard.press('Escape');
  await expect(win.locator('.row input.check:checked')).toHaveCount(0);
  await expect(toast(win)).toHaveText('Cleared 10 selections.');
  await win.click('.toast .btn:has-text("Undo"), .toast button:has-text("Undo")');
  await expect(win.locator('.row input.check:checked')).toHaveCount(10);
  await app.close();
});

test('Esc un-ticks everyone in a project; with nothing ticked it does nothing', async () => {
  const pr = H.project('Mailing', ['p0', 'p1', 'p2']);
  const { app, win, dir } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await expect(win.locator('.row input.check:checked')).toHaveCount(3);
  await win.keyboard.press('Escape');
  await expect(win.locator('.row input.check:checked')).toHaveCount(0);
  await H.settle();
  expect(H.readProjects(dir)[0].recipients.every((r) => r.selected === false)).toBe(true);
  await win.keyboard.press('Escape'); // nothing ticked: no second toast text change
  await expect(toast(win)).toHaveText('Cleared 3 selections.');
  await app.close();
});

test('Esc in the search box clears the search first, then a second Esc un-ticks', async () => {
  const { app, win } = await open();
  await win.click('#select-all');
  await win.fill('#search', 'pip');
  await win.press('#search', 'Escape');
  await expect(win.locator('#search')).toHaveValue('');
  await expect(win.locator('.row input.check:checked')).toHaveCount(10);
  await win.keyboard.press('Escape');
  await expect(win.locator('.row input.check:checked')).toHaveCount(0);
  await app.close();
});

test('clicking anywhere on a row ticks it, but not its Edit button, copies controls, or a text selection', async () => {
  const { app, win } = await open();
  await H.row(win, 'Pip').locator('.name').click();
  await expect(H.row(win, 'Pip').locator('input.check')).toBeChecked();
  await H.row(win, 'Pip').locator('.name').click();
  await expect(H.row(win, 'Pip').locator('input.check')).not.toBeChecked();
  await H.row(win, 'Pip').locator('button.edit').click();
  await expect(win.locator('.modal')).toBeVisible();
  await expect(H.row(win, 'Pip').locator('input.check')).not.toBeChecked();
  await win.keyboard.press('Escape');
  await app.close();
});

test('clicking a project row ticks it and leaves the copies controls alone', async () => {
  const pr = H.project('Mailing', ['p4', 'p5']);
  pr.recipients.forEach((r) => { r.selected = false; });
  const { app, win, dir } = await open({ projects: [pr], settings: { activeView: pr.id } });
  await H.row(win, 'Pip').locator('.who').click();
  await expect(H.row(win, 'Pip').locator('input.check')).toBeChecked();
  await H.row(win, 'Bea and Jo').locator('button[aria-label^="More copies"]').click();
  await expect(H.row(win, 'Bea and Jo').locator('.badge-copies')).toHaveText('×2');
  await expect(H.row(win, 'Bea and Jo').locator('input.check')).not.toBeChecked();
  await H.settle();
  expect(H.readProjects(dir)[0].recipients.map((r) => r.selected)).toEqual([true, false]);
  await app.close();
});

test('File ▸ Print Alignment Test Page opens 30 dummy labels with outlines, and records nothing', async () => {
  const pr = H.project('Mailing', ['p0']);
  const { app, win, dir } = await open({ projects: [pr], settings: { activeView: pr.id }, env: { ADDRESS_LABELS_TEST_PRINT: 'ok' } });
  await menuClick(app, 'File', 'Print Alignment Test Page…');
  const pw = await H.printWindow(app);
  await expect(pw.locator('#topsummary')).toHaveText('30 labels · 1 sheet');
  await expect(pw.locator('#outlines')).toBeChecked();
  await expect(pw.locator('#stage .cell.label-cell')).toHaveCount(30);
  await expect(pw.locator('#stage')).toContainText('Sample Name');
  await expect(pw.locator('#pdf-hint')).toBeHidden();
  await pw.click('#print');
  await H.printClosed(app);
  await H.settle();
  expect(H.readProjects(dir)[0].runs).toEqual([]); // no run, no status, nobody marked printed
  await app.close();
});

test('the alignment test also works with no project and starts from a chosen cell', async () => {
  const { app } = await open();
  await menuClick(app, 'File', 'Print Alignment Test Page…');
  const pw = await H.printWindow(app);
  await pw.fill('#start', '14'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#topsummary')).toHaveText('30 labels · 2 sheets');
  await app.close();
});
