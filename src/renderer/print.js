/* Print setup dialog: start cell, live paged preview, warnings, alignment, print / PDF. */
(async function () {
  const $ = (s) => document.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v; else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const { cellToRowCol } = Shared;

  const init = await window.api.printInit();
  let labels = init.payload.labels;
  if (init.payload.projectName) document.title = `Print Labels — ${init.payload.projectName}`;
  const noAddress = init.payload.noAddress || [];
  const held = init.payload.held || [];
  const reprint = init.payload.reprint || [];
  const state = {
    startCell: 1, outlines: false, page: 0,
    nudge: { ...init.settings.nudge },
    hasPrinter: true,
    scope: init.settings.printScope === 'all' ? 'all' : 'sheet', // "This sheet" prints one sheet at a time, for hand-loading
    open: new Set(),         // which warning lists are expanded
  };

  $('#prev').append(icon('chevron-left'));
  $('#next').append(icon('chevron-right'));
  $('#start-dec').append(icon('chevron-down'));
  $('#start-inc').append(icon('chevron-down'));
  $('#start-inc svg').style.transform = 'rotate(180deg)';
  document.querySelector('.chev').append(icon('chevron-down'));
  $('#nudge-x').value = String(state.nudge.x);
  $('#nudge-y').value = String(state.nudge.y);

  let result = null;
  const compute = () => { result = Shared.layout(labels, state.startCell, state.nudge); };

  // ---------- preview ----------
  function renderPreview() {
    const stage = $('#stage');
    const w = stage.clientWidth, hgt = stage.clientHeight;
    const ppi = Math.max(20, Math.min(w / 8.5, hgt / 11));
    const sheet = result.sheets[Math.min(state.page, result.sheets.length - 1)];
    stage.replaceChildren();
    if (!sheet) return;
    const el = renderSheet(sheet, { ppi: `${ppi}px`, outlines: state.outlines, interactive: true, startCell: state.page === 0 ? state.startCell : 0 });
    el.addEventListener('click', (e) => { const c = e.target.closest('.cell'); if (c && state.page === 0) setStart(Number(c.dataset.cell)); });
    el.addEventListener('keydown', (e) => {
      const c = e.target.closest('.cell');
      if (c && (e.key === 'Enter' || e.key === ' ') && state.page === 0) { e.preventDefault(); setStart(Number(c.dataset.cell)); }
    });
    stage.append(el);
  }

  function renderSummary() {
    const total = labels.length;
    $('#topsummary').textContent = `${plural(total, 'label', 'labels')} · ${plural(result.sheetCount, 'sheet', 'sheets')}`;
    const n = result.sheetCount;
    $('#sheetlabel').textContent = n ? `Sheet ${state.page + 1} of ${n}` : 'No sheets';
    $('#prev').setAttribute('aria-disabled', String(state.page <= 0));
    $('#next').setAttribute('aria-disabled', String(state.page >= n - 1));
    const { row, col } = cellToRowCol(state.startCell);
    $('#start-pos').textContent = `Row ${row}, column ${col}`;
    const notes = [];
    if (state.startCell > 1) notes.push(`Cells 1–${state.startCell - 1} of sheet 1 are left empty.`);
    if (state.startCell > 1 && n > 1) notes.push(`Sheet 1 is your partly used sheet. ${n === 2 ? 'Sheet 2 needs a fresh sheet.' : `Sheets 2–${n} need fresh sheets.`}`);
    $('#start-notes').textContent = notes.join(' ');
  }

  function warnItem(key, text, items) {
    const open = state.open.has(key);
    return h('div', { class: 'w' },
      icon('alert-triangle'),
      h('div', { class: 't' }, text,
        open ? h('ul', {}, items.map((i) => h('li', { text: i }))) : null),
      h('button', { class: 'btn link', type: 'button', onclick: () => { if (open) state.open.delete(key); else state.open.add(key); renderWarnings(); } }, open ? 'Hide' : 'Show'));
  }
  function renderWarnings() {
    const host = $('#warnings');
    host.replaceChildren();
    const left = new Set(labels.map((l) => l.lines[0]));
    const reprintLeft = reprint.filter((n) => left.has(n));
    if (reprintLeft.length) host.append(warnItem('reprint', `${plural(reprintLeft.length, 'person was', 'people were')} already printed. Printing them again makes duplicate labels.`, reprintLeft));
    if (held.length) host.append(warnItem('held', `${plural(held.length, 'person is', 'people are')} on hold and won't be printed.`, held));
    const noAddrLeft = noAddress.filter((n) => left.has(n));
    if (noAddrLeft.length) host.append(warnItem('noaddr', `${plural(noAddrLeft.length, 'person has', 'people have')} no address and will print as name only.`, noAddrLeft));
    const small = result.flags.small;
    if (small.length) host.append(warnItem('small', `${plural(small.length, 'label is', 'labels are')} in small text.`, small.map((f) => `${f.lines[0]} (cell ${f.cell}, sheet ${f.sheet}, ${f.pt} pt)`)));
    const nofit = result.flags.nofit;
    if (nofit.length) host.append(warnItem('nofit', `${plural(nofit.length, 'label may', 'labels may')} be hard to read.`, nofit.map((f) => `${f.lines[0]} (cell ${f.cell}, sheet ${f.sheet})`)));
  }

  function renderBanners(msg, opts = {}) {
    const host = $('#banners');
    host.replaceChildren();
    if (!state.hasPrinter) host.append(h('div', { class: 'banner error' }, h('span', { class: 'msg', text: 'No printer found. You can still save a PDF.' })));
    if (msg) host.append(h('div', { class: 'banner' + (opts.error ? ' error' : '') }, h('span', { class: 'msg', text: msg })));
    const pr = $('#print');
    if (!state.hasPrinter) { pr.setAttribute('aria-disabled', 'true'); pr.title = 'No printer found. You can still save a PDF.'; }
    else { pr.removeAttribute('aria-disabled'); pr.title = 'Print (⌘↩)'; }
  }

  function renderAll() { compute(); renderSummary(); renderScope(); renderWarnings(); renderPreview(); }

  // ---------- one sheet at a time ----------
  /** True when a print sends just the previewed sheet (only meaningful when there is more than one sheet). */
  const sheetMode = () => state.scope === 'sheet' && !!result && result.sheetCount > 1;
  /** What a print would send right now: the previewed sheet, or everything. */
  function target() {
    if (sheetMode()) {
      const idx = Math.min(state.page, result.sheets.length - 1);
      const indices = result.sheets[idx].cells.filter((c) => c.state === 'label').map((c) => c.label.index);
      return { partial: true, indices, labels: indices.map((i) => labels[i]), startCell: idx === 0 ? state.startCell : 1, sheetIndex: idx };
    }
    return { partial: false, indices: labels.map((_, i) => i), labels, startCell: state.startCell, sheetIndex: null };
  }
  function renderScope() {
    const many = result.sheetCount > 1;
    $('#scope-section').hidden = !many;
    for (const b of document.querySelectorAll('#scope button')) b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope));
    const t = target();
    const label = $('#print').childNodes[0];
    if (sheetMode()) {
      label.nodeValue = `Print sheet ${state.page + 1}…`;
      const left = labels.length - t.labels.length;
      $('#scope-note').textContent = `Prints sheet ${state.page + 1} of ${result.sheetCount} (${plural(t.labels.length, 'label', 'labels')}). ${plural(left, 'label', 'labels')} left for the next sheets. Load the paper, print, then load the next.`;
    } else {
      label.nodeValue = 'Print…';
      $('#scope-note').textContent = many ? `Prints all ${result.sheetCount} sheets in one job.` : '';
    }
  }
  for (const b of document.querySelectorAll('#scope button')) {
    b.addEventListener('click', () => { state.scope = b.dataset.scope; window.api.updateSettings({ printScope: state.scope }); renderScope(); });
  }

  // ---------- start cell ----------
  function setStart(n) {
    state.startCell = n; state.page = 0;
    $('#start').value = String(n); $('#start-err').hidden = true; $('#start').removeAttribute('aria-invalid');
    renderAll();
  }
  function commitStart() {
    const s = $('#start').value.trim();
    if (/^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 30) return setStart(Number(s));
    $('#start-err').textContent = 'Enter a number from 1 to 30';
    $('#start-err').hidden = false; $('#start').setAttribute('aria-invalid', 'true');
  }
  $('#start').addEventListener('change', commitStart);
  $('#start').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); commitStart(); } });
  $('#start-inc').addEventListener('click', () => setStart(Math.min(30, state.startCell + 1)));
  $('#start-dec').addEventListener('click', () => setStart(Math.max(1, state.startCell - 1)));
  $('#start').addEventListener('focus', (e) => e.target.select());

  $('#outlines').addEventListener('change', (e) => { state.outlines = e.target.checked; renderPreview(); });

  // ---------- paging ----------
  $('#prev').addEventListener('click', () => { if (state.page > 0) { state.page--; renderSummary(); renderScope(); renderPreview(); } });
  $('#next').addEventListener('click', () => { if (state.page < result.sheetCount - 1) { state.page++; renderSummary(); renderScope(); renderPreview(); } });

  // ---------- alignment ----------
  function commitNudge(axis) {
    const input = $(`#nudge-${axis}`);
    const r = Shared.parseNudge(input.value);
    const err = $('#nudge-err');
    if (!r.ok) { err.textContent = r.error; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.value = String(state.nudge[axis]); return; }
    err.hidden = true; input.removeAttribute('aria-invalid');
    state.nudge[axis] = r.value; input.value = String(r.value);
    window.api.updateSettings({ nudge: { [axis]: r.value } });
    renderAll();
  }
  for (const axis of ['x', 'y']) {
    $(`#nudge-${axis}`).addEventListener('change', () => commitNudge(axis));
    $(`#nudge-${axis}`).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitNudge(axis); } });
  }

  // ---------- output ----------
  const jobFor = (t) => ({ labels: t.labels, startCell: t.startCell, nudge: { ...state.nudge }, outlines: state.outlines });
  const jobAll = () => jobFor({ labels, startCell: state.startCell });

  /** After a single sheet printed: drop its labels, keep the dialog open on the next sheet, or close when none are left. */
  function afterSheet(t) {
    const gone = new Set(t.indices);
    labels = labels.filter((_, i) => !gone.has(i));
    if (!labels.length) { window.api.printClose(); return; }
    if (t.sheetIndex === 0) { state.startCell = 1; $('#start').value = '1'; state.page = 0; } // the next sheet is a fresh one
    compute();
    state.page = Math.min(state.page, result.sheetCount - 1);
    renderAll();
    renderBanners(`Printed ${plural(t.labels.length, 'label', 'labels')}. ${plural(labels.length, 'label', 'labels')} left. Load the next sheet and print again.`);
  }

  async function doPrint() {
    if ($('#print').getAttribute('aria-disabled') === 'true') return;
    renderBanners();
    const t = target();
    const r = await window.api.printNative(jobFor(t));
    if (r.ok) { if (t.partial) afterSheet(t); else window.api.printClose(); }
    else if (!r.canceled) renderBanners(r.error || 'Printing failed.', { error: true });
  }
  function reviewPrompt(count) {
    const close = () => $('#overlay').replaceChildren();
    const modal = h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Review labels' },
      h('header', { text: `${plural(count, 'label', 'labels')} may be hard to read` }),
      h('div', { class: 'body' }, h('p', { text: 'The text on these labels does not fit even at the smallest size, so it may run past the edge of the label.' })),
      h('footer', {},
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); doPrint(); } }, 'Print anyway'),
        h('button', { class: 'btn primary', type: 'button', id: 'review-btn', onclick: () => {
          close();
          state.open.add('nofit');
          state.page = flagged()[0].sheet - 1;
          renderSummary(); renderWarnings(); renderPreview();
        } }, 'Review')));
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $('#overlay').replaceChildren(h('div', { class: 'scrim' }, modal));
    $('#review-btn').focus();
  }
  /** Labels that don't fit, limited to the sheet about to print when printing one sheet. */
  const flagged = () => (sheetMode() ? result.flags.nofit.filter((f) => f.sheet === state.page + 1) : result.flags.nofit);
  function requestPrint() {
    if ($('#print').getAttribute('aria-disabled') === 'true') return;
    if (flagged().length) reviewPrompt(flagged().length); else doPrint();
  }
  async function doPdf() {
    renderBanners();
    const r = await window.api.printPdf(jobAll());
    if (r.ok) renderBanners(`Saved ${r.path}`);
    else if (!r.canceled) renderBanners(r.error || 'Could not save the PDF.', { error: true });
  }
  $('#print').addEventListener('click', requestPrint);
  $('#pdf').addEventListener('click', doPdf);
  $('#cancel').addEventListener('click', () => window.api.printClose());

  // ---------- keyboard / menu ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#overlay').children.length) return;
      e.preventDefault(); window.api.printClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); requestPrint(); }
  });
  window.api.onMenu((action) => {
    if (action === 'alignment') { $('#alignment').open = true; $('#nudge-x').focus(); $('#nudge-x').select(); }
    else if (action === 'print') requestPrint();
    else if (action === 'select-all') document.execCommand('selectAll');
  });
  window.addEventListener('blur', () => document.body.classList.add('window-inactive'));
  window.addEventListener('focus', () => document.body.classList.remove('window-inactive'));
  new ResizeObserver(() => { if (result) renderPreview(); }).observe($('#stage'));

  // ---------- go ----------
  const printers = await window.api.printers();
  state.hasPrinter = printers.length > 0;
  renderBanners();
  renderAll();
})();
