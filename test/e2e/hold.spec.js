/* "Needs an address update": a hold on the person. Shown in every non-archived project, skipped when printing. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const PEOPLE = H.withIds(H.fixture('small.json'));
// p4 Pip, p5 Sam, p6 Brook, p7 Nate, p8 Fenwick
const MEMBERS = ['p4', 'p5', 'p6', 'p7', 'p8'];

async function open({ projects, view, env = { ADDRESS_LABELS_TEST_PRINT: 'ok' }, people = PEOPLE } = {}) {
  const dir = H.tmpDir();
  H.seed(dir, people);
  const prs = projects || [H.project('Mailing', MEMBERS)];
  H.seedProjects(dir, prs);
  const start = view ? prs.find((p) => p.name === view) : prs[0];
  H.seedSettings(dir, { activeView: start.id });
  const ctx = await H.launch(dir, env);
  return { ...ctx, prs };
}
const toast = (win) => win.locator('.toast .msg');
/** Right-click ▸ Needs an address update: it just does it, with no sheet and no questions. */
async function putOnHold(win, name) {
  await H.row(win, name).click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: /^Needs an address update$/ }).click();
}

test('mark from a project: immediate, no sheet or text box; chip, dimmed row, tooltip, saved without a reason', async () => {
  const { app, win, dir } = await open();
  await H.row(win, 'Bea and Jo').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: /^Needs an address update$/ }).click();
  await expect(win.locator('.modal')).toHaveCount(0);
  await expect(win.locator('#hold-note-input')).toHaveCount(0);
  await expect(toast(win)).toHaveText('Put Bea and Jo on hold.');
  const row = H.row(win, 'Bea and Jo');
  await expect(row.locator('.chip')).toHaveText('On hold');
  await expect(row.locator('.chip')).toHaveAttribute('title', 'Needs an address update. Not printed until the hold is cleared.');
  await expect(row).toHaveClass(/held/);
  await H.settle();
  const saved = H.readPeople(dir).find((p) => p.id === 'p5').hold;
  expect(Object.keys(saved)).toEqual(['at']); // no reason is stored
  await app.close();
});

test('mark from the Address book: shown there and in every non-archived project', async () => {
  const projects = [H.project('A list', ['p5', 'p4']), H.project('B list', ['p5'])];
  const { app, win } = await open({ projects });
  await win.click('.side-item[data-view="book"]');
  await expect(win.locator('.row .chip')).toHaveCount(0); // no chips in the book until someone is held
  await putOnHold(win, 'Bea and Jo');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold');
  await H.side(win, 'A list').click();
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('Not printed');
  await H.side(win, 'B list').click();
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold');
  await app.close();
});

test('the hold survives a restart', async () => {
  const { app, win, dir, userData } = await open();
  await putOnHold(win, 'Pip');
  await H.settle();
  await app.close();
  const ctx = await H.launch(dir, {}, { userData });
  await expect(H.row(ctx.win, 'Pip').locator('.chip')).toHaveText('On hold');
  await ctx.app.close();
});

test('held people are skipped when printing: footer counts, note, Show filter, run entries', async () => {
  const { app, win, dir } = await open();
  await putOnHold(win, 'Bea and Jo');
  await expect(win.locator('#summary')).toContainText('4 people · 4 labels');
  await expect(win.locator('#summary')).toContainText("1 selected person is on hold and won't be printed");
  await expect(win.locator('[data-filter="hold"]')).toHaveText('On hold');
  await H.printOut(app, win);
  await expect(toast(win)).toHaveText('Sent 4 labels to the printer. 4 people marked as printed.');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold'); // still held, never printed
  await H.settle();
  const entries = H.readProjects(dir)[0].runs[0].entries;
  expect(entries.map((e) => e.personId).sort()).toEqual(['p4', 'p6', 'p7', 'p8']);
  await app.close();
});

test('the print dialog lists held people and prints no label for them', async () => {
  const { app, win } = await open();
  await putOnHold(win, 'Bea and Jo');
  await putOnHold(win, 'Pip');
  await win.click('#print');
  const pw = await H.printWindow(app);
  await expect(pw.locator('#topsummary')).toHaveText('3 labels · 1 sheet');
  await expect(pw.locator('#warnings')).toContainText("2 people are on hold and won't be printed.");
  await pw.locator('#warnings .btn.link').first().click();
  await expect(pw.locator('#warnings li')).toHaveText(['Bea and Jo', 'Pip']);
  await expect(pw.locator('#stage .cell.label-cell')).toHaveCount(3);
  await app.close();
});

test('everyone selected on hold: nothing to print and Print Labels… says why', async () => {
  const { app, win } = await open({ projects: [H.project('Small', ['p4', 'p5'])] });
  await putOnHold(win, 'Pip');
  await putOnHold(win, 'Bea and Jo');
  await expect(win.locator('#summary')).toContainText('Everyone selected is on hold');
  await expect(win.locator('#print')).toHaveAttribute('aria-disabled', 'true');
  await expect(win.locator('#print')).toHaveAttribute('title', 'Everyone selected is on hold');
  await app.close();
});

test('the On hold filter appears only when someone is held, and Show jumps to it', async () => {
  const { app, win } = await open();
  await expect(win.locator('[data-filter="hold"]')).toHaveCount(0);
  await putOnHold(win, 'Ned and Zoë Birch');
  await win.click('.held-note .btn:has-text("Show")');
  await expect(win.locator('.row .name')).toHaveText(['Ned and Zoë Birch']);
  await app.close();
});

test('Select needs printing / not yet printed skip held people', async () => {
  const { app, win } = await open();
  await putOnHold(win, 'Pip');
  await H.menu(win, 'Select needs printing');
  await expect(win.locator('#summary')).toContainText('4 people');
  await H.menu(win, 'Select not yet printed');
  await expect(win.locator('#summary')).toContainText('4 people');
  await app.close();
});

test('clear the hold from the menu; Undo puts it back', async () => {
  const { app, win } = await open();
  await putOnHold(win, 'Pip');
  await H.row(win, 'Pip').click({ button: 'right' });
  await win.locator('.menu .menu-item', { hasText: 'Clear address-update hold' }).click();
  await expect(toast(win)).toHaveText('Cleared the hold on Pip.');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('Not printed');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('On hold');
  await app.close();
});

test('undo on the "Put on hold" toast removes it', async () => {
  const { app, win } = await open();
  await putOnHold(win, 'Pip');
  await win.click('.toast .btn:has-text("Undo")');
  await expect(H.row(win, 'Pip').locator('.chip')).toHaveText('Not printed');
  await app.close();
});

test('Edit form: a hold checkbox (no note field); a typo fix keeps it; They moved clears it with a notice', async () => {
  const { app, win } = await open();
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await expect(win.locator('#hold-note')).toHaveCount(0);
  await win.check('#hold-box');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold');
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await expect(win.locator('#hold-box')).toBeChecked();
  await win.fill('.modal textarea', 'Acme Dental Group\n3300 Webster Street #1109\nSpringfield, CA 90001'); // typo fix
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold');
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await win.check('.modal input[value="moved"]');
  await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  await win.click('.modal .btn.primary');
  await expect(toast(win)).toHaveText('Cleared the hold on Bea and Jo: the address was updated.');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('Not printed');
  await app.close();
});

test('Edit form: ticking the hold in the same edit as a move keeps the hold', async () => {
  const { app, win } = await open();
  await H.row(win, 'Bea and Jo').locator('button.edit').click();
  await win.check('.modal input[value="moved"]');
  await win.fill('.modal textarea', '1 New Rd\nTown, CA 90000');
  await win.check('#hold-box');
  await win.click('.modal .btn.primary');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveText('On hold');
  await app.close();
});

test('a printed person on hold shows what the status was before in the tooltip', async () => {
  const run = H.printRun([['p5', 'Bea and Jo', ['Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001']]]);
  const { app, win } = await open({ projects: [H.project('Mailing', MEMBERS, { runs: [run] })] });
  await putOnHold(win, 'Bea and Jo');
  await expect(H.row(win, 'Bea and Jo').locator('.chip')).toHaveAttribute('title', /Last printed Jan 1\./);
  await app.close();
});

// ---------- Select all skips people who are not ready ----------
function mixedProject() {
  const run = H.printRun([['p5', 'Bea and Jo', ['Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001']]]);
  return H.project('Mailing', MEMBERS, { runs: [run] });
}
test('Select all skips people on hold and already printed ones, keeps manual ticks, and says what it skipped', async () => {
  const people = PEOPLE.map((p) => (p.id === 'p6' ? { ...p, hold: { at: '2026-11-01T00:00:00.000Z' } } : p));
  const { app, win } = await open({ projects: [mixedProject()], people });
  await win.click('#select-none');
  await expect(win.locator('#summary')).toContainText('No one selected');
  await win.click('#select-all');
  await expect(toast(win)).toHaveText('Selected 3 people. Skipped 1 on hold and 1 already printed.');
  await expect(H.row(win, 'Paul and Lena Brook').locator('input.check')).not.toBeChecked(); // on hold
  await expect(H.row(win, 'Bea and Jo').locator('input.check')).not.toBeChecked(); // already printed
  await expect(win.locator('.row input.check:checked')).toHaveCount(3);
  await app.close();
});

test('a person ticked by hand stays selected through Select all, and the warnings stay', async () => {
  const people = PEOPLE.map((p) => (p.id === 'p6' ? { ...p, hold: { at: '2026-11-01T00:00:00.000Z' } } : p));
  const { app, win } = await open({ projects: [mixedProject()], people });
  await win.click('#select-none');
  await H.row(win, 'Paul and Lena Brook').locator('input.check').check(); // manually select the held one
  await H.row(win, 'Bea and Jo').locator('input.check').check(); // and the already printed one
  await win.click('#select-all');
  await expect(win.locator('.toast')).toHaveCount(0); // nothing was left out, so there is nothing to report
  await expect(win.locator('.row input.check:checked')).toHaveCount(5);
  await expect(win.locator('#summary')).toContainText("1 selected person is on hold and won't be printed"); // the warning stays
  await win.click('#print');
  const pw = await H.printWindow(app);
  await expect(pw.locator('#warnings')).toContainText("1 person is on hold and won't be printed.");
  await expect(pw.locator('#warnings')).toContainText('1 person was already printed.');
  await app.close();
});

test('the Select all button counts only people who are ready when filtering, and explains itself', async () => {
  const people = PEOPLE.map((p) => (p.id === 'p6' ? { ...p, hold: { at: '2026-11-01T00:00:00.000Z' } } : p));
  const { app, win } = await open({ projects: [mixedProject()], people });
  await expect(win.locator('#select-all')).toHaveAttribute('title', /Skips people on hold and people already printed/);
  await win.fill('#search', 'a'); // matches several people
  const shown = await win.locator('.row').count();
  const text = await win.locator('#select-all').innerText();
  expect(Number(/(\d+) shown/.exec(text)[1])).toBeLessThan(shown + 1);
  await app.close();
});

test('Select all in the Address book still ticks everyone shown (that view has no printing)', async () => {
  const people = PEOPLE.map((p) => (p.id === 'p6' ? { ...p, hold: { at: '2026-11-01T00:00:00.000Z' } } : p));
  const { app, win } = await open({ projects: [mixedProject()], people });
  await win.click('.side-item[data-view="book"]');
  await win.click('#select-all');
  await expect(win.locator('#summary')).toContainText('10 ticked');
  await app.close();
});
