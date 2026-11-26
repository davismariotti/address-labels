const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

/** Make a project from the given people (or 'all') and open its print dialog. */
async function openPrint(people, checked, env) {
  const dir = H.tmpDir();
  H.seed(dir, people);
  const ctx = await H.launch(dir, env);
  await H.createProject(ctx.win, 'Test mailing', checked);
  await ctx.win.click('#print');
  ctx.pw = await H.printWindow(ctx.app);
  return ctx;
}

test('opens at start cell 1 with a preview of the labels; no start cell is saved', async () => {
  const { app, pw, dir } = await openPrint(H.fixture('small.json'), 'all');
  expect(await pw.title()).toBe('Print Labels — Test mailing');
  await expect(pw.locator('#pdf-hint')).toContainText("Saving a PDF doesn't mark anyone as printed.");
  await expect(pw.locator('#start')).toHaveValue('1');
  await expect(pw.locator('#stage .cell.skipped')).toHaveCount(0);
  await expect(pw.locator('#stage .cell.label-cell')).toHaveCount(10);
  await expect(pw.locator('#topsummary')).toHaveText('10 labels · 1 sheet');
  await expect(pw.locator('#start-pos')).toHaveText('Row 1, column 1');
  await H.wait(300);
  const settingsFile = path.join(dir, 'settings.json');
  if (fs.existsSync(settingsFile)) expect(JSON.stringify(H.readSettings(dir))).not.toMatch(/startCell|start/i);
  await app.close();
});

test('start cell 14: cells 1–13 hatched, row/column summary; resets to 1 on reopen', async () => {
  const { app, win, pw } = await openPrint(H.fixture('small.json'), 'all');
  await pw.fill('#start', '14'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#stage .cell.skipped')).toHaveCount(13);
  await expect(pw.locator('#stage .cell.start')).toHaveAttribute('data-cell', '14');
  await expect(pw.locator('#start-pos')).toHaveText('Row 5, column 2');
  await expect(pw.locator('#start-notes')).toContainText('Cells 1–13 of sheet 1 are left empty.');
  await pw.click('#cancel');
  await H.printClosed(app);
  await expect(win.locator('#print')).toBeVisible();
  await win.click('#print');
  const pw2 = await H.printWindow(app);
  await expect(pw2.locator('#start')).toHaveValue('1');
  await app.close();
});

test('clicking a preview cell sets the start cell', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), 'all');
  await pw.click('#stage .cell[data-cell="8"]');
  await expect(pw.locator('#start')).toHaveValue('8');
  await expect(pw.locator('#stage .cell.skipped')).toHaveCount(7);
  await app.close();
});

test('typing is not interrupted; invalid values give an inline error on commit', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), 'all');
  await pw.fill('#start', '');
  await pw.type('#start', '3');
  await expect(pw.locator('#start-err')).toBeHidden();
  await pw.fill('#start', '31'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#start-err')).toHaveText('Enter a number from 1 to 30');
  await expect(pw.locator('#stage .cell.skipped')).toHaveCount(0);
  await pw.fill('#start', '0'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#start-err')).toBeVisible();
  await pw.fill('#start', 'abc'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#start-err')).toBeVisible();
  await pw.fill('#start', '30'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#start-err')).toBeHidden();
  await app.close();
});

test('paging across sheets and the partly-used-sheet message', async () => {
  const { app, pw } = await openPrint(H.fixture('large.json'), 'all');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 1 of 3');
  await pw.fill('#start', '14'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 1 of 4');
  await expect(pw.locator('#start-notes')).toContainText('Sheet 1 is your partly used sheet. Sheets 2–4 need fresh sheets.');
  await pw.click('#next');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 2 of 4');
  await expect(pw.locator('#stage .cell.skipped')).toHaveCount(0);
  await pw.click('#next'); await pw.click('#next');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 4 of 4');
  await expect(pw.locator('#next')).toHaveAttribute('aria-disabled', 'true');
  await app.close();
});

test('outlines toggle draws all 30 cells', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), 'all');
  await expect(pw.locator('#stage .cell.outlined')).toHaveCount(0);
  await pw.check('#outlines');
  await expect(pw.locator('#stage .cell.outlined')).toHaveCount(30);
  await app.close();
});

test('alignment nudge persists across restart; out-of-range shows an error and keeps the last value', async () => {
  const { app, pw, dir } = await openPrint(H.fixture('small.json'), 'all');
  await pw.locator('#alignment summary').click();
  await pw.fill('#nudge-x', '0.02'); await pw.press('#nudge-x', 'Enter');
  await pw.fill('#nudge-y', '-0.03'); await pw.press('#nudge-y', 'Enter');
  await pw.fill('#nudge-x', '0.9'); await pw.press('#nudge-x', 'Enter');
  await expect(pw.locator('#nudge-err')).toHaveText('Use a value between -0.25 and 0.25 in');
  await expect(pw.locator('#nudge-x')).toHaveValue('0.02');
  await H.wait(400);
  expect(H.readSettings(dir).nudge).toEqual({ x: 0.02, y: -0.03 });
  await app.close();
  const ctx = await H.launch(dir);
  await ctx.win.click('#print'); // the app reopens on the project, with its selection
  const pw2 = await H.printWindow(ctx.app);
  await expect(pw2.locator('#nudge-x')).toHaveValue('0.02');
  await expect(pw2.locator('#nudge-y')).toHaveValue('-0.03');
  await ctx.app.close();
});

test('warnings: no-address people can be listed', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), ['Pip', 'Bea and Jo']);
  await expect(pw.locator('#warnings')).toContainText('1 person has no address and will print as name only.');
  await pw.locator('#warnings .btn.link').click();
  await expect(pw.locator('#warnings li')).toHaveText(['Pip']);
  await app.close();
});

test('a label that cannot fit shows the review prompt before printing; Review jumps to it', async () => {
  const people = [...H.fixture('small.json'), { name: 'W'.repeat(80), address: [{ line1: '1 Main St', version: 1 }] }];
  const { app, pw } = await openPrint(people, 'all');
  await expect(pw.locator('#warnings')).toContainText('1 label may be hard to read.');
  await pw.click('#print');
  await expect(pw.locator('.modal')).toContainText('1 label may be hard to read');
  await pw.click('#review-btn');
  await expect(pw.locator('.modal')).toHaveCount(0);
  await expect(pw.locator('#warnings li')).toHaveCount(1);
  await expect(pw.locator('#stage .cell.flag-nofit')).toHaveCount(1);
  await app.close();
});

test('Esc closes the dialog with no prompt', async () => {
  const { app, win, pw } = await openPrint(H.fixture('small.json'), 'all');
  await pw.keyboard.press('Escape').catch(() => {}); // the window closes mid-press, which is the point
  await expect.poll(() => app.windows().filter((w) => w.url().includes('print.html')).length).toBe(0);
  await expect(win.locator('#print')).toBeVisible();
  await app.close();
});

test('Save as PDF writes a file and is not blocked by an unreadable label', async () => {
  const out = path.join(H.tmpDir(), 'labels.pdf');
  const people = [...H.fixture('small.json'), { name: 'W'.repeat(80), address: [{ line1: '1 Main St', version: 1 }] }];
  const { app, pw } = await openPrint(people, 'all', { ADDRESS_LABELS_TEST_PDF: out });
  await pw.click('#pdf');
  await expect(pw.locator('#banners')).toContainText('Saved ' + out);
  expect(fs.existsSync(out)).toBe(true);
  expect(fs.statSync(out).size).toBeGreaterThan(1000);
  await app.close();
});

test('Save as PDF failure is reported inline and the dialog stays as it was', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), 'all', { ADDRESS_LABELS_TEST_PDF: '/nonexistent-folder/labels.pdf' });
  await pw.fill('#start', '5'); await pw.press('#start', 'Enter');
  await pw.click('#pdf');
  await expect(pw.locator('#banners .banner.error')).toContainText('Could not write to /nonexistent-folder');
  await expect(pw.locator('#start')).toHaveValue('5');
  await app.close();
});

test('no printer: banner, Print… disabled with a reason, Save as PDF… still works', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), 'all', { ADDRESS_LABELS_TEST_NO_PRINTER: '1' });
  await expect(pw.locator('#banners')).toContainText('No printer found. You can still save a PDF.');
  await expect(pw.locator('#print')).toHaveAttribute('aria-disabled', 'true');
  await expect(pw.locator('#print')).toHaveAttribute('title', /No printer found/);
  await expect(pw.locator('#pdf')).not.toHaveAttribute('aria-disabled', 'true');
  await app.close();
});

// ---------- one sheet at a time (hand-loading the printer) ----------
const sheetProject = async (env = { ADDRESS_LABELS_TEST_PRINT: 'ok' }, people = H.fixture('large.json')) => {
  const dir = H.tmpDir();
  H.seed(dir, people);
  const ctx = await H.launch(dir, env);
  await H.createProject(ctx.win, 'Big mailing', 'all');
  await ctx.win.click('#print');
  ctx.pw = await H.printWindow(ctx.app);
  ctx.dir = dir;
  return ctx;
};

test('with several sheets the dialog offers This sheet / All sheets, defaults to This sheet, and names the sheet', async () => {
  const { app, pw } = await sheetProject();
  await expect(pw.locator('#scope-section')).toBeVisible();
  await expect(pw.locator('#scope [data-scope="sheet"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(pw.locator('#print')).toContainText('Print sheet 1…');
  await expect(pw.locator('#scope-note')).toContainText('Prints sheet 1 of 3 (30 labels). 52 labels left');
  await pw.click('#next');
  await expect(pw.locator('#print')).toContainText('Print sheet 2…');
  await app.close();
});

test('a single sheet needs no scope control', async () => {
  const { app, pw } = await openPrint(H.fixture('small.json'), 'all');
  await expect(pw.locator('#scope-section')).toBeHidden();
  await expect(pw.locator('#print')).toContainText('Print…');
  await app.close();
});

test('printing one sheet at a time: each records only its labels, the dialog stays open, start resets to 1, and it closes after the last', async () => {
  const { app, win, pw, dir } = await sheetProject();
  await pw.fill('#start', '14'); await pw.press('#start', 'Enter');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 1 of 4');
  await pw.click('#print'); // sheet 1: cells 14–30 = 17 labels
  await expect(pw.locator('#banners')).toContainText('Printed 17 labels. 65 labels left. Load the next sheet and print again.');
  await expect(pw.locator('#start')).toHaveValue('1'); // the next sheet is a fresh one
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 1 of 3');
  await expect(win.locator('.toast .msg')).toContainText('Sent 17 labels to the printer');
  await pw.click('#print'); // 30
  await expect(pw.locator('#banners')).toContainText('Printed 30 labels. 35 labels left.');
  await pw.click('#print'); // 30
  await expect(pw.locator('#banners')).toContainText('Printed 30 labels. 5 labels left.');
  await expect(pw.locator('#scope-section')).toBeHidden(); // one sheet left
  await pw.click('#print'); // last 5, then the dialog closes
  await H.printClosed(app);
  await H.settle();
  const runs = H.readProjects(dir)[0].runs;
  expect(runs.map((r) => r.entries.length)).toEqual([17, 30, 30, 5]);
  expect(runs.map((r) => r.startCell)).toEqual([14, 1, 1, 1]);
  expect(runs.every((r) => r.sheetCount === 1)).toBe(true);
  expect(new Set(runs.flatMap((r) => r.entries.map((e) => e.personId))).size).toBe(82); // everyone exactly once
  await expect(win.locator('.row .chip.printed')).toHaveCount(82);
  await app.close();
});

test('printing a later sheet first leaves the first sheet\'s start cell alone', async () => {
  const { app, pw } = await sheetProject();
  await pw.fill('#start', '14'); await pw.press('#start', 'Enter');
  await pw.click('#next');
  await pw.click('#print'); // sheet 2: a full fresh sheet of 30
  await expect(pw.locator('#banners')).toContainText('Printed 30 labels. 52 labels left.');
  await expect(pw.locator('#start')).toHaveValue('14');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 2 of 3'); // it stays in place, now showing the next unprinted sheet
  await pw.click('#prev');
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 1 of 3');
  await expect(pw.locator('#stage .cell.skipped')).toHaveCount(13);
  await app.close();
});

test('All sheets prints everything in one job and closes', async () => {
  const { app, win, pw, dir } = await sheetProject();
  await pw.click('#scope [data-scope="all"]');
  await expect(pw.locator('#print')).toContainText('Print…');
  await expect(pw.locator('#scope-note')).toHaveText('Prints all 3 sheets in one job.');
  await pw.click('#print');
  await H.printClosed(app);
  await expect(win.locator('.toast .msg')).toContainText('Sent 82 labels');
  await H.settle();
  expect(H.readProjects(dir)[0].runs[0].entries).toHaveLength(82);
  await app.close();
});

test('the This sheet / All sheets choice is remembered', async () => {
  const { app, pw, dir, win } = await sheetProject();
  await pw.click('#scope [data-scope="all"]');
  await H.wait(300);
  expect(H.readSettings(dir).printScope).toBe('all');
  await pw.click('#cancel');
  await H.printClosed(app);
  await win.click('#print');
  const pw2 = await H.printWindow(app);
  await expect(pw2.locator('#scope [data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
  await app.close();
});

test('the unreadable-label prompt only considers the sheet being printed', async () => {
  const people = [...Array.from({ length: 30 }, (_, i) => ({ name: `Person ${String(i).padStart(2, '0')}`, address: [{ line1: '1 Main St', version: 1 }] })),
    { name: 'W'.repeat(80), address: [{ line1: '1 Main St', version: 1 }] }];
  const { app, pw } = await sheetProject(undefined, people);
  await expect(pw.locator('#sheetlabel')).toHaveText('Sheet 1 of 2');
  await pw.click('#print'); // sheet 1 has no problem label: no prompt, it prints
  await expect(pw.locator('#banners')).toContainText('Printed 30 labels. 1 label left.');
  await expect(pw.locator('.modal')).toHaveCount(0);
  await app.close();
});

test('people who were already printed are listed as a warning but still print when they are selected', async () => {
  const dir = H.tmpDir();
  const people = H.withIds(H.fixture('small.json'));
  H.seed(dir, people);
  const run = H.printRun([['p5', 'Bea and Jo', ['Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001']]]);
  const pr = H.project('Mailing', ['p4', 'p5', 'p7'], { runs: [run] });
  H.seedProjects(dir, [pr]);
  H.seedSettings(dir, { activeView: pr.id });
  const { app, win } = await H.launch(dir);
  await win.click('#print');
  const pw = await H.printWindow(app);
  await expect(pw.locator('#warnings')).toContainText('1 person was already printed. Printing them again makes duplicate labels.');
  await expect(pw.locator('#topsummary')).toHaveText('3 labels · 1 sheet');
  await app.close();
});
