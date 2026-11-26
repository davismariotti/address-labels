/* Tier 3: screenshot baselines in light and dark. Baselines are machine-specific (fonts, scale), so regenerate with:
   npx playwright test --config test/e2e/playwright.config.js visual.spec.js --update-snapshots */
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const shot = { animations: 'disabled', maxDiffPixelRatio: 0.02 };
const PEOPLE = H.withIds(H.fixture('small.json'));
const LINES = {
  p5: ['Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001'],
  p7: ['500 Mill Way', 'Sampleton, CA 90002'],
};

/** Projects with a fixed look: one showing all three chips, plus a couple more for the sidebar. */
function seedProjects() {
  const mailing = H.project('Christmas 2026', ['p4', 'p5', 'p6', 'p7', 'p8'], {
    runs: [H.printRun([['p5', 'Bea and Jo', LINES.p5], ['p7', 'Ned and Zoë Birch', ['old address line']], ['p4', 'Pip', []]])],
  });
  mailing.recipients.find((r) => r.personId === 'p6').copies = 2;
  return [H.project('Christmas 2025', ['p0', 'p1', 'p2', 'p3']), mailing, H.project("Wedding announcement", ['p5', 'p7'])];
}

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    async function start({ people = PEOPLE, projects, view } = {}) {
      const dir = H.tmpDir();
      H.seed(dir, people);
      if (projects) { H.seedProjects(dir, projects); if (view) H.seedSettings(dir, { activeView: projects.find((p) => p.name === view).id }); }
      const ctx = await H.launch(dir, { TZ: 'UTC' }); // timestamps render the same on every machine
      await ctx.win.emulateMedia({ colorScheme: scheme });
      await ctx.win.mouse.move(1, 1);
      return ctx;
    }
    async function dialog(ctx) {
      await ctx.win.click('#print');
      const pw = await H.printWindow(ctx.app);
      await pw.emulateMedia({ colorScheme: scheme });
      await pw.mouse.move(1, 1);
      return pw;
    }

    test('address book with ticked rows', async () => {
      const { app, win } = await start({ projects: seedProjects() });
      await H.checkNames(win, ['Pip', 'Bea and Jo']);
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`book-${scheme}.png`, shot);
      await app.close();
    });

    test('empty address book', async () => {
      const { app, win } = await start({ people: [] });
      await expect(win).toHaveScreenshot(`empty-${scheme}.png`, shot);
      await app.close();
    });

    test('project with all three status chips and several projects in the sidebar', async () => {
      const { app, win } = await start({ projects: seedProjects(), view: 'Christmas 2026' });
      await expect(win.locator('.chip.changed')).toHaveCount(1);
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`project-${scheme}.png`, shot);
      await app.close();
    });

    test('project with someone on hold', async () => {
      const people = PEOPLE.map((p) => (p.id === 'p6' ? { ...p, hold: { at: '2026-11-01T00:00:00.000Z', note: 'moving in January' } } : p));
      const { app, win } = await start({ people, projects: seedProjects(), view: 'Christmas 2026' });
      await expect(win.locator('.chip.hold')).toHaveCount(1);
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`project-hold-${scheme}.png`, shot);
      await app.close();
    });

    test('archived project, read-only', async () => {
      const projects = seedProjects();
      const arch = projects[1];
      arch.archivedAt = '2026-11-20T10:00:00.000Z';
      arch.snapshot = arch.recipients.map((r) => { const p = PEOPLE.find((x) => x.id === r.personId); return { personId: p.id, name: p.name, lines: p.address.length ? Object.keys(p.address[0]).filter((k) => k.startsWith('line')).sort().map((k) => p.address[0][k]) : [], version: p.address.length ? 1 : null }; });
      const { app, win } = await start({ projects, view: 'Christmas 2026' });
      await expect(win.locator('.banner.neutral')).toBeVisible();
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`project-archived-${scheme}.png`, shot);
      await app.close();
    });

    test('empty project', async () => {
      const { app, win } = await start({ projects: [H.project('Fresh', [])], view: 'Fresh' });
      await expect(win).toHaveScreenshot(`project-empty-${scheme}.png`, shot);
      await app.close();
    });

    test('New project, Add people and History sheets', async () => {
      const { app, win } = await start({ projects: seedProjects(), view: 'Christmas 2026' });
      await H.menu(win, 'Add people…');
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`sheet-add-people-${scheme}.png`, shot);
      await win.keyboard.press('Escape');
      await win.click('#history-btn');
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`sheet-history-${scheme}.png`, shot);
      await win.keyboard.press('Escape');
      await win.click('.side-item.add');
      await win.mouse.move(1, 1);
      await expect(win).toHaveScreenshot(`sheet-new-project-${scheme}.png`, shot);
      await app.close();
    });

    test('print dialog: start cell 1', async () => {
      const { app, win } = await start({ projects: [H.project('Mailing', ['p4', 'p5', 'p6', 'p8'])], view: 'Mailing' });
      const pw = await dialog({ app, win });
      await expect(pw).toHaveScreenshot(`print-start1-${scheme}.png`, shot);
      await app.close();
    });

    test('print dialog: start cell 14', async () => {
      const { app, win } = await start({ projects: [H.project('Mailing', ['p4', 'p5', 'p6', 'p8'])], view: 'Mailing' });
      const pw = await dialog({ app, win });
      await pw.fill('#start', '14'); await pw.press('#start', 'Enter');
      await pw.mouse.move(1, 1);
      await expect(pw).toHaveScreenshot(`print-start14-${scheme}.png`, shot);
      await app.close();
    });

    test('print dialog: warning label', async () => {
      const people = [...PEOPLE, { id: 'wide', name: 'W'.repeat(80), address: [{ line1: '1 Main St', version: 1 }] }];
      const { app, win } = await start({ people, projects: [H.project('Mailing', ['p4', 'p5', 'wide'])], view: 'Mailing' });
      const pw = await dialog({ app, win });
      await pw.mouse.move(1, 1);
      await expect(pw).toHaveScreenshot(`print-warning-${scheme}.png`, shot);
      await app.close();
    });
  });
}
