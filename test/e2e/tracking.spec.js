/* Print tracking: runs recorded without prompting, derived status, corrections, History, and error flows.
   Uses ADDRESS_LABELS_TEST_PRINT to stand in for the system print dialog. */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const PEOPLE = H.withIds(H.fixture('small.json'));
// Sorted: Sam (p5), Nate (p7), Pip (p4), Philip Brook (p6), Fenwick (p8)
const MEMBERS = ['p4', 'p5', 'p6', 'p7', 'p8'];
const LINES = {
  p4: [],
  p5: ['Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001'],
  p6: ['P.O. Box 1', 'Exampleville 10000', 'Freedonia'],
  p7: ['500 Mill Way', 'Sampleton, CA 90002'],
  p8: ['2232 Kapa’a Street', 'Exampleton, HI 90003'],
};
const NAME = { p4: 'Pip', p5: 'Bea and Jo', p6: 'Paul and Lena Brook', p7: 'Ned and Zoë Birch', p8: 'The Fenwick Family' };

async function open({ runs = [], env = { ADDRESS_LABELS_TEST_PRINT: 'ok' }, members = MEMBERS, copies } = {}) {
  const dir = H.tmpDir();
  H.seed(dir, PEOPLE);
  const pr = H.project('Mailing', members, { runs });
  if (copies) pr.recipients.forEach((r) => { if (copies[r.personId]) r.copies = copies[r.personId]; });
  H.seedProjects(dir, [pr]);
  H.seedSettings(dir, { activeView: pr.id });
  const ctx = await H.launch(dir, env);
  return { ...ctx, pr };
}
const toast = (win) => win.locator('.toast .msg');
const chips = (win) => win.locator('.row .chip');
const runFor = (ids, at = '2026-01-01T10:00:00.000Z') => H.printRun(ids.map((id) => [id, NAME[id], LINES[id]]), at);
const menuClick = (app, top, label) => app.evaluate(({ Menu }, [t, l]) => {
  Menu.getApplicationMenu().items.find((i) => i.label === t).submenu.items.find((i) => i.label === l).click();
}, [top, label]);

// ---------- recording ----------
test('a print records a run without prompting: toast, Printed chips, Last print line, saved history', async () => {
  const { app, win, dir } = await open();
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await H.printOut(app, win);
  await expect(toast(win)).toHaveText('Sent 5 labels to the printer. 5 people marked as printed.');
  await expect(win.locator('.row .chip.printed')).toHaveCount(5);
  await expect(win.locator('.last-print')).toContainText('Last print: 5 labels');
  await expect(win.locator('.modal')).toHaveCount(0); // no "did it print?" prompt
  await H.settle();
  const run = H.readProjects(dir)[0].runs[0];
  expect(run).toMatchObject({ kind: 'print', startCell: 1, sheetCount: 1, undoneAt: null });
  expect(run.entries).toHaveLength(5);
  expect(run.entries.find((e) => e.personId === 'p5')).toMatchObject({ name: 'Bea and Jo', copies: 1, lines: LINES.p5 });
  await app.close();
});

test('copies are recorded per person and counted in the toast', async () => {
  const { app, win, dir } = await open({ copies: { p5: 3 } });
  await H.printOut(app, win);
  await expect(toast(win)).toHaveText('Sent 7 labels to the printer. 5 people marked as printed.');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveAttribute('title', /3 labels in total/);
  await H.settle();
  expect(H.readProjects(dir)[0].runs[0].entries.find((e) => e.personId === 'p5').copies).toBe(3);
  await app.close();
});

test('cancelling the system print dialog records nothing and leaves the dialog open', async () => {
  const { app, win, dir } = await open({ env: { ADDRESS_LABELS_TEST_PRINT: 'cancel' } });
  const pw = await H.printOut(app, win);
  await H.wait(400);
  await expect(win.locator('.toast')).toHaveCount(0);
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await expect(pw.locator('#stage .sheet')).toBeVisible();
  await H.settle();
  expect(H.readProjects(dir)[0].runs).toEqual([]);
  await app.close();
});

test('a failed print records nothing and the dialog shows its error', async () => {
  const { app, win } = await open({ env: { ADDRESS_LABELS_TEST_PRINT: 'fail' } });
  const pw = await H.printOut(app, win);
  await expect(pw.locator('#banners .banner.error')).toContainText('Printing failed');
  await expect(win.locator('.toast')).toHaveCount(0);
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await app.close();
});

test('Undo on the toast reverts the whole run and clears the Last print line', async () => {
  const { app, win, dir } = await open();
  await H.printOut(app, win);
  await win.click('.toast .btn:has-text("Undo")');
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await expect(win.locator('.last-print')).toHaveCount(0);
  await H.settle();
  expect(H.readProjects(dir)[0].runs[0].undoneAt).toBeTruthy();
  await app.close();
});

test('the start cell still opens at 1 after a run recorded start cell 14; History shows it for information', async () => {
  const { app, win } = await open();
  await H.printOut(app, win, { start: 14 });
  await expect(toast(win)).toContainText('Sent 5 labels');
  await H.printClosed(app);
  await win.click('#print');
  const pw = await H.printWindow(app);
  await expect(pw.locator('#start')).toHaveValue('1');
  await pw.click('#cancel');
  await H.printClosed(app);
  await win.click('#history-btn');
  await expect(win.locator('.run .caption').first()).toContainText('start cell 14');
  await app.close();
});

// ---------- corrections ----------
test('Details… opens History on the run; "Didn\'t come out" reverts only the ticked people', async () => {
  const { app, win } = await open();
  await H.printOut(app, win);
  await win.click('.toast .btn:has-text("Details…")');
  await expect(win.locator('.modal.history .run-people')).toBeVisible();
  await win.locator('.entry', { hasText: 'Pip' }).locator('input').check();
  await win.locator('.entry', { hasText: 'Bea and Jo' }).locator('input').check();
  await expect(win.locator('#didnt')).toHaveText("Didn't come out (2)");
  await win.click('#didnt');
  await expect(toast(win)).toHaveText('Updated 2 people.');
  await expect(win.locator('.entry.undone')).toHaveCount(2);
  await expect(win.locator('.entry.undone').first()).toContainText("Didn't come out · Not printed");
  await expect(win.locator('.run .caption').first()).toContainText('5 recorded · 3 in effect');
  await win.keyboard.press('Escape');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('Not printed');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Not printed');
  await expect(win.locator('.row .chip.printed')).toHaveCount(3);
  await app.close();
});

test('the Last print line stays after the toast fades, Review… opens the run, and a view change clears it', async () => {
  const { app, win } = await open();
  await H.printOut(app, win);
  await win.evaluate(() => UI.Toast.clear());
  await expect(win.locator('.toast')).toHaveCount(0);
  await expect(win.locator('.last-print')).toBeVisible();
  await win.click('.last-print .btn:has-text("Review…")');
  await expect(win.locator('.modal.history .run-people')).toBeVisible();
  await win.keyboard.press('Escape');
  await win.click('.side-item[data-view="book"]');
  await win.locator('.side-item', { hasText: 'Mailing' }).click();
  await expect(win.locator('.last-print')).toHaveCount(0);
  await app.close();
});

test('row context menu: "Didn\'t come out (last print)" only for people with a print entry', async () => {
  const { app, win } = await open({ runs: [runFor(['p4'])] });
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await expect(win.locator('.menu .menu-item')).toHaveText(['Edit…', 'Needs an address update', 'Mark as printed', 'Remove from project']);
  await win.keyboard.press('Escape');
  await H.row(win, 'Pip').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: "Didn't come out (last print)" }).click();
  await expect(toast(win)).toHaveText('Updated 1 person. Pip: Not printed');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('Not printed');
  await app.close();
});

test('a failed reprint falls back to the earlier print; after a move it shows Address changed', async () => {
  const { app, win } = await open({ runs: [runFor(MEMBERS)] });
  await expect(win.locator('.row .chip.printed')).toHaveCount(5);
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await win.check('.modal input[value="moved"]');
  await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Address changed');
  await H.menu(win, 'Select needs printing');
  await expect(win.locator('#summary')).toContainText('1 person · 1 label');
  await H.printOut(app, win);
  await expect(H.row(win, 'Bea and Jo').locator('.chip.printed')).toBeVisible();
  await win.click('.toast .btn:has-text("Details…")');
  await win.locator('.run').first().locator('.entry', { hasText: 'Bea and Jo' }).locator('input').check();
  await win.click('#didnt');
  await win.keyboard.press('Escape');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Address changed'); // the only label in effect has the old address
  await expect(win.locator('.row .chip.printed')).toHaveCount(4);
  await app.close();
});

test('failed reprint of an unchanged recipient: still Printed from the earlier run', async () => {
  const { app, win } = await open({ runs: [runFor(MEMBERS)] });
  await H.printOut(app, win);
  await win.click('.toast .btn:has-text("Details…")');
  await win.locator('.entry', { hasText: 'Pip' }).first().locator('input').check();
  await win.click('#didnt');
  await expect(toast(win)).toHaveText('Updated 1 person.');
  await win.keyboard.press('Escape');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('Printed Jan 1');
  await app.close();
});

test('I printed these myself and Needs a label again act on hidden selected people too', async () => {
  const { app, win } = await open();
  await win.fill('#search', 'Pip');
  await expect(win.locator('.row')).toHaveCount(1);
  await expect(win.locator('#summary')).toContainText('4 selected people are hidden by the filter');
  await H.menu(win, 'I printed these myself');
  await expect(toast(win)).toHaveText('Updated 5 people.');
  await win.fill('#search', '');
  await expect(win.locator('.row .chip.printed')).toHaveCount(5);
  await win.fill('#search', 'Pip');
  await H.menu(win, 'Needs a label again');
  await expect(toast(win)).toHaveText('Updated 5 people.');
  await win.fill('#search', '');
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await win.click('#select-none');
  await win.click('#more-btn');
  const item = win.locator('.menu .menu-item', { hasText: 'I printed these myself' });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toHaveAttribute('title', 'Select people first');
  await app.close();
});

test('Mark then Undo on its toast restores the previous status', async () => {
  const { app, win } = await open();
  await H.menu(win, 'I printed these myself');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await app.close();
});

// ---------- saving a PDF ----------
test('Save as PDF is logged but marks no one as printed, and keeps the dialog open', async () => {
  const out = path.join(H.tmpDir(), 'p.pdf');
  const { app, win } = await open({ env: { ADDRESS_LABELS_TEST_PDF: out } });
  await win.click('#print');
  const pw = await H.printWindow(app);
  await pw.click('#pdf');
  await expect(pw.locator('#banners')).toContainText('Saved ' + out);
  await expect(pw.locator('#stage .sheet')).toBeVisible();
  await expect(chips(win)).toHaveText(Array(5).fill('Not printed'));
  await expect(win.locator('.toast')).toHaveCount(0);
  await pw.click('#cancel');
  await win.click('#history-btn');
  await expect(win.locator('.run .title')).toContainText('PDF saved');
  await app.close();
});

// ---------- filters and selection actions ----------
function mixedRuns() {
  // Sam and Pip printed (matching), Philip printed with a different address, Nate and Fenwick never printed.
  return [H.printRun([['p5', NAME.p5, LINES.p5], ['p4', NAME.p4, []], ['p6', NAME.p6, ['old address']]])];
}
test('status chips, the Needs printing / Printed filters, and the three selection actions', async () => {
  const { app, win } = await open({ runs: mixedRuns() });
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Printed Jan 1');
  await expect(H.row(win, 'Paul and Lena Brook').locator('.chip')).toHaveText('Address changed');
  await expect(H.row(win, 'Ned and Zoë Birch').locator('.chip')).toHaveText('Not printed');
  await win.click('[data-filter="needs"]');
  await expect(win.locator('.row .name')).toHaveText(['The Fenwick Family', 'Ned and Zoë Birch', 'Paul and Lena Brook']); // "The Fenwick" files under F
  await win.click('[data-filter="printed"]');
  await expect(win.locator('.row .name')).toHaveText(['Bea and Jo', 'Pip']); // Address changed is not under Printed
  await win.click('[data-filter="all"]');
  await H.menu(win, 'Select needs printing');
  await expect(win.locator('#summary')).toContainText('3 people');
  await H.menu(win, 'Select not yet printed');
  await expect(win.locator('#summary')).toContainText('2 people');
  await expect(H.row(win, 'Paul and Lena Brook').locator('input.check')).not.toBeChecked();
  await H.menu(win, 'Select changed addresses');
  await expect(win.locator('#summary')).toContainText('1 person');
  await expect(H.row(win, 'Paul and Lena Brook').locator('input.check')).toBeChecked();
  await app.close();
});

test('tooltips: Printed gives date, time and total labels; Address changed explains', async () => {
  const { app, win } = await open({ runs: mixedRuns() });
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveAttribute('title', /Printed Jan 1, 2026, .* · 1 label in total/);
  await expect(H.row(win, 'Paul and Lena Brook').locator('.chip')).toHaveAttribute('title', /Address changed since printing on Jan 1\. The printed label has the old address\./);
  await app.close();
});

test('a typo fix and a move after printing both show Address changed; a whitespace-only edit does not', async () => {
  const { app, win } = await open({ runs: [runFor(['p5', 'p7', 'p8'])] });
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await win.fill('.modal textarea', 'Acme Dental Group\n3300 Webster Street #1109\nSpringfield, CA 90001'); // typo fix, same version
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Address changed');
  await H.row(win, 'Ned and Zoë Birch').locator('button.edit').click();
  await win.check('.modal input[value="moved"]');
  await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Ned and Zoë Birch').locator('.chip')).toHaveText('Address changed');
  await H.row(win, 'The Fenwick Family').locator('button.edit').click();
  await win.fill('.modal textarea', '  2232 Kapa’a   Street \nExampleton, HI 90003');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'The Fenwick Family').locator('.chip')).toHaveText('Printed Jan 1');
  await app.close();
});

// ---------- History ----------
test('History: undo a run, restore it, per-person undo and restore, recorded vs in-effect counts', async () => {
  const { app, win } = await open({ runs: [runFor(['p4', 'p5', 'p7'])] });
  await win.click('#history-btn');
  await expect(win.locator('.run .caption').first()).toContainText('3 labels');
  await win.click('.run-head .btn:has-text("Undo run")');
  await expect(win.locator('.run.undone')).toHaveCount(1);
  await win.keyboard.press('Escape');
  await expect(win.locator('.row .chip.printed')).toHaveCount(0);
  await win.click('#history-btn');
  await win.click('.run-head .btn:has-text("Restore")');
  await expect(win.locator('.run.undone')).toHaveCount(0);
  await win.click('.run-head .btn[aria-label="Show people"]');
  await win.locator('.entry', { hasText: 'Pip' }).locator('input').check();
  await win.click('#didnt');
  await expect(win.locator('.run .caption').first()).toContainText('3 recorded · 2 in effect');
  await win.locator('.entry.undone .btn:has-text("Restore")').click();
  await expect(win.locator('.run .caption').first()).toContainText('3 labels');
  await win.keyboard.press('Escape');
  await expect(win.locator('.row .chip.printed')).toHaveCount(3);
  await app.close();
});

test('History with no runs says "Nothing printed yet"', async () => {
  const { app, win } = await open();
  await win.click('#history-btn');
  await expect(win.locator('.modal.history .empty h2')).toHaveText('Nothing printed yet');
  await app.close();
});

test('toasts: one at a time, and ⌘Z undoes the visible action', async () => {
  const { app, win } = await open();
  await H.row(win, 'Pip').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: 'Remove from project' }).click();
  await expect(toast(win)).toHaveText('Removed Pip from Mailing.');
  await H.menu(win, 'I printed these myself');
  await expect(win.locator('.toast')).toHaveCount(1);
  await expect(toast(win)).toHaveText('Updated 4 people.');
  await menuClick(app, 'Edit', 'Undo');
  await expect(chips(win)).toHaveText(Array(4).fill('Not printed'));
  await expect(H.row(win, 'Pip')).toHaveCount(0); // the earlier removal stays removed
  await app.close();
});

test('toast timer pauses while the pointer is over it', async () => {
  const { app, win } = await open();
  await H.menu(win, 'I printed these myself');
  await win.locator('.toast').hover();
  await win.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  await expect(win.locator('.toast')).toBeVisible();
  await app.close();
});

// ---------- errors ----------
test('corrupt projects.json: the Address book still works, a banner offers Restore, and the file is untouched', async () => {
  const dir = H.tmpDir();
  H.seed(dir, PEOPLE);
  const bad = '{ "projects": [ { "id": ';
  fs.writeFileSync(path.join(dir, 'projects.json'), bad);
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.writeFileSync(path.join(dir, 'backups', 'projects-2025-01-01T00-00-00-000Z.json'), JSON.stringify({ version: 1, projects: [H.project('Restored one', ['p4'])] }));
  const { app, win } = await H.launch(dir);
  await expect(win.locator('.side-note.warn')).toHaveText('Projects unavailable');
  await expect(win.locator('.banner.error')).toContainText('projects.json could not be read');
  await expect(win.locator('.row')).toHaveCount(10); // Address book is usable
  await win.click('#add');
  await win.fill('.modal input[aria-label="Name"]', 'Still works');
  await win.click('.modal .btn.primary');
  await H.settle();
  expect(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8')).toBe(bad);
  await win.click('.banner .btn:has-text("Restore latest backup")');
  await expect(H.side(win, 'Restored one')).toBeVisible();
  expect(fs.readdirSync(dir).some((n) => n.startsWith('projects.broken-'))).toBe(true);
  await app.close();
});

test('invalid projects are skipped with a banner and written back untouched', async () => {
  const dir = H.tmpDir();
  H.seed(dir, PEOPLE);
  H.seedProjects(dir, [H.project('Good', ['p4']), { name: 'No id here' }]);
  const { app, win } = await H.launch(dir);
  await expect(win.locator('.banner')).toContainText('1 project in projects.json could not be read');
  await H.side(win, 'Good').click();
  await win.locator('input[aria-label="Copies for Pip"]').fill('2');
  await win.locator('input[aria-label="Copies for Pip"]').press('Enter');
  await H.settle();
  const projects = H.readProjects(dir);
  expect(projects).toHaveLength(2);
  expect(projects.find((p) => p.name === 'No id here')).toBeTruthy();
  await app.close();
});

test('a project save failure shows a banner with Retry, and Retry recovers', async () => {
  const { app, win, dir } = await open();
  await H.wait(300);
  fs.chmodSync(dir, 0o500);
  try {
    await win.locator('input[aria-label="Copies for Pip"]').fill('4');
    await win.locator('input[aria-label="Copies for Pip"]').press('Enter');
    await expect(win.locator('.banner.error')).toContainText('Could not save projects.json', { timeout: 8000 });
    expect(await win.title()).toBe('Address Labels — Edited');
  } finally { fs.chmodSync(dir, 0o700); }
  await win.click('.banner.error .btn:has-text("Retry")');
  await expect(win.locator('.banner.error')).toHaveCount(0);
  expect(H.readProjects(dir)[0].recipients.find((r) => r.personId === 'p4').copies).toBe(4);
  await app.close();
});

test('a print that cannot be recorded says so, and Retry saves the run', async () => {
  const { app, win, dir } = await open();
  await H.wait(300);
  fs.chmodSync(dir, 0o500);
  try {
    await H.printOut(app, win);
    await expect(win.locator('.banner.error')).toContainText('The print was sent but could not be recorded in Mailing.', { timeout: 8000 });
  } finally { fs.chmodSync(dir, 0o700); }
  await win.click('.banner.error .btn:has-text("Retry")');
  await expect(win.locator('.banner.error')).toHaveCount(0);
  await H.settle();
  expect(H.readProjects(dir)[0].runs).toHaveLength(1);
  await app.close();
});

test('Restore from Backup… can restore Projects', async () => {
  const { app, win, dir } = await open();
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backups', 'projects-2025-01-01T00-00-00-000Z.json'), JSON.stringify({ version: 1, projects: [H.project('From backup', ['p4'])] }));
  await app.evaluate(({ dialog, Menu }) => {
    let n = 0;
    dialog.showMessageBox = async () => ({ response: n++ === 0 ? 1 : 0 }); // 1st: Projects, 2nd: first backup
    Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'Restore from Backup…').click();
  });
  await expect(H.side(win, 'From backup')).toBeVisible();
  await expect(H.side(win, 'Mailing')).toHaveCount(0);
  await app.close();
});

test('quitting while a project save is failing offers an export that includes the projects', async () => {
  const exportPath = path.join(H.tmpDir(), 'copy.json');
  const { app, win, dir } = await open({ env: { ADDRESS_LABELS_TEST_EXPORT: exportPath } });
  await H.wait(300);
  fs.chmodSync(dir, 0o500);
  try {
    await win.locator('input[aria-label="Copies for Pip"]').fill('4');
    await win.locator('input[aria-label="Copies for Pip"]').press('Enter');
    await expect(win.locator('.banner.error')).toBeVisible({ timeout: 8000 });
  } finally { /* stays read-only until the quit flow has run */ }
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); }); // "Export a copy…"
  const exited = new Promise((r) => app.process().once('exit', r));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await exited;
  fs.chmodSync(dir, 0o700);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  expect(exported.projects.projects[0].recipients.find((r) => r.personId === 'p4').copies).toBe(4);
  expect(exported.addresses).toBeNull();
});

test('right-click ▸ Mark as printed: one person, with Undo; then it offers Needs a label again', async () => {
  const { app, win } = await open();
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: /^Mark as printed$/ }).click();
  await expect(toast(win)).toHaveText('Marked Bea and Jo as printed.');
  await expect(H.row(win, 'Bea and Jo').locator('.chip.printed')).toBeVisible();
  await expect(win.locator('.row .chip.printed')).toHaveCount(1); // only that person
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await expect(win.locator('.menu .menu-item', { hasText: /^Mark as printed$/ })).toHaveCount(0);
  await win.keyboard.press('Escape');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Not printed');
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: /^Mark as printed$/ }).click();
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: /^Needs a label again$/ }).click();
  await expect(toast(win)).toHaveText('Bea and Jo needs a label again.');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Not printed');
  await app.close();
});
