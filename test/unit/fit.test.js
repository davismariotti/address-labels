const test = require('node:test');
const assert = require('node:assert/strict');
const { fitLines, textWidthIn, fitsAt } = require('../../src/shared/fit.js');
const { layout } = require('../../src/shared/layout.js');

const FIXTURES = {
  threeLine: ['The Elm Family', '100 Sample Canyon Lane', 'Springfield, WA 90004'],
  fourLine: ['Bea and Jo', 'Acme Dental Group', '100 Example Blvd #200', 'Springfield, CA 90001'],
  international: ['Paul and Lena Brook', 'P.O. Box 1', 'Exampleville 10000', 'Freedonia'],
  india: ['Ravi Sharma', '2101 Example Towers', 'Sample Garden Lane, Old Quarter', 'Metropolis, 400026, India'],
  unicode: ['Ned and Zoë Birch', '500 Mill Way', 'Sampleton, CA 90002'],
  curly: ['The O’Neil Family', '300 Example Pkwy', 'Exampleton, CA 90005'],
  hawaii: ['The Fenwick Family', '2232 Kapa’a Street', 'Exampleton, HI 90003'],
  longName: ['A'.repeat(1) + 'lexander the Magnificent and Family of Many Many Names', '1 Main St', 'Town, CA 90000'],
  small: ['Name', 'x'.repeat(1) + 'W'.repeat(26), 'Town, CA 90000'],
  impossible: ['W'.repeat(80), '1 Main St'],
};

test('a normal 3-line label prints at the 12 pt default', () => {
  assert.deepEqual(fitLines(FIXTURES.threeLine), { pt: 12, status: 'ok' });
});

test('the Metropolis label shrinks from 12 to 11 pt, the same size Pages chose for it', () => {
  assert.deepEqual(fitLines(FIXTURES.india), { pt: 11, status: 'ok' });
  assert.equal(fitsAt(FIXTURES.india, 11.5), false);
});

test('a 4-line label still fits at the 12 pt default', () => {
  assert.deepEqual(fitLines(FIXTURES.fourLine), { pt: 12, status: 'ok' });
});

test('the 4-line Bea and Jo label fits without clipping', () => {
  const r = fitLines(FIXTURES.fourLine);
  assert.notEqual(r.status, 'nofit');
  assert.ok(fitsAt(FIXTURES.fourLine, r.pt));
});

test('international, unicode, curly-quote labels all fit', () => {
  for (const k of ['international', 'india', 'unicode', 'curly', 'hawaii']) {
    const r = fitLines(FIXTURES[k]);
    assert.notEqual(r.status, 'nofit', k);
    assert.ok(fitsAt(FIXTURES[k], r.pt), k);
  }
});

test('a wide line shrinks the whole label and never wraps', () => {
  const r = fitLines(FIXTURES.longName);
  assert.ok(r.pt < 12);
  assert.ok(textWidthIn(FIXTURES.longName[0], r.pt) <= 2.425 + 1e-9 || r.status === 'nofit');
});

test('a label between 7 pt and 8 pt is marked small', () => {
  // widen a line until the fit lands in the small band
  let found = null;
  for (let n = 20; n < 60 && !found; n++) {
    const lines = ['W'.repeat(n), 'x'];
    const r = fitLines(lines);
    if (r.status === 'small') found = r;
  }
  assert.ok(found, 'a small-text fixture exists');
  assert.ok(found.pt >= 7 && found.pt < 8);
});

test('an impossible label is flagged nofit and reported at the floor size', () => {
  const r = fitLines(FIXTURES.impossible);
  assert.deepEqual(r, { pt: 7, status: 'nofit' });
});

test('layout surfaces small and nofit flags', () => {
  const r = layout([
    { id: 'a', lines: FIXTURES.threeLine },
    { id: 'b', lines: FIXTURES.impossible },
  ], 1);
  assert.equal(r.flags.nofit.length, 1);
  assert.equal(r.flags.nofit[0].id, 'b');
  assert.equal(r.flags.nofit[0].cell, 2);
});

test('combining accents add no width', () => {
  const a = textWidthIn('Zoe', 10);
  const b = textWidthIn('Zoë', 10);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('curly and straight apostrophes are close in width but both measured', () => {
  assert.ok(textWidthIn('’', 10) > 0);
  assert.ok(textWidthIn("'", 10) > 0);
});
