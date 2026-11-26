/* Modal sheets: person form, New project, Add people, Rename, History. */
(function () {
  const S = Shared;
  const { h, plural, Toast } = UI;
  const st = App.state;

  // ---------- person form ----------
  App.openForm = function openForm(person) {
    const pr = App.project();
    const isNew = !person;
    const base = person || { id: S.makeId(), name: '', address: [], copies: 1 };
    const hasAddr = !!S.currentAddress(base);
    let confirmed = false;
    const name = h('input', { class: 'input', type: 'text', value: base.name, 'aria-label': 'Name', spellcheck: 'false' });
    const lines = h('textarea', { class: 'input', rows: '4', 'aria-label': 'Address lines', placeholder: 'Street\nCity, State ZIP', spellcheck: 'false' });
    lines.value = S.currentLines(base).join('\n');
    const nameErr = h('div', { class: 'field-error', hidden: true });
    const warn = h('div', { class: 'warn-note', hidden: true });
    const mode = { value: 'typo' };
    const modeRow = hasAddr ? h('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'What changed' },
      h('label', {}, h('input', { type: 'radio', name: 'mode', value: 'typo', checked: true, onchange: () => { mode.value = 'typo'; } }), 'Fix a typo'),
      h('label', {}, h('input', { type: 'radio', name: 'mode', value: 'moved', onchange: () => { mode.value = 'moved'; } }), 'They moved')) : null;
    const wasHeld = S.isHeld(base);
    const holdBox = h('input', { class: 'check', type: 'checkbox', id: 'hold-box' });
    holdBox.checked = wasHeld;
    const holdHint = h('div', { class: 'caption', text: 'Saving a new address (They moved) clears the hold.', hidden: !wasHeld });
    holdBox.addEventListener('change', () => { holdHint.hidden = !holdBox.checked; });
    const holdRow = h('label', { class: 'inline' }, holdBox, 'Needs an address update (hold from printing)');
    const alsoAdd = isNew && pr ? h('label', { class: 'inline' }, h('input', { class: 'check', type: 'checkbox', id: 'also-add', checked: true }), `Also add to ${pr.name}`) : null;
    const prev = person ? S.previousAddresses(base) : [];
    const history = prev.length ? h('div', { class: 'field' },
      h('div', { class: 'caption', text: `Previous addresses (${prev.length})` }),
      h('div', { class: 'history' }, prev.map((a) => h('div', { class: 'h' },
        h('span', { class: 'muted', text: S.addressLines(a).join(' · ') }),
        h('button', { class: 'btn', type: 'button', onclick: () => { App.updatePerson(S.useAgain(base, a.version)); UI.closeSheet(); App.focusRow(base.id); } }, 'Use this again'))))) : null;

    function save() {
      nameErr.hidden = true; name.removeAttribute('aria-invalid');
      const nm = S.normText(name.value);
      if (!nm) { nameErr.textContent = 'Name is required'; nameErr.hidden = false; name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
      const ln = S.normLines(lines.value.split('\n'));
      let next = { ...base, name: nm };
      const changed = ln.join('\n') !== S.currentLines(base).join('\n');
      if (changed) {
        if (isNew) next = { ...next, address: ln.length ? [S.makeAddress(ln, 1)] : [] };
        else if (!hasAddr) next = S.fixInPlace(next, ln);
        else if (mode.value === 'moved') next = S.moved(next, ln);
        else next = S.fixInPlace(next, ln);
      }
      // Hold: "They moved" clears it, unless the box was only just ticked in this same edit.
      const movedNow = changed && !isNew && hasAddr && mode.value === 'moved';
      let holdCleared = false;
      if (movedNow && wasHeld && holdBox.checked) { next = S.clearHold(next); holdCleared = true; }
      else if (holdBox.checked) next = wasHeld ? { ...next, hold: base.hold } : S.setHold(next);
      else next = S.clearHold(next);
      const warnings = [];
      if (ln.length > 4) warnings.push('This address has more than 4 lines, so the label may print very small.');
      if (S.findExactDuplicate(st.people, next)) warnings.push('Someone with the same name and address is already in the list.');
      if (warnings.length && !confirmed) {
        confirmed = true; warn.textContent = warnings.join(' '); warn.hidden = false; saveBtn.textContent = 'Save anyway'; return;
      }
      if (isNew) App.setPeople([...st.people, next]); else App.setPeople(st.people.map((p) => (p.id === next.id ? next : p)));
      App.scheduleSave();
      UI.closeSheet();
      if (holdCleared) Toast.show({ message: `Cleared the hold on ${nm}: the address was updated.` });
      if (alsoAdd && alsoAdd.querySelector('input').checked) {
        const r = S.addRecipients(pr, [{ personId: next.id, copies: S.copiesOf(next) }]);
        App.updateProject(r.project);
      } else App.renderAll();
      if (!isNew || (alsoAdd && alsoAdd.querySelector('input') && pr)) App.focusRow(next.id);
      else if (App.isBook()) App.focusRow(next.id);
    }
    const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save');
    const modal = h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Add person' : 'Edit person' },
      h('header', { text: isNew ? 'Add person' : 'Edit person' }),
      h('div', { class: 'body' },
        h('label', { class: 'field' }, 'Name', name, nameErr),
        h('label', { class: 'field' }, hasAddr || isNew ? 'Address' : 'Add address', lines),
        modeRow, holdRow, holdHint, alsoAdd, warn, history),
      h('footer', {},
        isNew ? null : h('button', { class: 'btn danger', type: 'button', style: 'margin-right:auto', onclick: () => { UI.closeSheet(); App.deletePerson(base); } }, 'Delete'),
        h('button', { class: 'btn', type: 'button', onclick: () => { UI.closeSheet(); if (!isNew) App.focusRow(base.id); } }, 'Cancel'),
        saveBtn));
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeSheet(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); save(); }
    });
    UI.openSheet(modal);
    name.focus();
  };

  // ---------- New project ----------
  App.openNewProject = function openNewProject({ fromTicks = false, copyFrom = null } = {}) {
    const sorted = App.sortedProjects();
    let confirmed = false;
    const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Project name', placeholder: 'For example, Christmas 2026', spellcheck: 'false' });
    const err = h('div', { class: 'field-error', hidden: true });
    const warn = h('div', { class: 'warn-note', hidden: true });
    const start = h('select', { class: 'input', 'aria-label': 'Start from' },
      h('option', { value: '' }, 'Empty'), ...sorted.map((p) => h('option', { value: p.id }, `Copy of ${p.name}${S.isArchived(p) ? ' (archived)' : ''}`)));
    if (copyFrom && sorted.some((p) => p.id === copyFrom)) start.value = copyFrom;
    const startField = fromTicks
      ? h('p', { class: 'muted', id: 'from-ticks', text: `Starting with ${plural(st.ticks.size, 'person', 'people')} from the Address book` })
      : h('label', { class: 'field' }, 'Start from', start);

    function create() {
      err.hidden = true; name.removeAttribute('aria-invalid');
      const nm = S.normText(name.value);
      if (!nm) { err.textContent = 'Name is required'; err.hidden = false; name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
      if (S.findDuplicateName(st.projects, nm) && !confirmed) {
        confirmed = true; warn.textContent = 'A project with this name already exists.'; warn.hidden = false; createBtn.textContent = 'Create anyway'; return;
      }
      let proj;
      if (fromTicks) {
        const specs = [...st.ticks].filter((id) => App.byId.has(id)).map((id) => ({ personId: id, copies: S.copiesOf(App.byId.get(id)) }));
        proj = S.addRecipients(S.makeProject(nm), specs).project;
      } else if (start.value) {
        const src = st.projects.find((p) => p.id === start.value);
        if (!src) { err.textContent = 'That project no longer exists'; err.hidden = false; start.value = ''; return; }
        proj = S.copyProject(src, nm);
      } else proj = S.makeProject(nm);
      st.projects = [...st.projects, proj];
      App.scheduleProjectsSave();
      st.ticks.clear();
      UI.closeSheet();
      App.setView(proj.id);
    }
    const createBtn = h('button', { class: 'btn primary', type: 'button', onclick: create }, 'Create');
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New project' },
      h('header', { text: 'New project' }),
      h('div', { class: 'body' }, h('label', { class: 'field' }, 'Name', name, err), startField, warn),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: UI.closeSheet }, 'Cancel'), createBtn));
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeSheet(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); create(); }
    });
    UI.openSheet(modal);
    name.focus();
  };

  // ---------- Rename ----------
  App.openRename = function openRename() {
    const pr = App.project();
    if (!pr) return;
    let confirmed = false;
    const name = h('input', { class: 'input', type: 'text', value: pr.name, 'aria-label': 'Project name', spellcheck: 'false' });
    const err = h('div', { class: 'field-error', hidden: true });
    const warn = h('div', { class: 'warn-note', hidden: true });
    function save() {
      err.hidden = true;
      const nm = S.normText(name.value);
      if (!nm) { err.textContent = 'Name is required'; err.hidden = false; name.focus(); return; }
      if (S.findDuplicateName(st.projects, nm, pr.id) && !confirmed) { confirmed = true; warn.textContent = 'A project with this name already exists.'; warn.hidden = false; btn.textContent = 'Rename anyway'; return; }
      UI.closeSheet();
      App.updateProject(S.rename(pr, nm));
    }
    const btn = h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Rename');
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rename project' },
      h('header', { text: 'Rename project' }), h('div', { class: 'body' }, h('label', { class: 'field' }, 'Name', name, err), warn),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: UI.closeSheet }, 'Cancel'), btn));
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeSheet(); } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); save(); }
    });
    UI.openSheet(modal);
    name.focus(); name.select();
  };

  // ---------- Add people ----------
  App.openAddPeople = function openAddPeople() {
    const pr = App.project();
    if (!pr) return;
    let source = 'book';
    let query = '';
    const picked = new Set();
    const have = new Set(pr.recipients.map((r) => r.personId));
    const others = App.sortedProjects().filter((p) => p.id !== pr.id);
    const sourceSel = h('select', { class: 'input', 'aria-label': 'Source' }, h('option', { value: 'book' }, 'Address book'), ...others.map((p) => h('option', { value: p.id }, p.name + (S.isArchived(p) ? ' (archived)' : ''))));
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search people', 'aria-label': 'Search people', spellcheck: 'false' });
    const list = h('div', { class: 'sheet-list', role: 'list' });
    const addBtn = h('button', { class: 'btn primary', type: 'button', id: 'add-n', onclick: add }, 'Add 0');

    function candidates() {
      let base;
      if (source === 'book') base = st.people.map((person) => ({ person, copies: S.copiesOf(person) }));
      else {
        const src = st.projects.find((p) => p.id === source);
        base = src ? S.visibleRecipients(src, App.byId).map((x) => ({ person: x.person, copies: x.recipient.copies })) : [];
      }
      return base.filter((c) => S.matchesQuery(c.person, query));
    }
    function render() {
      const cands = candidates();
      list.replaceChildren(...(cands.length ? cands.map(({ person }) => {
        const inProject = have.has(person.id);
        const cb = h('input', { class: 'check', type: 'checkbox', 'aria-label': `Add ${person.name}`, disabled: inProject });
        cb.checked = picked.has(person.id);
        cb.addEventListener('change', () => { if (cb.checked) picked.add(person.id); else picked.delete(person.id); updateAddBtn(); });
        return h('div', { class: 'pick-row' + (inProject ? ' disabled' : ''), role: 'listitem', 'data-id': person.id },
          cb, h('span', { class: 'grow', text: person.name }), h('span', { class: 'caption', text: inProject ? 'In project' : S.addressSummary(person) }));
      }) : [h('div', { class: 'pick-row' }, h('span', { class: 'muted', text: 'No one to show.' }))]));
      updateAddBtn();
    }
    function updateAddBtn() {
      addBtn.textContent = `Add ${picked.size}`;
      if (picked.size) addBtn.removeAttribute('aria-disabled'); else addBtn.setAttribute('aria-disabled', 'true');
    }
    function setShown(on) {
      for (const { person } of candidates()) { if (have.has(person.id)) continue; if (on) picked.add(person.id); else picked.delete(person.id); }
      render();
    }
    function add() {
      if (!picked.size) return;
      // candidates() is filtered by search, so look copies up from the whole source
      const full = source === 'book' ? new Map(st.people.map((p) => [p.id, S.copiesOf(p)]))
        : new Map(S.visibleRecipients(st.projects.find((p) => p.id === source) || { recipients: [] }, App.byId).map((x) => [x.person.id, x.recipient.copies]));
      const specs = [...picked].map((id) => ({ personId: id, copies: full.get(id) || 1 }));
      const r = S.addRecipients(pr, specs);
      UI.closeSheet();
      App.updateProject(r.project);
      App.toastAdded(pr, r.added.length, r.skipped);
    }
    sourceSel.addEventListener('change', () => { source = sourceSel.value; picked.clear(); render(); });
    search.addEventListener('input', () => { query = search.value; render(); });
    const modal = h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add people' },
      h('header', { text: `Add people to ${pr.name}` }),
      h('div', { class: 'body' },
        h('label', { class: 'field' }, 'Source', sourceSel), search,
        h('div', { class: 'split' }, h('button', { class: 'btn', type: 'button', onclick: () => setShown(true) }, 'Select all shown'), h('button', { class: 'btn', type: 'button', onclick: () => setShown(false) }, 'Select none')),
        list),
      h('footer', {},
        h('button', { class: 'btn', id: 'new-person', type: 'button', style: 'margin-right:auto', onclick: () => { UI.closeSheet(); App.openForm(null); } }, 'New person…'),
        h('button', { class: 'btn', type: 'button', onclick: UI.closeSheet }, 'Cancel'), addBtn));
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeSheet(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') { e.preventDefault(); add(); }
    });
    UI.openSheet(modal);
    render();
    search.focus();
  };

  // ---------- History ----------
  const KIND = { print: 'Printed', pdf: 'PDF saved', marked: 'Marked as printed', unmarked: 'Needs a label again' };
  App.openHistory = function openHistory(focusRunId) {
    const first = App.project();
    if (!first) return;
    const pid = first.id;
    const expanded = new Set(focusRunId ? [focusRunId] : []);
    const ticks = new Set(); // `${runId}|${personId}`
    const body = h('div', { class: 'body' });
    const undoBtn = h('button', { class: 'btn primary', type: 'button', id: 'didnt', onclick: applyDidnt }, "Didn't come out (0)");
    const closeBtn = h('button', { class: 'btn', type: 'button', onclick: UI.closeSheet }, 'Close');
    const cur = () => st.projects.find((p) => p.id === pid);

    function applyDidnt() {
      if (!ticks.size) return;
      const groups = new Map();
      for (const key of ticks) { const [runId, personId] = key.split('|'); (groups.get(runId) || groups.set(runId, []).get(runId)).push(personId); }
      let next = cur();
      for (const [runId, ids] of groups) next = S.undoEntries(next, runId, ids);
      const total = ticks.size;
      const restore = [...groups];
      App.updateProject(next);
      App.undoToast(`Updated ${plural(total, 'person', 'people')}.`, () => {
        App.mutate(pid, (c) => restore.reduce((acc, [runId, ids]) => S.restoreEntries(acc, runId, ids), c));
        refresh();
      });
      ticks.clear();
      refresh();
    }

    function refresh() {
      const pr = cur();
      if (!pr) { UI.closeSheet(); return; }
      const ro = S.isArchived(pr);
      const status = S.deriveStatus(pr, S.viewMap(pr, App.byId));
      undoBtn.hidden = ro;
      const runs = pr.runs.map((r, i) => ({ r, i })).sort((a, b) => (a.r.at < b.r.at ? 1 : a.r.at > b.r.at ? -1 : b.i - a.i)).map((x) => x.r);
      body.replaceChildren();
      if (!runs.length) body.append(h('div', { class: 'empty' }, h('h2', { text: 'Nothing printed yet' }), h('p', { text: 'Prints and manual marks for this project will be listed here.' })));
      for (const run of runs) {
        const stats = S.runStats(run);
        const open = expanded.has(run.id);
        const info = [];
        if (run.kind === 'print' || run.kind === 'pdf') {
          info.push(stats.inEffect !== stats.recorded && !run.undoneAt ? `${stats.recorded} recorded · ${stats.inEffect} in effect` : `${plural(stats.recorded, 'label', 'labels')}`);
          if (run.sheetCount) info.push(plural(run.sheetCount, 'sheet', 'sheets'));
          if (run.startCell) info.push(`start cell ${run.startCell}`);
        }
        info.push(plural(stats.people, 'person', 'people'));
        const head = h('div', { class: 'run-head' },
          h('button', { class: 'btn icon-only', type: 'button', 'aria-expanded': String(open), 'aria-label': open ? 'Hide people' : 'Show people', onclick: () => { if (open) expanded.delete(run.id); else expanded.add(run.id); refresh(); } }, window.icon(open ? 'chevron-down' : 'chevron-right')),
          h('div', { class: 'grow' }, h('div', { class: 'title', text: `${KIND[run.kind]} · ${S.longDate(run.at)}` }), h('div', { class: 'caption', text: info.join(' · ') })),
          run.kind === 'pdf' || ro ? null : (run.undoneAt
            ? h('button', { class: 'btn', type: 'button', onclick: () => { App.updateProject(S.restoreRun(cur(), run.id)); refresh(); } }, 'Restore')
            : h('button', { class: 'btn', type: 'button', onclick: () => { App.updateProject(S.undoRun(cur(), run.id)); refresh(); } }, 'Undo run')));
        const node = h('div', { class: 'run' + (run.undoneAt ? ' undone' : ''), 'data-run': run.id }, head);
        if (open) {
          node.append(h('div', { class: 'run-people' }, run.entries.map((e, idx) => {
            const key = `${run.id}|${e.personId}`;
            const gone = !!e.undoneAt;
            const cb = h('input', { class: 'check', type: 'checkbox', 'aria-label': `${e.name}`, disabled: gone || !!run.undoneAt || run.kind === 'pdf' || ro });
            cb.checked = ticks.has(key);
            cb.addEventListener('change', () => { if (cb.checked) ticks.add(key); else ticks.delete(key); undoBtn.textContent = `Didn't come out (${ticks.size})`; undoBtn.setAttribute('aria-disabled', String(!ticks.size)); });
            const res = gone ? h('span', { class: 'res' }, ` Didn't come out · ${S.resultLine(status.get(e.personId))}`) : null;
            return h('div', { class: 'entry' + (gone ? ' undone' : ''), 'data-person': e.personId },
              cb,
              h('div', { class: 'grow' }, h('div', {}, h('span', { class: 'nm', text: e.name }), e.copies > 1 ? ` ×${e.copies}` : '', res), h('div', { class: 'caption', text: e.lines.join(' · ') || 'No address' })),
              gone && !ro ? h('button', { class: 'btn', type: 'button', onclick: () => { App.updateProject(S.restoreEntries(cur(), run.id, [e.personId])); refresh(); } }, 'Restore') : null);
          })));
        }
        body.append(node);
      }
      undoBtn.textContent = `Didn't come out (${ticks.size})`;
      if (ticks.size) undoBtn.removeAttribute('aria-disabled'); else undoBtn.setAttribute('aria-disabled', 'true');
    }

    const modal = h('div', { class: 'modal wide history', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'History' },
      h('header', { text: `History · ${first.name}` }), body, h('footer', {}, undoBtn, closeBtn));
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeSheet(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.type !== 'checkbox') { e.preventDefault(); if (ticks.size) applyDidnt(); else UI.closeSheet(); }
    });
    UI.openSheet(modal);
    refresh();
    const firstBox = modal.querySelector('.entry input.check:not([disabled])');
    (focusRunId && firstBox ? firstBox : closeBtn).focus();
  };
})();
