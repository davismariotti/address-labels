/* Projects and print tracking. Pure functions (UMD), no DOM and no I/O.
 * Everything is immutable: functions return new projects. Status is always derived from runs. */
(function (root, factory) {
  const D = typeof module === 'object' && module.exports ? require('./data.js') : root.Shared;
  if (typeof module === 'object' && module.exports) module.exports = factory(D);
  else root.Shared = Object.assign(root.Shared || {}, factory(D));
})(typeof self !== 'undefined' ? self : this, function (D) {
  const { normText, currentLines, comparePeople, clampCopies, copiesOf, makeId } = D;

  const MIGRATED_NAME = 'Checked list (migrated)';
  const nowIso = () => new Date().toISOString();
  const peopleMap = (people) => new Map(people.map((p) => [p.id, p]));

  // ---------- projects ----------
  function makeProject(name, now = nowIso()) {
    return { id: makeId(), name: normText(name), createdAt: now, recipients: [], runs: [] };
  }
  function sortProjects(projects) {
    return [...projects].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  }
  function findDuplicateName(projects, name, exceptId) {
    const n = normText(name).toLowerCase();
    return projects.find((p) => p.id !== exceptId && p.name.toLowerCase() === n) || null;
  }
  function rename(project, name) { return { ...project, name: normText(name) }; }

  /** specs: [{personId, copies}]. New recipients are selected; existing ones are skipped. */
  function addRecipients(project, specs) {
    const have = new Set(project.recipients.map((r) => r.personId));
    const added = [];
    let skipped = 0;
    const recipients = [...project.recipients];
    for (const s of specs) {
      if (have.has(s.personId)) { skipped++; continue; }
      have.add(s.personId);
      added.push(s.personId);
      recipients.push({ personId: s.personId, copies: clampCopies(s.copies, 1), selected: true });
    }
    return { project: { ...project, recipients }, added, skipped };
  }
  function removeRecipients(project, ids) {
    const gone = new Set(ids);
    return { ...project, recipients: project.recipients.filter((r) => !gone.has(r.personId)) };
  }
  function setCopies(project, personId, value) {
    return { ...project, recipients: project.recipients.map((r) => (r.personId === personId ? { ...r, copies: clampCopies(value, r.copies) } : r)) };
  }
  function setSelected(project, ids, on) {
    const set = new Set(ids);
    return { ...project, recipients: project.recipients.map((r) => (set.has(r.personId) ? { ...r, selected: !!on } : r)) };
  }
  /** Selection becomes exactly `ids`. */
  function setSelection(project, ids) {
    const set = new Set(ids);
    return { ...project, recipients: project.recipients.map((r) => ({ ...r, selected: set.has(r.personId) })) };
  }
  /** Copy recipients and copies, everyone selected, no runs. */
  function copyProject(src, name, now = nowIso()) {
    return {
      id: makeId(), name: normText(name), createdAt: now, runs: [],
      recipients: src.recipients.map((r) => ({ personId: r.personId, copies: r.copies, selected: true })),
    };
  }

  /** Recipients whose person exists, with the person attached, sorted by name. */
  function visibleRecipients(project, byId) {
    return project.recipients
      .map((r) => ({ recipient: r, person: byId.get(r.personId) }))
      .filter((x) => x.person)
      .sort((a, b) => comparePeople(a.person, b.person));
  }
  /** One label per copy for selected visible recipients, in list order. */
  function printableLabels(project, byId) {
    const out = [];
    for (const { recipient, person } of visibleRecipients(project, byId)) {
      if (!recipient.selected || D.isHeld(person)) continue; // held people are never printed
      const lines = [normText(person.name), ...currentLines(person).map(normText)].filter(Boolean);
      for (let i = 0; i < recipient.copies; i++) out.push({ id: person.id, lines });
    }
    return out;
  }
  /** Archived projects keep their snapshot, so they are never pruned. */
  function pruneOrphans(projects, personIds) {
    const ids = new Set(personIds);
    return projects.map((p) => (isArchived(p) ? p : { ...p, recipients: p.recipients.filter((r) => ids.has(r.personId)) }));
  }

  // ---------- hold ----------
  /** Visible recipients whose person is on hold. */
  const heldRecipients = (project, byId) => visibleRecipients(project, byId).filter((x) => D.isHeld(x.person));
  /** Selected, visible, and on hold: skipped when printing. */
  const selectedHeld = (project, byId) => heldRecipients(project, byId).filter((x) => x.recipient.selected);

  // ---------- archive: a frozen copy of each recipient's name and address ----------
  const isArchived = (p) => !!(p && p.archivedAt);
  /** Freeze the project: store each visible recipient's name and address lines (and address version) as they are now. */
  function archiveProject(project, byId, at = nowIso()) {
    const snapshot = visibleRecipients(project, byId).map(({ person }) => {
      const cur = D.currentAddress(person);
      return { personId: person.id, name: normText(person.name), lines: currentLines(person).map(normText), version: cur ? cur.version : null };
    });
    return { ...project, archivedAt: at, snapshot };
  }
  function unarchiveProject(project) {
    const { snapshot, ...rest } = project;
    return { ...rest, archivedAt: null };
  }
  /** Person-shaped objects built from the snapshot, so the normal row code can show an archived project. */
  function snapshotPeople(project) {
    return new Map((project.snapshot || []).map((s) => [s.personId, {
      id: s.personId, name: s.name, address: s.lines.length ? [D.makeAddress(s.lines, s.version || 1)] : [],
    }]));
  }
  /** The people to look up for this project: its frozen snapshot if archived, otherwise the live address book. */
  const viewMap = (project, byId) => (isArchived(project) ? snapshotPeople(project) : byId);

  // ---------- runs ----------
  /** Group expanded labels into history entries. lines = address lines only (the name is separate). */
  function entriesFromLabels(labels) {
    const map = new Map();
    for (const l of labels) {
      const e = map.get(l.id);
      if (e) e.copies++;
      else map.set(l.id, { personId: l.id, name: l.lines[0], copies: 1, lines: l.lines.slice(1) });
    }
    return [...map.values()];
  }
  function makeRun({ kind, at = nowIso(), startCell = null, sheetCount = null, entries }) {
    return {
      id: makeId(), at, kind, startCell, sheetCount, undoneAt: null,
      entries: entries.map((e) => ({ personId: e.personId, name: e.name, copies: e.copies, lines: [...e.lines], undoneAt: null })),
    };
  }
  /** A manual mark: `marked` (I printed these myself) or `unmarked` (Needs a label again). */
  function makeMarkRun(kind, personIds, byId, at = nowIso()) {
    const entries = personIds.filter((id) => byId.has(id)).map((id) => {
      const p = byId.get(id);
      return { personId: id, name: normText(p.name), copies: 0, lines: currentLines(p).map(normText) };
    });
    return makeRun({ kind, at, entries });
  }
  const appendRun = (project, run) => ({ ...project, runs: [...project.runs, run] });

  const inEffect = (run, entry) => !run.undoneAt && !entry.undoneAt;
  const sameLines = (a, b) => a.length === b.length && a.every((l, i) => normText(l) === normText(b[i]));

  /** Fold in-effect entries in time order into a status per person. */
  function foldHistory(project) {
    const items = [];
    project.runs.forEach((run, ri) => run.entries.forEach((entry) => { if (inEffect(run, entry)) items.push({ run, entry, ri }); }));
    items.sort((a, b) => (a.run.at < b.run.at ? -1 : a.run.at > b.run.at ? 1 : a.ri - b.ri));
    const state = new Map();
    for (const { run, entry } of items) {
      if (run.kind === 'pdf') continue;
      const s = state.get(entry.personId) || { printed: false, at: null, lines: [], labels: 0, runId: null };
      if (run.kind === 'print') { s.printed = true; s.at = run.at; s.lines = entry.lines; s.labels += entry.copies; s.runId = run.id; }
      else if (run.kind === 'marked') { s.printed = true; s.at = run.at; s.lines = entry.lines; s.runId = run.id; }
      else if (run.kind === 'unmarked') { s.printed = false; s.runId = run.id; }
      state.set(entry.personId, s);
    }
    return state;
  }
  /** Map personId -> {state:'not-printed'|'printed'|'changed', at, labels, lines, runId} for visible recipients. */
  function deriveStatus(project, byId) {
    const folded = foldHistory(project);
    const out = new Map();
    for (const r of project.recipients) {
      const person = byId.get(r.personId);
      if (!person) continue;
      const s = folded.get(r.personId);
      if (!s || !s.printed) { out.set(r.personId, { state: 'not-printed', at: null, labels: s ? s.labels : 0, lines: [], runId: s ? s.runId : null }); continue; }
      const same = sameLines(s.lines, currentLines(person));
      out.set(r.personId, { state: same ? 'printed' : 'changed', at: s.at, labels: s.labels, lines: s.lines, runId: s.runId });
    }
    return out;
  }
  const groupOf = (state) => (state === 'printed' ? 'printed' : 'needs');

  // ---------- selection by status ----------
  function idsByState(project, byId, states) {
    const st = deriveStatus(project, byId);
    return visibleRecipients(project, byId).filter((x) => !D.isHeld(x.person)).map((x) => x.person.id).filter((id) => states.includes(st.get(id).state));
  }
  const selectNeedsPrinting = (project, byId) => setSelection(project, idsByState(project, byId, ['not-printed', 'changed']));
  const selectNotYetPrinted = (project, byId) => setSelection(project, idsByState(project, byId, ['not-printed']));
  const selectChanged = (project, byId) => setSelection(project, idsByState(project, byId, ['changed']));

  // ---------- undo / restore ----------
  const mapRun = (project, runId, fn) => ({ ...project, runs: project.runs.map((r) => (r.id === runId ? fn(r) : r)) });
  const undoRun = (project, runId, at = nowIso()) => mapRun(project, runId, (r) => (r.undoneAt ? r : { ...r, undoneAt: at }));
  const restoreRun = (project, runId) => mapRun(project, runId, (r) => ({ ...r, undoneAt: null }));
  function undoEntries(project, runId, personIds, at = nowIso()) {
    const set = new Set(personIds);
    return mapRun(project, runId, (r) => ({ ...r, entries: r.entries.map((e) => (set.has(e.personId) && !e.undoneAt ? { ...e, undoneAt: at } : e)) }));
  }
  function restoreEntries(project, runId, personIds) {
    const set = new Set(personIds);
    return mapRun(project, runId, (r) => ({ ...r, entries: r.entries.map((e) => (set.has(e.personId) ? { ...e, undoneAt: null } : e)) }));
  }
  /** Latest in-effect print entry for a person: {run, entry} or null. */
  function lastPrintEntry(project, personId) {
    let best = null;
    project.runs.forEach((run, ri) => {
      if (run.kind !== 'print') return;
      for (const entry of run.entries) {
        if (entry.personId !== personId || !inEffect(run, entry)) continue;
        if (!best || run.at > best.run.at || (run.at === best.run.at && ri >= best.ri)) best = { run, entry, ri };
      }
    });
    return best;
  }
  function undoLastPrintEntry(project, personId, at = nowIso()) {
    const hit = lastPrintEntry(project, personId);
    if (!hit) return { project, runId: null };
    return { project: undoEntries(project, hit.run.id, [personId], at), runId: hit.run.id };
  }

  function shortDate(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function longDate(iso) {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  /** "Still printed Dec 1" / "Not printed" / "Address changed since printing Dec 1". */
  function resultLine(status) {
    if (!status || status.state === 'not-printed') return 'Not printed';
    return status.state === 'printed' ? `Still printed ${shortDate(status.at)}` : `Address changed since printing ${shortDate(status.at)}`;
  }
  function runStats(run) {
    const countable = run.kind === 'print' || run.kind === 'pdf';
    return {
      people: run.entries.length,
      recorded: countable ? run.entries.reduce((n, e) => n + e.copies, 0) : 0,
      inEffect: countable ? run.entries.reduce((n, e) => n + (e.undoneAt || run.undoneAt ? 0 : e.copies), 0) : 0,
    };
  }

  // ---------- migration / validation ----------
  /** Build the migrated project from old checked ids, or null when there is nothing to migrate. */
  function migrateChecklist(checkedIds, people, now = nowIso()) {
    const byId = peopleMap(people);
    const ids = (Array.isArray(checkedIds) ? checkedIds : []).filter((id) => typeof id === 'string' && byId.has(id));
    if (!ids.length) return null;
    const { project } = addRecipients(makeProject(MIGRATED_NAME, now), ids.map((id) => ({ personId: id, copies: copiesOf(byId.get(id)) })));
    return project;
  }
  /** Validate raw projects; unknown fields are preserved. */
  function validateProjects(rawList) {
    const projects = [];
    const skipped = [];
    rawList.forEach((p, index) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return skipped.push({ index, reason: 'not an object', raw: p });
      if (typeof p.id !== 'string' || !p.id) return skipped.push({ index, reason: 'missing id', raw: p });
      if (typeof p.name !== 'string' || !normText(p.name)) return skipped.push({ index, reason: 'missing name', raw: p });
      if (p.recipients !== undefined && !Array.isArray(p.recipients)) return skipped.push({ index, reason: 'recipients is not a list', raw: p });
      if (p.runs !== undefined && !Array.isArray(p.runs)) return skipped.push({ index, reason: 'runs is not a list', raw: p });
      const recipients = (p.recipients || []).filter((r) => r && typeof r.personId === 'string')
        .map((r) => ({ ...r, copies: clampCopies(r.copies, 1), selected: r.selected !== false }));
      const runs = (p.runs || []).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.entries))
        .map((r) => ({ undoneAt: null, startCell: null, sheetCount: null, ...r, entries: r.entries.map((e) => ({ undoneAt: null, copies: 0, lines: [], ...e })) }));
      projects.push({ createdAt: nowIso(), ...p, recipients, runs });
    });
    return { projects, skipped };
  }

  return {
    MIGRATED_NAME, peopleMap, makeProject, sortProjects, findDuplicateName, rename, addRecipients, removeRecipients, setCopies,
    setSelected, setSelection, copyProject, visibleRecipients, printableLabels, pruneOrphans, entriesFromLabels, makeRun,
    makeMarkRun, appendRun, deriveStatus, groupOf, selectNeedsPrinting, selectNotYetPrinted, selectChanged, undoRun,
    restoreRun, undoEntries, restoreEntries, lastPrintEntry, undoLastPrintEntry, shortDate, longDate, resultLine, runStats,
    migrateChecklist, validateProjects, inEffect,
    heldRecipients, selectedHeld, isArchived, archiveProject, unarchiveProject, snapshotPeople, viewMap,
  };
});
