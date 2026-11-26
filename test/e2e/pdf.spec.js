/* Tier 1: verify the generated PDF itself (page size, page count, text order, positions). */
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const Shared = Object.assign({}, require('../../src/shared/geometry.js'), require('../../src/shared/data.js'), require('../../src/shared/layout.js'));

const hasPoppler = spawnSync('pdftotext', ['-v']).status !== null;

function bbox(pdf) {
  const r = spawnSync('pdftotext', ['-bbox', pdf, '-']);
  const xml = r.stdout.toString();
  const pages = [];
  for (const pm of xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const words = [];
    for (const wm of pm[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)) {
      words.push({ x0: +wm[1], y0: +wm[2], x1: +wm[3], y1: +wm[4], text: wm[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") });
    }
    pages.push({ width: +pm[1], height: +pm[2], words });
  }
  return pages;
}
const squash = (s) => s.replace(/\s+/g, '').replace(/[’‘]/g, "'");

async function exportPdf({ startCell, nudge, pick }) {
  const dir = H.tmpDir();
  H.seed(dir, H.fixture('large.json'));
  const pdf = path.join(H.tmpDir(), 'out.pdf');
  const { app, win } = await H.launch(dir, { ADDRESS_LABELS_TEST_PDF: pdf });
  const people = H.readPeople(dir);
  const sorted = Shared.sortPeople(people);
  const chosen = sorted.filter((_, i) => pick(i));
  // Names can repeat, so tick rows by id.
  const ids = new Set(chosen.map((p) => p.id));
  await win.evaluate((list) => { document.querySelectorAll('.row').forEach((r) => { const cb = r.querySelector('input.check'); if (list.includes(r.dataset.id) !== cb.checked) cb.click(); }); }, [...ids]);
  await expect(win.locator('#summary')).toContainText(`${ids.size} ticked`);
  await win.click('#new-from-selection');
  await win.fill('.modal input[aria-label="Project name"]', 'PDF test');
  await win.click('.modal .btn.primary');
  await win.waitForSelector('#print');
  await win.click('#select-all'); // recipients start unticked
  await win.click('#print');
  const pw = await H.printWindow(app);
  if (nudge) {
    await pw.locator('#alignment summary').click();
    await pw.fill('#nudge-x', String(nudge.x)); await pw.press('#nudge-x', 'Enter');
    await pw.fill('#nudge-y', String(nudge.y)); await pw.press('#nudge-y', 'Enter');
  }
  if (startCell) { await pw.fill('#start', String(startCell)); await pw.press('#start', 'Enter'); }
  await pw.click('#pdf');
  await expect(pw.locator('#banners')).toContainText('Saved', { timeout: 20000 });
  await app.close();
  return { pdf, people: sorted, ids };
}

test.describe('generated PDF', () => {
  test.skip(!hasPoppler, 'poppler (pdftotext) is not installed');

  for (const scenario of [
    { name: 'start cell 1, 40 people, no nudge', startCell: 1, pick: (i) => i < 40 },
    { name: 'start cell 14, 45 people, with a nudge', startCell: 14, nudge: { x: 0.02, y: -0.03 }, pick: (i) => i % 2 === 0 },
    { name: 'all 82 people (1-line Pip through 4-line labels)', startCell: 1, pick: () => true, expectLines: [1, 3, 4] },
  ]) {
    test(`${scenario.name}: page count, size, text, and positions`, async () => {
      const { pdf, people, ids } = await exportPdf(scenario);
      const info = spawnSync('pdfinfo', [pdf]).stdout.toString();
      expect(info).toMatch(/Page size:\s+612 x 792 pts/);

      const labels = Shared.expandLabels(people, ids);
      const nudge = scenario.nudge || { x: 0, y: 0 };
      const laid = Shared.layout(labels, scenario.startCell || 1, nudge);
      const pages = bbox(pdf);
      expect(pages).toHaveLength(laid.sheetCount);

      let matchedWords = 0;
      const seenLineCounts = new Set();
      laid.sheets.forEach((sheet, si) => {
        const page = pages[si];
        expect(page.width).toBe(612);
        expect(page.height).toBe(792);
        for (const c of sheet.cells) {
          const tol = 0.02 * 72;
          const x0 = c.x * 72 - tol, x1 = (c.x + c.w) * 72 + tol, y0 = c.y * 72 - tol, y1 = (c.y + c.h) * 72 + tol;
          const inside = page.words.filter((w) => w.x0 >= x0 && w.x1 <= x1 && w.y0 >= y0 && w.y1 <= y1);
          matchedWords += inside.length;
          if (c.state !== 'label') { expect(inside, `cell ${c.cell} of sheet ${si + 1} should be empty`).toHaveLength(0); continue; }
          const text = squash(inside.sort((a, b) => (Math.abs(a.y0 - b.y0) > 2 ? a.y0 - b.y0 : a.x0 - b.x0)).map((w) => w.text).join(' '));
          expect(text, `sheet ${si + 1}, cell ${c.cell}`).toBe(squash(c.label.lines.join(' ')));

          // Centering: the text block is vertically centered in the cell, and each line is
          // horizontally centered (tolerance 0.05 in covers font ascent/descent boxes).
          const cellMidY = (c.y + c.h / 2) * 72, cellMidX = (c.x + c.w / 2) * 72, tolC = 0.05 * 72;
          const blockMidY = (Math.min(...inside.map((w) => w.y0)) + Math.max(...inside.map((w) => w.y1))) / 2;
          expect(Math.abs(blockMidY - cellMidY), `vertical centre, sheet ${si + 1} cell ${c.cell} (${c.label.lines.length} lines)`).toBeLessThan(tolC);
          const rows = [];
          for (const w of inside) { const r = rows.find((q) => Math.abs(q.y - w.y0) < 2); if (r) r.words.push(w); else rows.push({ y: w.y0, words: [w] }); }
          for (const r of rows) {
            const mid = (Math.min(...r.words.map((w) => w.x0)) + Math.max(...r.words.map((w) => w.x1))) / 2;
            expect(Math.abs(mid - cellMidX), `horizontal centre, sheet ${si + 1} cell ${c.cell}`).toBeLessThan(tolC);
          }
          seenLineCounts.add(c.label.lines.length);
        }
      });
      const totalWords = pages.reduce((n, p) => n + p.words.length, 0);
      expect(matchedWords).toBe(totalWords); // nothing printed outside a cell
      expect(seenLineCounts.size).toBeGreaterThan(0);
      for (const n of scenario.expectLines || []) expect(seenLineCounts.has(n), `a ${n}-line label was checked`).toBe(true);
    });
  }
});
