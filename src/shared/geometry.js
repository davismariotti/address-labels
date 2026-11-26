/* Avery 5260 geometry (inches). Shared by main, renderer, and tests (UMD, no DOM).
 *
 * Measured from Avery's official PDF template (test/golden/geometry.json, produced by
 * scripts/measure-avery-template.py): die-cut outlines start 0.5 in from the top and 0.1875 in
 * from the left, column pitch 2.75 in, row pitch 1.0 in, label height 1.0 in, width 2.630 in
 * (nominal 2-5/8 = 2.625, used here). A third-party listing that gave a 0.21975 in side margin
 * is not supported by Avery's file. Printer drift is handled by the alignment nudge and the
 * outlines test page (docs/calibration-checklist.md). 5160 uses the same template.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = Object.assign(root.Shared || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const GEOMETRY = Object.freeze({
    page: Object.freeze({ w: 8.5, h: 11 }),
    cols: 3,
    rows: 10,
    label: Object.freeze({ w: 2.625, h: 1 }),
    pitch: Object.freeze({ x: 2.75, y: 1 }),
    margin: Object.freeze({ top: 0.5, left: 0.1875 }),
    padding: Object.freeze({ x: 0.1, y: 0.08 }),
    lineHeight: 1.15,
    font: Object.freeze({ startPt: 12, floorPt: 7, smallPt: 8, stepPt: 0.5 }),
    cellsPerSheet: 30,
  });

  const NUDGE_LIMIT = 0.25;

  function cellToRowCol(cell) {
    return { row: Math.floor((cell - 1) / GEOMETRY.cols) + 1, col: ((cell - 1) % GEOMETRY.cols) + 1 };
  }

  /** Top-left position of a cell in inches (without nudge). */
  function cellOrigin(cell, g = GEOMETRY) {
    const { row, col } = cellToRowCol(cell);
    return { x: g.margin.left + (col - 1) * g.pitch.x, y: g.margin.top + (row - 1) * g.pitch.y };
  }

  return { GEOMETRY, NUDGE_LIMIT, cellToRowCol, cellOrigin };
});
