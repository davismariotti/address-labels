/* Pure layout: labels + start cell -> sheets of cells with positions in inches. */
(function (root, factory) {
  const ok = typeof module === 'object' && module.exports;
  const deps = ok ? Object.assign({}, require('./geometry.js'), require('./fit.js')) : root.Shared;
  if (ok) module.exports = factory(deps);
  else root.Shared = Object.assign(root.Shared || {}, factory(deps));
})(typeof self !== 'undefined' ? self : this, function (S) {
  const { GEOMETRY, cellToRowCol, cellOrigin, fitLines } = S;

  /**
   * @param {{id?:string, lines:string[]}[]} labels one entry per printed label (copies already expanded)
   * @param {number} startCell 1..30
   * @param {{x:number,y:number}} nudge inches
   * @returns {{sheetCount:number, sheets:Array, flags:{small:Array, nofit:Array}, startCell:number}}
   */
  function layout(labels, startCell = 1, nudge = { x: 0, y: 0 }, g = GEOMETRY) {
    const per = g.cellsPerSheet;
    const start = Math.min(per, Math.max(1, Math.floor(startCell) || 1));
    const total = labels.length;
    const sheetCount = total === 0 ? 0 : Math.ceil((start - 1 + total) / per);
    const fits = labels.map((l) => fitLines(l.lines, g));
    const sheets = [];
    const flags = { small: [], nofit: [] };
    for (let s = 0; s < sheetCount; s++) {
      const cells = [];
      for (let n = 1; n <= per; n++) {
        const idx = s * per + (n - 1) - (start - 1);
        const o = cellOrigin(n, g);
        const { row, col } = cellToRowCol(n);
        const cell = {
          cell: n, row, col,
          x: o.x + nudge.x, y: o.y + nudge.y, w: g.label.w, h: g.label.h,
          state: idx < 0 ? 'skipped' : idx >= total ? 'empty' : 'label',
        };
        if (cell.state === 'label') {
          const label = labels[idx];
          cell.label = { id: label.id, lines: label.lines, pt: fits[idx].pt, fit: fits[idx].status, index: idx };
          if (fits[idx].status === 'small') flags.small.push({ sheet: s + 1, cell: n, id: label.id, lines: label.lines, pt: fits[idx].pt });
          if (fits[idx].status === 'nofit') flags.nofit.push({ sheet: s + 1, cell: n, id: label.id, lines: label.lines, pt: fits[idx].pt });
        }
        cells.push(cell);
      }
      sheets.push({ index: s, cells });
    }
    return { sheetCount, sheets, flags, startCell: start };
  }

  return { layout };
});
