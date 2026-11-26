const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GEOMETRY, cellToRowCol, cellOrigin } = require('../../src/shared/geometry.js');
const { layout } = require('../../src/shared/layout.js');

const labels = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, lines: ['Name ' + i, '1 Main St', 'Town, CA 90000'] }));

test('geometry matches the golden file within 0.001 in', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '../golden/geometry.json'), 'utf8'));
  assert.equal(golden.cells.length, 30);
  for (const c of golden.cells) {
    const o = cellOrigin(c.cell);
    assert.ok(Math.abs(o.x - c.x) < 0.001, `cell ${c.cell} x`);
    assert.ok(Math.abs(o.y - c.y) < 0.001, `cell ${c.cell} y`);
    const rc = cellToRowCol(c.cell);
    assert.equal(rc.row, c.row);
    assert.equal(rc.col, c.col);
  }
  // The die-cut outline measures 2.630 in wide (nominal 2-5/8 = 2.625); height is exactly 1.0 in.
  assert.ok(Math.abs(GEOMETRY.label.w - golden.label.w) < 0.006, `label width ${golden.label.w}`);
  assert.equal(GEOMETRY.label.h, golden.label.h);
});

test('cell numbering: 1 top-left, 3 top-right, 4 starts row 2, 30 bottom-right', () => {
  assert.deepEqual(cellToRowCol(1), { row: 1, col: 1 });
  assert.deepEqual(cellToRowCol(3), { row: 1, col: 3 });
  assert.deepEqual(cellToRowCol(4), { row: 2, col: 1 });
  assert.deepEqual(cellToRowCol(30), { row: 10, col: 3 });
});

test('cell 14 is row 5, column 2', () => {
  assert.deepEqual(cellToRowCol(14), { row: 5, col: 2 });
});

test('start cell 1 fills from the first cell', () => {
  const r = layout(labels(5), 1);
  assert.equal(r.sheetCount, 1);
  assert.equal(r.sheets[0].cells[0].state, 'label');
  assert.equal(r.sheets[0].cells[4].state, 'label');
  assert.equal(r.sheets[0].cells[5].state, 'empty');
});

test('start cell 14 with 20 labels: cells 1-13 skipped, 14-30 hold labels 1-17, 3 spill to sheet 2', () => {
  const r = layout(labels(20), 14);
  assert.equal(r.sheetCount, 2);
  for (let n = 1; n <= 13; n++) assert.equal(r.sheets[0].cells[n - 1].state, 'skipped');
  assert.equal(r.sheets[0].cells[13].label.index, 0);
  assert.equal(r.sheets[0].cells[29].label.index, 16);
  assert.equal(r.sheets[1].cells[0].label.index, 17);
  assert.equal(r.sheets[1].cells[2].label.index, 19);
  assert.equal(r.sheets[1].cells[3].state, 'empty');
  assert.ok(r.sheets[1].cells.every((c) => c.state !== 'skipped'), 'later sheets start at cell 1');
});

test('start cell 30 puts one label in the last cell', () => {
  const r = layout(labels(1), 30);
  assert.equal(r.sheetCount, 1);
  assert.equal(r.sheets[0].cells[29].state, 'label');
});

test('sheet counts for 0, 1, 30, 31, 70 labels', () => {
  assert.equal(layout(labels(0), 1).sheetCount, 0);
  assert.equal(layout(labels(1), 1).sheetCount, 1);
  assert.equal(layout(labels(30), 1).sheetCount, 1);
  assert.equal(layout(labels(31), 1).sheetCount, 2);
  const r = layout(labels(70), 1);
  assert.equal(r.sheetCount, 3);
  assert.equal(r.sheets[2].cells.filter((c) => c.state === 'label').length, 10);
});

test('nudge shifts every cell', () => {
  const a = layout(labels(1), 1, { x: 0, y: 0 }).sheets[0].cells[0];
  const b = layout(labels(1), 1, { x: 0.03, y: -0.02 }).sheets[0].cells[0];
  assert.ok(Math.abs(b.x - a.x - 0.03) < 1e-9);
  assert.ok(Math.abs(b.y - a.y + 0.02) < 1e-9);
});

test('invalid start cell is clamped into 1..30', () => {
  assert.equal(layout(labels(1), 0).startCell, 1);
  assert.equal(layout(labels(1), 99).startCell, 30);
});

test('name-only labels lay out and fit', () => {
  const r = layout([{ id: 'n', lines: ['Pip'] }], 1);
  assert.equal(r.sheets[0].cells[0].label.fit, 'ok');
  assert.equal(r.sheets[0].cells[0].label.pt, 12);
});
