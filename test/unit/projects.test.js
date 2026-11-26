const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/shared/data.js');
const P = require('../../src/shared/projects.js');

const person = (id, name, lines = ['1 Main St', 'Town, CA 90000'], extra = {}) => ({
  id, name, address: lines.length ? [D.makeAddress(lines, 1)] : [], ...extra,
});
const PEOPLE = [
  person('a', 'Alice Family'), person('b', 'Bob Family'), person('c', 'Cara Family'),
  person('d', 'Dan Family', ['9 Oak Ave', 'Elm, CA 90001']), person('n', 'Pip', []),
];
const byId = (people = PEOPLE) => P.peopleMap(people);
const ids = (...a) => a.map((personId) => ({ personId, copies: 1 }));
const T = (n) => `2026-12-${String(n).padStart(2, '0')}T10:00:00.000Z`;

function projectWith(personIds, copies = {}) {
  const p0 = P.makeProject('Christmas 2026', T(1));
  return P.addRecipients(p0, personIds.map((personId) => ({ personId, copies: copies[personId] || 1 }))).project;
}
const printLabels = (project, people = PEOPLE) => P.printableLabels(project, byId(people));
const printRun = (project, personIds, at, people = PEOPLE) => {
  const selected = P.setSelection(project, personIds);
  const entries = P.entriesFromLabels(P.printableLabels(selected, byId(people)));
  return P.appendRun(project, P.makeRun({ kind: 'print', at, startCell: 14, sheetCount: 1, entries }));
};
const state = (project, id, people = PEOPLE) => P.deriveStatus(project, byId(people)).get(id);

// ---------- projects ----------
test('create trims the name and starts empty', () => {
  const p = P.makeProject('  Christmas   2026 ', T(1));
  assert.equal(p.name, 'Christmas 2026');
  assert.deepEqual([p.recipients, p.runs], [[], []]);
  assert.ok(p.id);
});

test('add recipients: new ones are selected, existing skipped, other selections unchanged', () => {
  let p = projectWith(['a', 'b']);
  p = P.setSelected(p, ['a'], false);
  const r = P.addRecipients(p, [{ personId: 'b', copies: 5 }, { personId: 'c', copies: 3 }]);
  assert.deepEqual(r.added, ['c']);
  assert.equal(r.skipped, 1);
  const by = new Map(r.project.recipients.map((x) => [x.personId, x]));
  assert.equal(by.get('a').selected, false);
  assert.equal(by.get('c').selected, true);
  assert.equal(by.get('c').copies, 3);
  assert.equal(by.get('b').copies, 1);
});

test('copies clamp to 1..99 and invalid input is ignored', () => {
  let p = projectWith(['a']);
  p = P.setCopies(p, 'a', 150); assert.equal(p.recipients[0].copies, 99);
  p = P.setCopies(p, 'a', 0); assert.equal(p.recipients[0].copies, 99);
  p = P.setCopies(p, 'a', 'abc'); assert.equal(p.recipients[0].copies, 99);
  p = P.setCopies(p, 'a', 4); assert.equal(p.recipients[0].copies, 4);
});

test('copy a project: recipients and copies carried, everyone selected, no runs', () => {
  let p = projectWith(['a', 'b'], { a: 3 });
  p = P.setSelected(p, ['b'], false);
  p = printRun(P.setSelected(p, ['a'], true), ['a'], T(2));
  const c = P.copyProject(p, 'Christmas 2027', T(5));
  assert.notEqual(c.id, p.id);
  assert.deepEqual(c.recipients, [{ personId: 'a', copies: 3, selected: true }, { personId: 'b', copies: 1, selected: true }]);
  assert.deepEqual(c.runs, []);
  assert.equal(state(c, 'a').state, 'not-printed');
});

test('remove recipients leaves everyone else', () => {
  const p = P.removeRecipients(projectWith(['a', 'b', 'c']), ['b']);
  assert.deepEqual(p.recipients.map((r) => r.personId), ['a', 'c']);
});

test('projects sort in natural, case-insensitive order', () => {
  const names = ['christmas 2026', 'Wedding', 'Christmas 10', 'Christmas 2025', 'Christmas 9'].map((n) => P.makeProject(n));
  assert.deepEqual(P.sortProjects(names).map((p) => p.name), ['Christmas 9', 'Christmas 10', 'Christmas 2025', 'christmas 2026', 'Wedding']);
});

test('duplicate names are found ignoring case, excluding the project itself', () => {
  const p = P.makeProject('Christmas 2026');
  assert.equal(P.findDuplicateName([p], 'CHRISTMAS 2026'), p);
  assert.equal(P.findDuplicateName([p], 'christmas 2026', p.id), null);
  assert.equal(P.findDuplicateName([p], 'Other'), null);
});

test('visible recipients are sorted by name and orphans are ignored', () => {
  const p = projectWith(['c', 'zzz', 'a']);
  assert.deepEqual(P.visibleRecipients(p, byId()).map((x) => x.person.id), ['a', 'c']);
});

test('printable labels: selected only, one per copy, name-only for empty addresses', () => {
  let p = projectWith(['a', 'n', 'b'], { a: 2 });
  p = P.setSelected(p, ['b'], false);
  const labels = printLabels(p);
  assert.equal(labels.length, 3);
  assert.deepEqual(labels.map((l) => l.id), ['a', 'a', 'n']);
  assert.deepEqual(labels[2].lines, ['Pip']);
  assert.deepEqual(labels[0].lines, ['Alice Family', '1 Main St', 'Town, CA 90000']);
});

test('per-project copies are independent', () => {
  const one = projectWith(['a'], { a: 2 });
  const two = projectWith(['a'], { a: 1 });
  assert.equal(printLabels(one).length, 2);
  assert.equal(printLabels(two).length, 1);
});

test('prune orphans removes recipients of missing people', () => {
  const pruned = P.pruneOrphans([projectWith(['a', 'zzz'])], ['a']);
  assert.deepEqual(pruned[0].recipients.map((r) => r.personId), ['a']);
});

// ---------- status ----------
test('never printed is Not printed', () => {
  assert.equal(state(projectWith(['a']), 'a').state, 'not-printed');
});

test('a print marks Printed with its date; matching lines', () => {
  const p = printRun(projectWith(['a', 'b']), ['a'], T(2));
  assert.equal(state(p, 'a').state, 'printed');
  assert.equal(state(p, 'a').at, T(2));
  assert.equal(state(p, 'b').state, 'not-printed');
});

test('a pdf run has no effect on status', () => {
  const base = projectWith(['a']);
  const entries = P.entriesFromLabels(printLabels(base));
  const p = P.appendRun(base, P.makeRun({ kind: 'pdf', at: T(2), entries }));
  assert.equal(state(p, 'a').state, 'not-printed');
});

test('marked then unmarked is Not printed; marked alone is Printed', () => {
  let p = projectWith(['a']);
  p = P.appendRun(p, P.makeMarkRun('marked', ['a'], byId(), T(2)));
  assert.equal(state(p, 'a').state, 'printed');
  p = P.appendRun(p, P.makeMarkRun('unmarked', ['a'], byId(), T(3)));
  assert.equal(state(p, 'a').state, 'not-printed');
  p = P.appendRun(p, P.makeMarkRun('marked', ['a'], byId(), T(4)));
  assert.equal(state(p, 'a').state, 'printed');
});

test('label total counts print copies only, and ignores undone entries', () => {
  let p = projectWith(['a'], { a: 2 });
  p = printRun(p, ['a'], T(2));
  p = printRun(p, ['a'], T(3));
  assert.equal(state(p, 'a').labels, 4);
  p = P.appendRun(p, P.makeMarkRun('marked', ['a'], byId(), T(4)));
  assert.equal(state(p, 'a').labels, 4);
  p = P.undoEntries(p, p.runs[1].id, ['a'], T(5));
  assert.equal(state(p, 'a').labels, 2);
});

test('statuses use time order even if runs were appended out of order', () => {
  let p = projectWith(['a']);
  const marked = P.makeMarkRun('unmarked', ['a'], byId(), T(5));
  const printed = P.makeRun({ kind: 'print', at: T(2), entries: P.entriesFromLabels(printLabels(p)) });
  p = P.appendRun(P.appendRun(p, marked), printed); // unmarked (Dec 5) appended before print (Dec 2)
  assert.equal(state(p, 'a').state, 'not-printed');
});

// ---------- address changed ----------
test('a move after printing shows Address changed', () => {
  const p = printRun(projectWith(['a']), ['a'], T(2));
  const moved = PEOPLE.map((x) => (x.id === 'a' ? D.moved(x, ['5 New Rd', 'Town, CA 90000']) : x));
  assert.equal(state(p, 'a', moved).state, 'changed');
});

test('an in-place typo fix after printing also shows Address changed', () => {
  const p = printRun(projectWith(['a']), ['a'], T(2));
  const fixed = PEOPLE.map((x) => (x.id === 'a' ? D.fixInPlace(x, ['1 Main Street', 'Town, CA 90000']) : x));
  assert.equal(state(p, 'a', fixed).state, 'changed');
});

test('whitespace-only differences are not a change', () => {
  const p = printRun(projectWith(['a']), ['a'], T(2));
  const spaced = PEOPLE.map((x) => (x.id === 'a' ? { ...x, address: [D.makeAddress(['  1 Main St ', 'Town, CA 90000'], 1)] } : x));
  assert.equal(state(p, 'a', spaced).state, 'printed');
});

test('a name-only person prints and stays Printed', () => {
  const p = printRun(projectWith(['n']), ['n'], T(2));
  assert.equal(state(p, 'n').state, 'printed');
});

test('a deleted person keeps their history snapshot', () => {
  const p = printRun(projectWith(['a']), ['a'], T(2));
  const without = PEOPLE.filter((x) => x.id !== 'a');
  assert.equal(P.deriveStatus(p, byId(without)).has('a'), false);
  assert.deepEqual(p.runs[0].entries[0], { personId: 'a', name: 'Alice Family', copies: 1, lines: ['1 Main St', 'Town, CA 90000'], undoneAt: null });
});

// ---------- undo ----------
test('undoing 3 of 40 entries leaves 37 Printed', () => {
  const people = Array.from({ length: 40 }, (_, i) => person('p' + i, 'Person ' + String(i).padStart(2, '0')));
  let p = P.addRecipients(P.makeProject('Big', T(1)), people.map((x) => ({ personId: x.id, copies: 1 }))).project;
  p = printRun(p, people.map((x) => x.id), T(2), people);
  p = P.undoEntries(p, p.runs[0].id, ['p1', 'p2', 'p3'], T(3));
  const st = P.deriveStatus(p, byId(people));
  assert.equal([...st.values()].filter((s) => s.state === 'printed').length, 37);
  assert.equal(st.get('p1').state, 'not-printed');
  assert.equal(P.runStats(p.runs[0]).recorded, 40);
  assert.equal(P.runStats(p.runs[0]).inEffect, 37);
});

test('a failed reprint of an already printed recipient falls back to the earlier print', () => {
  let p = projectWith(['a']);
  p = printRun(p, ['a'], T(1));
  p = printRun(p, ['a'], T(10));
  p = P.undoEntries(p, p.runs[1].id, ['a'], T(11));
  const s = state(p, 'a');
  assert.equal(s.state, 'printed');
  assert.equal(s.at, T(1));
  assert.match(P.resultLine(s), /^Still printed Dec 1$/);
});

test('a failed reprint after a move shows Address changed', () => {
  let p = projectWith(['a']);
  p = printRun(p, ['a'], T(1));
  const moved = PEOPLE.map((x) => (x.id === 'a' ? D.moved(x, ['5 New Rd', 'Town, CA 90000']) : x));
  p = printRun(p, ['a'], T(10), moved);
  assert.equal(state(p, 'a', moved).state, 'printed');
  p = P.undoEntries(p, p.runs[1].id, ['a'], T(11));
  assert.equal(state(p, 'a', moved).state, 'changed');
});

test('both prints undone gives Not printed; restoring brings it back', () => {
  let p = projectWith(['a']);
  p = printRun(p, ['a'], T(1)); p = printRun(p, ['a'], T(2));
  p = P.undoEntries(p, p.runs[0].id, ['a']); p = P.undoEntries(p, p.runs[1].id, ['a']);
  assert.equal(state(p, 'a').state, 'not-printed');
  assert.equal(P.resultLine(state(p, 'a')), 'Not printed');
  p = P.restoreEntries(p, p.runs[1].id, ['a']);
  assert.equal(state(p, 'a').state, 'printed');
});

test('whole-run undo equals undoing every entry; restore reverses it', () => {
  let p = projectWith(['a', 'b']);
  p = printRun(p, ['a', 'b'], T(2));
  const whole = P.undoRun(p, p.runs[0].id, T(3));
  const each = P.undoEntries(p, p.runs[0].id, ['a', 'b'], T(3));
  for (const id of ['a', 'b']) assert.equal(state(whole, id).state, state(each, id).state);
  assert.equal(state(whole, 'a').state, 'not-printed');
  assert.equal(state(P.restoreRun(whole, p.runs[0].id), 'a').state, 'printed');
});

test('Needs a label again differs from Didn\'t come out after two prints', () => {
  let p = projectWith(['a']);
  p = printRun(p, ['a'], T(1)); p = printRun(p, ['a'], T(2));
  const didnt = P.undoEntries(p, p.runs[1].id, ['a'], T(3));
  assert.equal(state(didnt, 'a').state, 'printed');
  const needs = P.appendRun(p, P.makeMarkRun('unmarked', ['a'], byId(), T(3)));
  assert.equal(state(needs, 'a').state, 'not-printed');
  assert.equal(needs.runs.length, 3); // history is kept
});

test('undo of the last print entry targets only the latest in-effect print', () => {
  let p = projectWith(['a']);
  p = printRun(p, ['a'], T(1)); p = printRun(p, ['a'], T(2));
  const r = P.undoLastPrintEntry(p, 'a', T(3));
  assert.equal(r.runId, p.runs[1].id);
  assert.equal(state(r.project, 'a').at, T(1));
  assert.equal(P.undoLastPrintEntry(projectWith(['a']), 'a').runId, null);
});

// ---------- filters and selection actions ----------
test('status groups and selection actions on a mix of states', () => {
  let p = projectWith(['a', 'b', 'c', 'd']);
  p = printRun(p, ['a', 'b'], T(2));
  const moved = PEOPLE.map((x) => (x.id === 'b' ? D.moved(x, ['2 New Ln', 'Elsewhere, CA 90002']) : x));
  const m = byId(moved);
  const sel = (fn) => fn(p, m).recipients.filter((r) => r.selected).map((r) => r.personId).sort();
  assert.deepEqual(sel(P.selectNeedsPrinting), ['b', 'c', 'd']);
  assert.deepEqual(sel(P.selectNotYetPrinted), ['c', 'd']);
  assert.deepEqual(sel(P.selectChanged), ['b']);
  assert.equal(P.groupOf('printed'), 'printed');
  assert.equal(P.groupOf('changed'), 'needs');
  assert.equal(P.groupOf('not-printed'), 'needs');
});

// ---------- runs ----------
test('entries group labels by person and keep address lines only', () => {
  const entries = P.entriesFromLabels(printLabels(projectWith(['a', 'n'], { a: 2 })));
  assert.deepEqual(entries, [
    { personId: 'a', name: 'Alice Family', copies: 2, lines: ['1 Main St', 'Town, CA 90000'] },
    { personId: 'n', name: 'Pip', copies: 1, lines: [] },
  ]);
});

test('run stats count only prints and pdfs', () => {
  const mark = P.makeMarkRun('marked', ['a', 'b'], byId(), T(2));
  assert.deepEqual(P.runStats(mark), { people: 2, recorded: 0, inEffect: 0 });
});

test('dates format as short and long', () => {
  assert.equal(P.shortDate(T(1)), 'Dec 1');
  assert.match(P.longDate(T(1)), /Dec 1, 2026/);
});

// ---------- migration / validation ----------
test('migration builds "Checked list (migrated)" from checked ids with person default copies', () => {
  const people = [person('a', 'A', ['x'], { copies: 3 }), person('b', 'B', ['y'])];
  const p = P.migrateChecklist(['a', 'zzz', 'b'], people, T(1));
  assert.equal(p.name, 'Checked list (migrated)');
  assert.deepEqual(p.recipients, [{ personId: 'a', copies: 3, selected: true }, { personId: 'b', copies: 1, selected: true }]);
});

test('migration returns null for empty, missing, or all-unknown ids', () => {
  assert.equal(P.migrateChecklist([], PEOPLE), null);
  assert.equal(P.migrateChecklist(undefined, PEOPLE), null);
  assert.equal(P.migrateChecklist(['zzz'], PEOPLE), null);
});

test('validation skips bad projects, normalizes recipients, and preserves unknown fields', () => {
  const { projects, skipped } = P.validateProjects([
    { id: 'p1', name: 'Good', recipients: [{ personId: 'a', copies: 500 }, { nope: 1 }], runs: [], color: 'red' },
    { name: 'No id' },
    { id: 'p2' },
    { id: 'p3', name: 'Bad list', recipients: 'x' },
    null,
  ]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].color, 'red');
  assert.deepEqual(projects[0].recipients, [{ personId: 'a', copies: 99, selected: true }]);
  assert.equal(skipped.length, 4);
});

// ---------- hold in projects ----------
const held = (id) => PEOPLE.map((x) => (x.id === id ? D.setHold(x, T(1)) : x));

test('held people are never printed, even when selected, and printing is otherwise unchanged', () => {
  const p = projectWith(['a', 'b', 'c']);
  const people = held('b');
  const labels = P.printableLabels(p, byId(people));
  assert.deepEqual(labels.map((l) => l.id), ['a', 'c']);
  assert.equal(P.selectedHeld(p, byId(people)).length, 1);
  assert.equal(P.heldRecipients(P.setSelected(p, ['b'], false), byId(people)).length, 1);
  assert.equal(P.selectedHeld(P.setSelected(p, ['b'], false), byId(people)).length, 0);
});

test('select needs printing / not yet printed / changed skip held people', () => {
  let p = projectWith(['a', 'b', 'c']);
  p = printRun(p, ['a'], T(2));
  const people = held('b');
  const m = byId(people);
  const sel = (fn) => fn(p, m).recipients.filter((r) => r.selected).map((r) => r.personId).sort();
  assert.deepEqual(sel(P.selectNeedsPrinting), ['c']);
  assert.deepEqual(sel(P.selectNotYetPrinted), ['c']);
});

test('a held person keeps their printed status underneath', () => {
  const p = printRun(projectWith(['a']), ['a'], T(2));
  assert.equal(state(p, 'a', held('a')).state, 'printed');
});

// ---------- archive ----------
test('archiving freezes names and address lines (and versions) for visible recipients', () => {
  const p = projectWith(['a', 'n', 'zzz']);
  const a = P.archiveProject(p, byId(), T(9));
  assert.equal(P.isArchived(a), true);
  assert.equal(a.archivedAt, T(9));
  assert.deepEqual(a.snapshot, [
    { personId: 'a', name: 'Alice Family', lines: ['1 Main St', 'Town, CA 90000'], version: 1 },
    { personId: 'n', name: 'Pip', lines: [], version: null },
  ]);
  assert.equal(P.isArchived(p), false);
});

test('an archived project does not change when addresses, names, or people change', () => {
  let p = printRun(projectWith(['a', 'b']), ['a', 'b'], T(2));
  p = P.archiveProject(p, byId(), T(3));
  // later: a moves, b is renamed, c is deleted from the book
  const later = PEOPLE.filter((x) => x.id !== 'c').map((x) => (x.id === 'a' ? D.moved(x, ['5 New Rd', 'Elsewhere, CA 90002']) : x.id === 'b' ? { ...x, name: 'Bob Renamed' } : x));
  const view = P.viewMap(p, byId(later));
  assert.equal(view.get('a').address[0].line1, '1 Main St');
  assert.equal(view.get('b').name, 'Bob Family');
  const st = P.deriveStatus(p, view);
  assert.equal(st.get('a').state, 'printed'); // no "Address changed" in an archive
  assert.equal(st.get('b').state, 'printed');
});

test('an archived project still shows people deleted from the address book', () => {
  const p = P.archiveProject(projectWith(['a', 'b']), byId(), T(3));
  const view = P.viewMap(p, byId(PEOPLE.filter((x) => x.id !== 'a')));
  assert.deepEqual(P.visibleRecipients(p, view).map((x) => x.person.id), ['a', 'b']);
});

test('archived projects are not pruned of orphans; active ones are', () => {
  const active = projectWith(['a', 'zzz']);
  const archived = P.archiveProject(projectWith(['a', 'zzz']), byId(), T(3));
  const [x, y] = P.pruneOrphans([active, archived], ['a']);
  assert.equal(x.recipients.length, 1);
  assert.equal(y.recipients.length, 2);
});

test('unarchive drops the snapshot and returns to live addresses; history is kept', () => {
  let p = printRun(projectWith(['a']), ['a'], T(2));
  p = P.archiveProject(p, byId(), T(3));
  const u = P.unarchiveProject(p);
  assert.equal(P.isArchived(u), false);
  assert.equal(u.archivedAt, null);
  assert.equal('snapshot' in u, false);
  assert.equal(u.runs.length, 1);
  const live = byId();
  assert.equal(P.viewMap(u, live), live);
});

test('copying an archived project carries recipients and copies, not the snapshot or history', () => {
  let p = projectWith(['a', 'b'], { a: 3 });
  p = P.archiveProject(printRun(p, ['a'], T(2)), byId(), T(3));
  const c = P.copyProject(p, 'Next year', T(5));
  assert.equal(P.isArchived(c), false);
  assert.equal('snapshot' in c, false);
  assert.deepEqual(c.runs, []);
  assert.deepEqual(c.recipients.map((r) => [r.personId, r.copies]), [['a', 3], ['b', 1]]);
});

test('archive survives validation with its snapshot', () => {
  const a = P.archiveProject(projectWith(['a']), byId(), T(3));
  const { projects } = P.validateProjects([JSON.parse(JSON.stringify(a))]);
  assert.equal(P.isArchived(projects[0]), true);
  assert.equal(projects[0].snapshot.length, 1);
});
