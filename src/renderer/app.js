/* Main window core: state, views (Address book / projects / archived projects), rows, selection, holds,
   recording prints, undo. */
(function () {
  const S = Shared;
  const { h, plural, Toast } = UI;
  const $ = (s) => document.querySelector(s);

  // ---------- state ----------
  const state = {
    people: [], byId: new Map(), projects: [], view: 'book',
    query: '', filter: 'all', ticks: new Set(), focusedId: null,
    status: 'ok', error: null, skipped: [],           // addresses.json
    pstatus: 'ok', perror: null, pskipped: [],         // projects.json
    legacyFound: false, saveError: null, psaveError: null, unrecorded: null,
    notice: null, migrationNotice: null, migrationError: null, dismissed: new Set(),
    undoStack: [], lastPrint: null, menuKey: '',
  };
  const App = { state };
  window.App = App;

  // ---------- lookups ----------
  function setPeople(list) { state.people = S.sortPeople(list); state.byId = S.peopleMap(state.people); }
  const sortedProjects = () => S.sortProjects(state.projects);
  const activeProjects = () => sortedProjects().filter((p) => !S.isArchived(p));
  const archivedProjects = () => sortedProjects().filter((p) => S.isArchived(p));
  const project = () => state.projects.find((p) => p.id === state.view) || null;
  const isBook = () => !project();
  const archivedView = () => S.isArchived(project());
  /** An archived project looks people up in its frozen snapshot; everything else uses the live address book. */
  const byIdFor = (pr) => S.viewMap(pr, state.byId);
  let statusCache = null;
  const statusMap = () => (statusCache || (statusCache = S.deriveStatus(project(), byIdFor(project()))));
  const selectedIds = (pr) => S.visibleRecipients(pr, byIdFor(pr)).filter((x) => x.recipient.selected).map((x) => x.person.id);
  Object.assign(App, { project, sortedProjects, activeProjects, archivedProjects, statusMap, selectedIds, isBook, setPeople, byIdFor });
  Object.defineProperty(App, 'byId', { get: () => state.byId });

  // ---------- persistence ----------
  let saveTimer = null;
  let psaveTimer = null;
  const syncUnsaved = () => window.api.setUnsaved({ people: state.saveError ? state.people : null, projects: state.psaveError ? state.projects : null });
  const updateTitle = () => { document.title = state.saveError || state.psaveError ? 'Address Labels — Edited' : 'Address Labels'; };
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 250); }
  async function flushSave() {
    clearTimeout(saveTimer);
    if (state.status === 'corrupt' || state.status === 'readonly') return;
    const r = await window.api.savePeople(state.people);
    state.saveError = r.ok ? null : r.error;
    if (state.status === 'missing' && r.ok) state.status = 'ok';
    syncUnsaved(); updateTitle(); renderBanners();
  }
  function scheduleProjectsSave() { clearTimeout(psaveTimer); psaveTimer = setTimeout(flushProjectsSave, 250); }
  async function flushProjectsSave() {
    clearTimeout(psaveTimer);
    if (state.pstatus === 'corrupt' || state.pstatus === 'readonly') return;
    const r = await window.api.saveProjects(state.projects);
    state.psaveError = r.ok ? null : r.error;
    if (r.ok) state.unrecorded = null;
    if (state.pstatus === 'missing' && r.ok) state.pstatus = 'ok';
    syncUnsaved(); updateTitle(); renderBanners();
  }
  Object.assign(App, { scheduleSave, scheduleProjectsSave });

  function updateProject(next) {
    state.projects = state.projects.map((p) => (p.id === next.id ? next : p));
    scheduleProjectsSave();
    renderAll();
  }
  /** Apply a change to the current copy of a project (safe inside undo closures). */
  function mutate(projectId, fn) {
    const pr = state.projects.find((p) => p.id === projectId);
    if (pr) updateProject(fn(pr));
  }
  Object.assign(App, { updateProject, mutate });

  /** Replace one person (edit / use-this-again / hold) and refresh everything that shows them. */
  App.updatePerson = (next) => { setPeople(state.people.map((p) => (p.id === next.id ? next : p))); scheduleSave(); renderAll(); };

  // ---------- toasts with undo ----------
  function undoToast(message, undo, extra = []) {
    Toast.show({ message, undo, actions: [{ label: 'Undo', run: undo }, ...extra] });
  }
  App.undoToast = undoToast;

  // ---------- views ----------
  function setView(view, { persist = true } = {}) {
    state.view = view === 'book' || state.projects.some((p) => p.id === view) ? view : 'book';
    state.query = ''; state.filter = 'all'; state.ticks.clear(); state.focusedId = null; state.lastPrint = null;
    $('#search').value = '';
    if (persist) window.api.updateSettings({ activeView: state.view });
    renderAll();
    const first = document.querySelector('.row');
    if (first) { state.focusedId = first.dataset.id; }
  }
  App.setView = setView;

  // ---------- filtering ----------
  const anyHeld = () => {
    const pr = project();
    return pr ? S.heldRecipients(pr, byIdFor(pr)).length > 0 : state.people.some(S.isHeld);
  };
  function filterDefs() {
    const pr = project();
    let defs;
    if (!pr) defs = [['all', 'All'], ['ticked', 'Ticked']];
    else if (S.isArchived(pr)) defs = [['all', 'All'], ['needs', 'Needs printing'], ['printed', 'Printed']];
    else defs = [['all', 'All'], ['selected', 'Selected'], ['needs', 'Needs printing'], ['printed', 'Printed']];
    if (anyHeld() && !S.isArchived(pr)) defs.push(['hold', 'On hold']);
    return defs;
  }
  const filtering = () => state.query.trim() !== '' || state.filter !== 'all';

  function shownRows() {
    const pr = project();
    if (!pr) {
      return state.people
        .filter((p) => S.matchesQuery(p, state.query)
          && (state.filter !== 'ticked' || state.ticks.has(p.id))
          && (state.filter !== 'hold' || S.isHeld(p)))
        .map((person) => ({ person }));
    }
    const st = statusMap();
    return S.visibleRecipients(pr, byIdFor(pr))
      .filter(({ person, recipient }) => {
        if (!S.matchesQuery(person, state.query)) return false;
        const s = st.get(person.id);
        if (state.filter === 'selected') return recipient.selected;
        if (state.filter === 'needs') return S.groupOf(s.state) === 'needs';
        if (state.filter === 'printed') return s.state === 'printed';
        if (state.filter === 'hold') return S.isHeld(person);
        return true;
      })
      .map(({ person, recipient }) => ({ person, recipient, status: st.get(person.id) }));
  }

  // ---------- rendering ----------
  function renderAll() {
    statusCache = null;
    renderSidebar(); renderBanners(); renderToolbar(); renderList(); renderFooter();
    const names = activeProjects().map((p) => p.name);
    const key = JSON.stringify(names);
    if (key !== state.menuKey) { state.menuKey = key; window.api.setProjectMenu(names); }
  }
  App.renderAll = renderAll;

  function renderSidebar() {
    const host = $('#side-items');
    host.replaceChildren();
    const item = (view, label, count, iconName, tip, cls = '') => h('button', {
      class: 'side-item ' + cls, type: 'button', 'data-view': view, title: tip || null,
      'aria-current': state.view === view || (view === 'book' && isBook()) ? 'page' : null,
      onclick: () => (view === '__new' ? App.openNewProject() : setView(view)),
    }, window.icon(iconName), h('span', { class: 'label', text: label }), count == null ? null : h('span', { class: 'count num', text: String(count) }));
    const countOf = (p) => S.visibleRecipients(p, byIdFor(p)).length;
    host.append(item('book', 'Address book', state.people.length, 'users', '⌘1'));
    host.append(h('div', { class: 'side-heading', text: 'Projects' }));
    if (state.pstatus === 'corrupt') { host.append(h('div', { class: 'side-note warn', text: 'Projects unavailable' })); return; }
    const active = activeProjects();
    if (!active.length) host.append(h('div', { class: 'side-note', text: 'No projects yet' }));
    active.forEach((p, i) => host.append(item(p.id, p.name, countOf(p), 'folder', i < 8 ? `${p.name} (⌘${i + 2})` : p.name)));
    host.append(item('__new', 'New project', null, 'plus', '⇧⌘N', 'add'));
    const archived = archivedProjects();
    if (archived.length) {
      host.append(h('div', { class: 'side-heading', text: 'Archived' }));
      archived.forEach((p) => host.append(item(p.id, p.name, countOf(p), 'archive', `${p.name} (archived ${S.shortDate(p.archivedAt)})`, 'archived')));
    }
  }

  function renderToolbar() {
    const pr = project();
    const book = !pr;
    const archived = S.isArchived(pr);
    const list = shownRows();
    const defs = filterDefs();
    if (!defs.some(([v]) => v === state.filter)) state.filter = 'all';
    $('#filters').replaceChildren(...defs.map(([v, label]) => h('button', {
      type: 'button', 'data-filter': v, 'aria-pressed': String(state.filter === v),
      onclick: () => { state.filter = v; renderAll(); },
    }, label)));
    const readyN = pr && !archived ? list.filter(isEligible).length : list.length;
    $('#select-all').textContent = filtering() ? `Select all ${readyN} shown` : 'Select all';
    $('#select-all').title = pr && !archived ? 'Skips people on hold and people already printed. Tick those by hand if you want them.' : '';
    $('#select-none').textContent = filtering() ? `Select none of ${list.length} shown` : 'Select none';
    $('#select-all').hidden = archived; $('#select-none').hidden = archived;
    $('#project-tools').hidden = book;
    $('#add').hidden = archived;
    $('#add-label').textContent = book ? 'Add person' : 'Add people…';
  }

  function renderBanners() {
    const host = $('#banners');
    host.replaceChildren();
    const add = (msg, opts = {}) => host.append(
      h('div', { class: 'banner' + (opts.error ? ' error' : '') + (opts.neutral ? ' neutral' : '') },
        h('span', { class: 'msg', text: msg }),
        (opts.actions || []).map((a) => h('button', { class: 'btn', type: 'button', onclick: a.run, text: a.label })),
        opts.dismiss ? h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Dismiss', onclick: () => { state.dismissed.add(opts.dismiss); renderBanners(); } }, window.icon('x')) : null));
    const pr = project();
    if (S.isArchived(pr)) {
      add(`Archived on ${S.longDate(pr.archivedAt)}. This project is read-only and shows names and addresses as they were then.`, {
        neutral: true, actions: [{ label: 'Unarchive', run: () => unarchive(pr) }, { label: 'Copy to new project…', run: () => App.openNewProject({ copyFrom: pr.id }) }],
      });
    }
    if (state.status === 'readonly') add(state.error, { error: true });
    if (state.saveError) add(state.saveError, { error: true, actions: [{ label: 'Retry', run: flushSave }, { label: 'Export a copy…', run: () => window.api.exportCopy(state.people) }] });
    if (state.skipped.length && !state.dismissed.has('skipped')) {
      add(`${plural(state.skipped.length, 'entry', 'entries')} in addresses.json could not be read and ${state.skipped.length === 1 ? 'was' : 'were'} left untouched (entry ${state.skipped.map((s) => s.index + 1).join(', ')}).`, { dismiss: 'skipped' });
    }
    if (state.notice && !state.dismissed.has('notice')) add(state.notice, { dismiss: 'notice' });
    // projects
    if (state.pstatus === 'corrupt' && !state.dismissed.has('pcorrupt')) {
      add(`projects.json could not be read: ${state.perror} Your projects have not been changed.`, {
        error: true, dismiss: 'pcorrupt',
        actions: [{ label: 'Restore latest backup', run: restoreProjectsLatest }, { label: 'Open folder in Finder', run: () => window.api.showDataFolder() }],
      });
    }
    if (state.pskipped.length && !state.dismissed.has('pskipped')) {
      add(`${plural(state.pskipped.length, 'project', 'projects')} in projects.json could not be read and ${state.pskipped.length === 1 ? 'was' : 'were'} left untouched (entry ${state.pskipped.map((s) => s.index + 1).join(', ')}).`, { dismiss: 'pskipped' });
    }
    if (state.psaveError) {
      add(state.unrecorded ? `The print was sent but could not be recorded in ${state.unrecorded}.` : state.psaveError, {
        error: true,
        actions: [{ label: 'Retry', run: flushProjectsSave }, { label: 'Export a copy…', run: () => window.api.exportCopy({ addresses: state.people, projects: { version: 1, projects: state.projects } }) }],
      });
    }
    if (state.migrationError) add(state.migrationError, { error: true, dismiss: 'merr' });
    if (state.migrationNotice && !state.dismissed.has('mnotice')) add(state.migrationNotice, { dismiss: 'mnotice' });
  }

  function addressNode(p) {
    return S.currentLines(p).length ? h('span', { class: 'addr', text: S.addressSummary(p) })
      : h('span', { class: 'addr warn' }, window.icon('alert-triangle'), 'No address');
  }

  function holdChip(person, st) {
    const before = st && st.state !== 'not-printed' ? ` Last printed ${S.shortDate(st.at)}.` : '';
    return h('span', { class: 'chip hold', title: `Needs an address update. Not printed until the hold is cleared.${before}` }, window.icon('pause'), 'On hold');
  }
  function chipFor(st, person) {
    if (S.isHeld(person)) return holdChip(person, st);
    if (st.state === 'printed') {
      return h('span', { class: 'chip printed', title: `Printed ${S.longDate(st.at)} · ${plural(st.labels, 'label', 'labels')} in total` }, window.icon('check-circle'), `Printed ${S.shortDate(st.at)}`);
    }
    if (st.state === 'changed') {
      return h('span', { class: 'chip changed', title: `Address changed since printing on ${S.shortDate(st.at)}. The printed label has the old address.` }, window.icon('alert-triangle'), 'Address changed');
    }
    return h('span', { class: 'chip', title: 'Not printed' }, window.icon('circle'), 'Not printed');
  }

  function buildRow({ person: p, recipient, status }) {
    const pr = project();
    const archived = S.isArchived(pr);
    const held = S.isHeld(p);
    const checked = pr ? recipient.selected && !archived : state.ticks.has(p.id);
    const row = h('div', {
      class: 'row' + (checked ? ' checked' : '') + (held ? ' held' : '') + (archived ? ' readonly' : ''),
      role: 'listitem', 'data-id': p.id, tabindex: p.id === state.focusedId ? '0' : '-1',
    });
    const parts = [];
    if (!archived) {
      const cb = h('input', { type: 'checkbox', class: 'check', 'aria-label': pr ? `Include ${p.name}` : `Tick ${p.name}` });
      cb.checked = checked;
      cb.addEventListener('change', () => toggle(p.id, cb.checked));
      parts.push(cb);
    }
    parts.push(h('div', { class: 'who' }, h('span', { class: 'name', text: p.name }), addressNode(p)));
    if (pr) {
      const copies = recipient.copies;
      parts.push(chipFor(status, p));
      if (copies > 1) parts.push(h('span', { class: 'badge-copies num', text: `×${copies}` }));
      if (!archived) {
        const input = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': `Copies for ${p.name}`, value: String(copies) });
        const setCopies = (v) => {
          const n = S.clampCopies(v, copies);
          if (n === copies) { input.value = String(n); return; }
          // Re-render after the event finishes: replacing the row inside a blur/change handler throws.
          setTimeout(() => mutate(pr.id, (cur) => S.setCopies(cur, p.id, n)), 0);
        };
        input.addEventListener('change', () => setCopies(input.value));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setCopies(input.value); e.stopPropagation(); } });
        parts.push(h('span', { class: 'copies num' + (copies > 1 ? ' multi' : '') },
          h('button', { type: 'button', 'aria-label': `Fewer copies for ${p.name}`, onclick: () => setCopies(copies - 1) }, '−'), input,
          h('button', { type: 'button', 'aria-label': `More copies for ${p.name}`, onclick: () => setCopies(copies + 1) }, '+')));
      }
    } else if (held) {
      parts.push(holdChip(p, null)); // the Address book shows the chip only for people on hold
    }
    if (!archived) parts.push(h('button', { class: 'btn icon-only edit', type: 'button', 'aria-label': `Edit ${p.name}`, title: 'Edit', onclick: () => App.openForm(p) }, window.icon('pencil')));
    row.append(...parts);
    if (!archived) {
      row.addEventListener('dblclick', (e) => { if (!e.target.closest('input,button')) App.openForm(p); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); state.focusedId = p.id; rowMenu(p, { x: e.clientX, y: e.clientY }); });
    }
    row.addEventListener('click', () => { state.focusedId = p.id; });
    return row;
  }

  function renderList() {
    const host = $('#list');
    const rows = shownRows();
    const pr = project();
    host.replaceChildren();
    host.setAttribute('aria-label', pr ? `${pr.name} recipients` : 'People');
    const empty = (iconName, title, text, ...actions) => host.append(h('div', { class: 'empty' },
      window.icon(iconName, 'icon-lg'), h('h2', { text: title }), h('p', { text }), h('div', { class: 'actions' }, ...actions)));
    if (!pr && !state.people.length) {
      empty('users', 'No addresses yet', 'Add the first person to start building your card list.',
        h('button', { class: 'btn primary', type: 'button', onclick: () => App.openForm(null) }, 'Add person'),
        state.legacyFound ? h('button', { class: 'btn', type: 'button', onclick: importLegacy }, 'Import addresses.json…') : null);
      return;
    }
    if (pr && !S.visibleRecipients(pr, byIdFor(pr)).length) {
      empty('folder', 'Nobody in this project yet', S.isArchived(pr) ? 'This archived project has no recipients.' : 'Add people from your address book, or from another project.',
        S.isArchived(pr) ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => App.openAddPeople() }, 'Add people'));
      return;
    }
    if (!rows.length) {
      const q = state.query.trim();
      empty('search', q ? `No matches for “${q}”` : 'Nothing to show', state.filter === 'selected' || state.filter === 'ticked' ? 'No one is selected yet.' : 'Try a different search or filter.',
        h('button', { class: 'btn', type: 'button', onclick: clearFilters }, 'Clear'));
      return;
    }
    if (!rows.some((r) => r.person.id === state.focusedId)) state.focusedId = rows[0].person.id;
    for (const r of rows) host.append(buildRow(r));
  }

  function lastPrintLine() {
    const pr = project();
    const lp = state.lastPrint;
    if (!pr || !lp || lp.projectId !== pr.id) return null;
    const run = pr.runs.find((r) => r.id === lp.runId);
    if (!run || run.undoneAt) return null;
    const time = new Date(lp.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return h('span', { class: 'caption last-print' }, `Last print: ${plural(lp.labels, 'label', 'labels')}, ${time} · `,
      h('button', { class: 'btn link', type: 'button', onclick: () => App.openHistory(lp.runId) }, 'Review…'));
  }

  function renderFooter() {
    const sum = $('#summary');
    const acts = $('#footer-actions');
    sum.replaceChildren(); acts.replaceChildren();
    const pr = project();
    if (!pr) {
      const n = state.ticks.size;
      sum.append(h('span', { class: 'num', text: n ? `${n} ticked` : `Nothing ticked · ${plural(state.people.length, 'person', 'people')}` }),
        h('span', { class: 'caption hidden-note', text: 'To print, open a project.' }));
      const none = n === 0;
      acts.append(
        h('button', { class: 'btn', id: 'add-to-project', type: 'button', 'aria-disabled': none ? 'true' : null, title: none ? 'Tick people first' : null, onclick: (e) => { if (!none) addToProjectMenu(e.currentTarget); } }, 'Add to project…'),
        h('button', { class: 'btn primary', id: 'new-from-selection', type: 'button', 'aria-disabled': none ? 'true' : null, title: none ? 'Tick people first' : null, onclick: () => { if (!none) App.openNewProject({ fromTicks: true }); } }, 'New project from selection…'));
      return;
    }
    if (S.isArchived(pr)) {
      sum.append(h('span', { class: 'num', text: `${plural(S.visibleRecipients(pr, byIdFor(pr)).length, 'person', 'people')} · archived ${S.shortDate(pr.archivedAt)}` }));
      return;
    }
    const byId = byIdFor(pr);
    const labels = S.printableLabels(pr, byId);
    const selIds = selectedIds(pr);
    const heldSel = S.selectedHeld(pr, byId).length;
    const printablePeople = selIds.length - heldSel;
    const shownIds = new Set(shownRows().map((r) => r.person.id));
    const hidden = selIds.filter((id) => !shownIds.has(id)).length;
    const btn = h('button', { class: 'btn primary', id: 'print', type: 'button', onclick: () => { if (!labels.length) return; openPrint(); } }, 'Print Labels…');
    if (!selIds.length) {
      sum.append(h('span', { text: `No one selected · ${plural(S.visibleRecipients(pr, byId).length, 'person', 'people')}` }));
      btn.setAttribute('aria-disabled', 'true'); btn.title = 'Select at least one person';
    } else if (!labels.length) {
      sum.append(h('span', { text: 'Everyone selected is on hold' }));
      btn.setAttribute('aria-disabled', 'true'); btn.title = 'Everyone selected is on hold';
    } else {
      const extra = labels.length - printablePeople;
      const sheets = Shared.layout(labels, 1).sheetCount;
      sum.append(h('span', { class: 'num', text:
        `${plural(printablePeople, 'person', 'people')} · ${plural(labels.length, 'label', 'labels')}` +
        `${extra ? ` (${plural(extra, 'extra copy', 'extra copies')})` : ''} · ${plural(sheets, 'sheet', 'sheets')}` }));
      btn.title = 'Print Labels (⌘P)';
    }
    if (heldSel) {
      sum.append(h('span', { class: 'caption hidden-note held-note' }, `${plural(heldSel, 'selected person is', 'selected people are')} on hold and won't be printed · `,
        h('button', { class: 'btn link', type: 'button', onclick: () => { state.filter = 'hold'; renderAll(); } }, 'Show')));
    }
    if (hidden) {
      sum.append(h('span', { class: 'caption hidden-note' }, `${plural(hidden, 'selected person is', 'selected people are')} hidden by the filter · `,
        h('button', { class: 'btn link', type: 'button', onclick: clearSelection }, 'Clear')));
    }
    const lp = lastPrintLine();
    if (lp) sum.append(lp);
    acts.append(btn);
  }

  // ---------- selection ----------
  function toggle(id, on) {
    const pr = project();
    if (pr) {
      state.projects = state.projects.map((p) => (p.id === pr.id ? S.setSelected(p, [id], on) : p));
      scheduleProjectsSave();
    } else if (on) state.ticks.add(id); else state.ticks.delete(id);
    statusCache = null;
    const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    if (row) row.classList.toggle('checked', on);
    renderFooter();
    if (state.filter !== 'all') { renderToolbar(); renderList(); }
  }
  /** Select all only picks people who are ready to print: not on hold and not already printed. Ticks made by hand stay. */
  const isEligible = (r) => !S.isHeld(r.person) && r.status && r.status.state !== 'printed';
  function selectShown(on) {
    if (archivedView()) return;
    const rows = shownRows();
    const pr = project();
    if (pr && on) {
      const eligible = rows.filter(isEligible);
      // Only count people who stay unselected: anyone ticked by hand keeps their tick and isn't "skipped".
      const left = rows.filter((r) => !isEligible(r) && !r.recipient.selected);
      const heldN = left.filter((r) => S.isHeld(r.person)).length;
      const printedN = left.filter((r) => !S.isHeld(r.person)).length;
      state.projects = state.projects.map((p) => (p.id === pr.id ? S.setSelected(p, eligible.map((r) => r.person.id), true) : p));
      scheduleProjectsSave();
      renderAll();
      const skipped = [heldN ? `${heldN} on hold` : null, printedN ? `${printedN} already printed` : null].filter(Boolean);
      if (skipped.length) Toast.show({ message: `Selected ${plural(eligible.length, 'person', 'people')}. Skipped ${skipped.join(' and ')}.` });
      return;
    }
    const ids = rows.map((r) => r.person.id);
    if (pr) {
      state.projects = state.projects.map((p) => (p.id === pr.id ? S.setSelected(p, ids, on) : p));
      scheduleProjectsSave();
    } else for (const id of ids) { if (on) state.ticks.add(id); else state.ticks.delete(id); }
    renderAll();
  }
  function clearSelection() {
    const pr = project();
    if (pr) updateProject(S.setSelection(pr, [])); else { state.ticks.clear(); renderAll(); }
  }
  function clearFilters() { state.query = ''; state.filter = 'all'; $('#search').value = ''; renderAll(); }
  Object.assign(App, { selectShown, clearSelection });

  function focusRow(id) {
    state.focusedId = id;
    const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    if (row) { row.scrollIntoView({ block: 'nearest' }); row.focus(); }
  }
  App.focusRow = focusRow;

  // ---------- project actions ----------
  function addToProjectMenu(anchor) {
    const items = activeProjects().map((p) => ({ label: p.name, run: () => addTicksTo(p.id) }));
    if (items.length) items.push({ separator: true });
    items.push({ label: 'New project…', run: () => App.openNewProject({ fromTicks: true }) });
    UI.showMenu(items, anchor);
  }
  function addTicksTo(projectId) {
    const pr = state.projects.find((p) => p.id === projectId);
    if (!pr) return;
    const specs = [...state.ticks].filter((id) => state.byId.has(id)).map((id) => ({ personId: id, copies: S.copiesOf(state.byId.get(id)) }));
    const r = S.addRecipients(pr, specs);
    state.ticks.clear();
    updateProject(r.project);
    const msg = `Added ${plural(r.added.length, 'person', 'people')} to ${pr.name}.` + (r.skipped ? ` ${r.skipped} ${r.skipped === 1 ? 'was' : 'were'} already in it.` : '');
    Toast.show({ message: msg, actions: [{ label: 'Show', run: () => setView(pr.id) }] });
  }
  App.toastAdded = (pr, added, skipped) => {
    const msg = `Added ${plural(added, 'person', 'people')} to ${pr.name}.` + (skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already in it.` : '');
    Toast.show({ message: msg });
  };

  function removeFromProject(ids) {
    const pr = project();
    if (!pr || S.isArchived(pr) || !ids.length) return;
    const removed = pr.recipients.filter((r) => ids.includes(r.personId));
    const rows = shownRows().map((r) => r.person.id);
    const next = rows[rows.indexOf(ids[0]) + 1] || rows[rows.indexOf(ids[0]) - 1] || null;
    updateProject(S.removeRecipients(pr, ids));
    const who = ids.length === 1 ? (state.byId.get(ids[0]) || { name: 'person' }).name : plural(ids.length, 'person', 'people');
    undoToast(`Removed ${who} from ${pr.name}.`, () => mutate(pr.id, (cur) => ({ ...cur, recipients: [...cur.recipients, ...removed] })));
    if (next && next !== ids[0]) setTimeout(() => focusRow(next), 0);
  }
  function removeSelected() { const pr = project(); if (pr) removeFromProject(selectedIds(pr)); }

  function markSelected(kind) {
    const pr = project();
    if (!pr || S.isArchived(pr)) return;
    const ids = selectedIds(pr);
    if (!ids.length) return;
    const run = S.makeMarkRun(kind, ids, state.byId);
    updateProject(S.appendRun(pr, run));
    undoToast(`Updated ${plural(ids.length, 'person', 'people')}.`, () => mutate(pr.id, (cur) => S.undoRun(cur, run.id)));
  }

  /** Per-entry undo ("Didn't come out") for specific people in a run. Used by History and the row menu. */
  function didntComeOut(projectId, runId, personIds) {
    const before = state.projects.find((p) => p.id === projectId);
    if (!before) return;
    mutate(projectId, (cur) => S.undoEntries(cur, runId, personIds));
    const undo = () => mutate(projectId, (cur) => S.restoreEntries(cur, runId, personIds));
    const after = state.projects.find((p) => p.id === projectId);
    const st = S.deriveStatus(after, state.byId);
    const lines = personIds.map((id) => `${(state.byId.get(id) || { name: '' }).name}: ${S.resultLine(st.get(id))}`).slice(0, 1);
    undoToast(personIds.length === 1 ? `Updated 1 person. ${lines[0]}` : `Updated ${personIds.length} people.`, undo);
    return undo;
  }
  App.didntComeOut = didntComeOut;

  /** Mark a single person as printed (or as needing a label again) from the row menu. */
  function markOne(personId, kind) {
    const pr = project();
    if (!pr || S.isArchived(pr)) return;
    const run = S.makeMarkRun(kind, [personId], state.byId);
    updateProject(S.appendRun(pr, run));
    const name = (state.byId.get(personId) || { name: 'person' }).name;
    undoToast(kind === 'marked' ? `Marked ${name} as printed.` : `${name} needs a label again.`, () => mutate(pr.id, (cur) => S.undoRun(cur, run.id)));
  }

  // ---------- hold: "needs an address update" ----------
  function putOnHold(person) {
    const before = person;
    App.updatePerson(S.setHold(person));
    undoToast(`Put ${person.name} on hold.`, () => App.updatePerson(before));
  }
  function clearHoldOn(person) {
    const before = person;
    App.updatePerson(S.clearHold(person));
    undoToast(`Cleared the hold on ${person.name}.`, () => App.updatePerson(before));
  }
  Object.assign(App, { putOnHold, clearHoldOn });

  function rowMenu(person, at) {
    const pr = project();
    const items = [{ label: 'Edit…', run: () => App.openForm(person) }];
    items.push(S.isHeld(person)
      ? { label: 'Clear address-update hold', run: () => clearHoldOn(person) }
      : { label: 'Needs an address update', run: () => putOnHold(person) });
    if (pr) {
      const printed = statusMap().get(person.id);
      items.push(printed && printed.state === 'printed'
        ? { label: 'Needs a label again', run: () => markOne(person.id, 'unmarked') }
        : { label: 'Mark as printed', run: () => markOne(person.id, 'marked') });
      items.push({ label: 'Remove from project', run: () => removeFromProject([person.id]) });
      const hit = S.lastPrintEntry(pr, person.id);
      if (hit) { items.push({ separator: true }); items.push({ label: "Didn't come out (last print)", run: () => didntComeOut(pr.id, hit.run.id, [person.id]) }); }
    }
    UI.showMenu(items, at);
  }

  function projectMenuItems() {
    const pr = project();
    if (S.isArchived(pr)) {
      return [
        { label: 'Copy to new project…', run: () => App.openNewProject({ copyFrom: pr.id }) },
        { label: 'Unarchive', run: () => unarchive(pr) },
        { separator: true },
        { label: 'Rename project…', run: () => App.openRename() },
        { label: 'Delete project', danger: true, run: () => deleteProject() },
      ];
    }
    const byId = byIdFor(pr);
    const none = selectedIds(pr).length === 0;
    const needSel = { disabled: none, title: none ? 'Select people first' : null };
    return [
      { label: 'Add people…', run: () => App.openAddPeople() },
      { label: 'New person…', run: () => App.openForm(null) },
      { label: 'Select needs printing', run: () => updateProject(S.selectNeedsPrinting(pr, byId)) },
      { label: 'Select not yet printed', run: () => updateProject(S.selectNotYetPrinted(pr, byId)) },
      { label: 'Select changed addresses', run: () => updateProject(S.selectChanged(pr, byId)) },
      { separator: true },
      { label: 'I printed these myself', ...needSel, run: () => markSelected('marked') },
      { label: 'Needs a label again', ...needSel, run: () => markSelected('unmarked') },
      { separator: true },
      { label: 'Remove selected from project…', ...needSel, run: removeSelected },
      { label: 'Rename project…', run: () => App.openRename() },
      { label: 'Archive project', run: () => archive(pr) },
      { label: 'Delete project', danger: true, run: () => deleteProject() },
    ];
  }

  function archive(pr) {
    updateProject(S.archiveProject(pr, state.byId));
    undoToast(`Archived ${pr.name}.`, () => mutate(pr.id, () => pr));
  }
  function unarchive(pr) {
    updateProject(S.unarchiveProject(pr));
    undoToast(`Unarchived ${pr.name}.`, () => mutate(pr.id, () => pr));
  }

  function deleteProject() {
    const pr = project();
    if (!pr) return;
    const doIt = () => {
      state.projects = state.projects.filter((p) => p.id !== pr.id);
      scheduleProjectsSave();
      setView('book');
      undoToast(`Deleted ${pr.name}.`, () => { state.projects = [...state.projects, pr]; scheduleProjectsSave(); setView(pr.id); });
    };
    if (!pr.runs.length) { doIt(); return; }
    const modal = h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Delete project' },
      h('header', { text: `Delete ${pr.name} and its print history?` }),
      h('div', { class: 'body' }, h('p', { text: 'You can undo this for a few seconds afterwards.' })),
      h('footer', {},
        h('button', { class: 'btn', type: 'button', onclick: UI.closeSheet }, 'Cancel'),
        h('button', { class: 'btn danger', id: 'confirm-delete', type: 'button', onclick: () => { UI.closeSheet(); doIt(); } }, 'Delete')));
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); UI.closeSheet(); } });
    UI.openSheet(modal);
    modal.querySelector('.btn').focus();
  }

  // ---------- print ----------
  function openPrint() {
    const pr = project();
    if (!pr || S.isArchived(pr)) return;
    const byId = byIdFor(pr);
    const labels = S.printableLabels(pr, byId);
    if (!labels.length) return;
    const held = S.selectedHeld(pr, byId).map((x) => x.person.name);
    const noAddress = selectedIds(pr).map((id) => byId.get(id)).filter((p) => !S.isHeld(p) && !S.currentLines(p).length).map((p) => p.name);
    const st = statusMap();
    const reprint = selectedIds(pr).filter((id) => !S.isHeld(byId.get(id)) && st.get(id) && st.get(id).state === 'printed').map((id) => byId.get(id).name);
    window.api.openPrint({ labels, noAddress, held, reprint, projectId: pr.id, projectName: pr.name });
  }
  App.openPrint = openPrint;

  function onPrintCompleted(d) {
    const pr = state.projects.find((p) => p.id === d.projectId);
    if (!pr || S.isArchived(pr)) return;
    const run = S.makeRun({ kind: d.kind, at: d.at, startCell: d.startCell, sheetCount: d.sheetCount, entries: d.entries });
    state.unrecorded = pr.name;
    updateProject(S.appendRun(pr, run));
    if (d.kind !== 'print') return; // a saved PDF is logged but changes no status
    const labels = d.entries.reduce((n, e) => n + e.copies, 0);
    state.lastPrint = { projectId: pr.id, runId: run.id, labels, at: d.at };
    const undo = () => { mutate(pr.id, (cur) => S.undoRun(cur, run.id)); };
    undoToast(`Sent ${plural(labels, 'label', 'labels')} to the printer. ${plural(d.entries.length, 'person', 'people')} marked as printed.`, undo,
      [{ label: 'Details…', run: () => App.openHistory(run.id) }]);
    renderFooter();
  }

  // ---------- people: delete, import, restore ----------
  function deletePerson(p) {
    setPeople(state.people.filter((x) => x.id !== p.id));
    state.ticks.delete(p.id);
    scheduleSave(); renderAll();
    let done = false;
    const undo = () => {
      if (done) return;
      done = true;
      setPeople([...state.people, p]);
      scheduleSave(); renderAll(); focusRow(p.id);
    };
    state.undoStack.push(undo);
    undoToast(`Deleted ${p.name}.`, undo);
  }
  App.deletePerson = deletePerson;

  async function importLegacy() {
    const r = await window.api.importLegacy();
    if (r.ok) { state.legacyFound = false; applyPeopleLoaded(r); renderAll(); } else Toast.show({ message: r.error || 'Import failed.' });
  }
  async function restoreProjectsLatest() {
    const r = await window.api.restoreBackup(undefined, 'projects');
    if (r.ok) { applyProjectsLoaded(r); renderAll(); Toast.show({ message: `Restored ${r.name}.` }); } else Toast.show({ message: r.error });
  }
  async function restoreFromMenu() {
    const which = await window.api.chooseRestoreFile();
    if (!which) return;
    const list = await window.api.listBackups(which);
    if (!list.length) { Toast.show({ message: 'There are no backups yet.' }); return; }
    const name = await window.api.chooseBackup(list.map((b) => b.name));
    if (!name) return;
    const r = await window.api.restoreBackup(name, which);
    if (!r.ok) { Toast.show({ message: r.error }); return; }
    if (which === 'projects') applyProjectsLoaded(r); else applyPeopleLoaded(r);
    renderAll(); Toast.show({ message: `Restored ${r.name}.` });
  }

  function applyPeopleLoaded(r) {
    state.status = r.status; state.error = r.error || null; state.skipped = r.skipped || [];
    setPeople(r.people || []);
  }
  function applyProjectsLoaded(r) {
    state.pstatus = r.status; state.perror = r.error || null; state.pskipped = r.skipped || [];
    state.projects = r.projects || [];
    if (r.status === 'ok') state.dismissed.delete('pcorrupt');
  }
  Object.assign(App, { applyPeopleLoaded, applyProjectsLoaded });

  function showCorrupt() {
    const modal = h('div', { class: 'modal wide', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Address file problem' },
      h('header', { text: 'Your address file could not be read' }),
      h('div', { class: 'body' }, h('p', { text: 'addresses.json is damaged. The app has not changed it.' }), h('p', { class: 'muted', text: state.error || '' })),
      h('footer', {},
        h('button', { class: 'btn', type: 'button', onclick: () => window.api.quit() }, 'Quit'),
        h('button', { class: 'btn', type: 'button', onclick: () => window.api.showDataFolder() }, 'Open folder in Finder'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const r = await window.api.restoreBackup();
          if (r.ok) { applyPeopleLoaded(r); UI.closeSheet(); renderAll(); Toast.show({ message: `Restored backup ${r.name}.` }); }
          else modal.querySelector('.body').append(h('p', { class: 'field-error', text: r.error }));
        } }, 'Restore latest backup')));
    UI.openSheet(modal);
  }

  // ---------- keyboard and menu ----------
  function onListKey(e) {
    const rows = [...document.querySelectorAll('.row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    const id = rows[i].dataset.id;
    const pr = project();
    const ro = S.isArchived(pr);
    if (e.key === 'ArrowDown' && rows[i + 1]) { e.preventDefault(); focusRow(rows[i + 1].dataset.id); }
    else if (e.key === 'ArrowUp' && rows[i - 1]) { e.preventDefault(); focusRow(rows[i - 1].dataset.id); }
    else if (ro) return;
    else if (e.key === ' ') {
      e.preventDefault();
      const on = pr ? !pr.recipients.find((r) => r.personId === id).selected : !state.ticks.has(id);
      toggle(id, on); rows[i].querySelector('input.check').checked = on;
    } else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); const r = rows[i].getBoundingClientRect(); rowMenu(state.byId.get(id), { x: r.left + 40, y: r.bottom }); }
    else if (e.key === 'Enter') { e.preventDefault(); App.openForm(state.byId.get(id)); }
    else if (e.key === 'ContextMenu') { e.preventDefault(); const r = rows[i].getBoundingClientRect(); rowMenu(state.byId.get(id), { x: r.left + 40, y: r.bottom }); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && pr && !e.target.matches('input[type=text]')) { e.preventDefault(); removeFromProject([id]); }
  }

  function onMenu(action) {
    const inField = ['INPUT', 'TEXTAREA'].includes((document.activeElement || {}).tagName);
    if (action.startsWith('view:project:')) { const p = activeProjects()[Number(action.split(':')[2])]; if (p) setView(p.id); return; }
    switch (action) {
      case 'new-person': App.openForm(null); break;
      case 'new-project': App.openNewProject(); break;
      case 'add-people': if (project() && !archivedView()) App.openAddPeople(); break;
      case 'history': if (project()) App.openHistory(); break;
      case 'view:book': setView('book'); $('#list').querySelector('.row')?.focus(); break;
      case 'print': case 'save-pdf': openPrint(); break;
      case 'undo': if (!Toast.undo()) { const f = state.undoStack.pop(); if (f) f(); } break;
      case 'redo': break;
      case 'find': $('#search').focus(); $('#search').select(); break;
      case 'select-all': if (inField) document.execCommand('selectAll'); else selectShown(true); break;
      case 'restore-backup': restoreFromMenu(); break;
      default: break;
    }
  }

  // ---------- init ----------
  async function init() {
    $('#search-icon').replaceWith(window.icon('search'));
    $('#add-icon').replaceWith(window.icon('plus'));
    $('#history-icon').replaceWith(window.icon('history'));
    $('#more-icon').replaceWith(window.icon('more-horizontal'));
    $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderToolbar(); renderList(); renderFooter(); });
    $('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; state.query = ''; renderAll(); } });
    $('#select-all').addEventListener('click', () => selectShown(true));
    $('#select-none').addEventListener('click', () => selectShown(false));
    $('#add').addEventListener('click', () => (isBook() ? App.openForm(null) : App.openAddPeople()));
    $('#history-btn').addEventListener('click', () => App.openHistory());
    $('#more-btn').addEventListener('click', (e) => { if (project()) UI.showMenu(projectMenuItems(), e.currentTarget, { alignRight: true }); });
    $('#list').addEventListener('keydown', onListKey);
    window.api.onMenu(onMenu);
    window.api.onPrintCompleted(onPrintCompleted);
    window.addEventListener('blur', () => document.body.classList.add('window-inactive'));
    window.addEventListener('focus', () => document.body.classList.remove('window-inactive'));
    window.addEventListener('error', (e) => { window.api.logError(`${e.message} @ ${e.filename}:${e.lineno}`); Toast.show({ message: 'Something went wrong.', actions: [{ label: 'Show log', run: () => window.api.openLog() }] }); });
    window.addEventListener('unhandledrejection', (e) => { window.api.logError(String((e.reason && e.reason.stack) || e.reason)); Toast.show({ message: 'Something went wrong.', actions: [{ label: 'Show log', run: () => window.api.openLog() }] }); });

    const r = await window.api.init();
    state.legacyFound = !!r.legacyFound;
    applyPeopleLoaded(r);
    applyProjectsLoaded(r.projects);
    state.notice = (r.settings && r.settings.notice) || null;
    if (r.migrated) state.migrationNotice = `Your checked list is now a project called ${r.migrated}.`;
    if (r.migrationError) state.migrationError = r.migrationError;
    const want = r.settings && r.settings.activeView;
    state.view = want && state.projects.some((p) => p.id === want) ? want : 'book';
    renderAll();
    if (state.status === 'corrupt') showCorrupt();
  }
  App.init = init;
})();
