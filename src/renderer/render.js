/* Renders one laid-out sheet to DOM. Used by the preview (interactive) and the output (print). */
(function () {
  /**
   * @param sheet  {cells:[...]} from Shared.layout
   * @param opts   {ppi:string, outlines:boolean, interactive:boolean, startCell:number}
   */
  function renderSheet(sheet, opts) {
    const el = document.createElement('div');
    el.className = 'sheet' + (opts.interactive ? ' preview' : '');
    el.style.setProperty('--ppi', opts.ppi);
    for (const c of sheet.cells) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.cell = String(c.cell);
      cell.style.left = `calc(${c.x} * var(--ppi))`;
      cell.style.top = `calc(${c.y} * var(--ppi))`;
      cell.style.width = `calc(${c.w} * var(--ppi))`;
      cell.style.height = `calc(${c.h} * var(--ppi))`;
      if (opts.outlines) cell.classList.add('outlined');
      if (c.state === 'label') {
        cell.style.fontSize = `calc(${c.label.pt / 72} * var(--ppi))`;
        for (const line of c.label.lines) {
          const d = document.createElement('div');
          d.className = 'line';
          d.textContent = line;
          cell.appendChild(d);
        }
        if (opts.interactive) {
          cell.classList.add('label-cell');
          if (c.label.fit === 'nofit') cell.classList.add('flag-nofit');
          if (c.label.fit === 'small') cell.classList.add('flag-small');
          if (c.label.fit !== 'ok') { const b = window.icon('alert-triangle', 'badge'); cell.appendChild(b); }
          cell.title = `Cell ${c.cell} · ${c.label.lines[0]} · ${c.label.pt} pt`;
          cell.setAttribute('aria-label', `Cell ${c.cell}, ${c.label.lines[0]}`);
        }
      } else {
        if (c.state === 'skipped') cell.classList.add('skipped'); else cell.classList.add('empty-cell');
        if (opts.interactive) {
          const n = document.createElement('div');
          n.className = 'num';
          n.textContent = String(c.cell);
          cell.appendChild(n);
          cell.setAttribute('aria-label', c.state === 'skipped' ? `Cell ${c.cell}, skipped` : `Cell ${c.cell}, empty`);
        }
      }
      if (opts.interactive) {
        cell.tabIndex = 0;
        if (c.cell === opts.startCell) cell.classList.add('start');
        cell.setAttribute('role', 'button');
      }
      el.appendChild(cell);
    }
    return el;
  }
  window.renderSheet = renderSheet;
})();
