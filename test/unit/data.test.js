const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/shared/data.js');
const S = require('../../src/shared/settings.js');

const person = (over = {}) => ({ id: 'a', name: 'The Alder Family', address: [{ line1: '3008 Sample Lane', line2: 'Exampleton, TX 70001', version: 1 }], ...over });

test('current address is the highest version', () => {
  const p = person({ address: [{ line1: 'old', version: 1 }, { line1: 'new', version: 2 }] });
  assert.deepEqual(D.currentLines(p), ['new']);
});

test('they moved appends max+1 and keeps history', () => {
  const p = D.moved(person(), ['1 New St', 'Town, CA 90000']);
  assert.equal(p.address.length, 2);
  assert.equal(D.currentAddress(p).version, 2);
  assert.deepEqual(D.currentLines(p), ['1 New St', 'Town, CA 90000']);
  assert.equal(D.previousAddresses(p).length, 1);
});

test('fix a typo keeps the version and the history length', () => {
  const p = D.fixInPlace(person(), ['3008 Middlemarch Ln', 'Exampleton, TX 70001']);
  assert.equal(p.address.length, 1);
  assert.equal(D.currentAddress(p).version, 1);
  assert.equal(D.currentLines(p)[0], '3008 Middlemarch Ln');
});

test('fix on a person with no address creates version 1', () => {
  const p = D.fixInPlace(person({ address: [] }), ['1 Main St']);
  assert.equal(D.currentAddress(p).version, 1);
});

test('use this again adds max+1 with the old lines', () => {
  let p = D.moved(person(), ['1 New St']);
  p = D.useAgain(p, 1);
  assert.equal(D.currentAddress(p).version, 3);
  assert.deepEqual(D.currentLines(p), ['3008 Sample Lane', 'Exampleton, TX 70001']);
});

test('empty address person: no current address, no lines', () => {
  const p = person({ name: 'Pip', address: [] });
  assert.equal(D.currentAddress(p), null);
  assert.deepEqual(D.currentLines(p), []);
  assert.equal(D.addressSummary(p), '');
});

test('duplicate names stay separate people with separate ids', () => {
  const list = [person({ id: '1' }), person({ id: '2', address: [{ line1: '2446 Circle Lane', version: 1 }] })];
  const { people } = D.validateEntries(list);
  assert.equal(people.length, 2);
  assert.notEqual(people[0].id, people[1].id);
});

test('migration adds ids only where missing and reports change', () => {
  const r = D.migrateIds([{ name: 'A', address: [] }, { id: 'keep', name: 'B', address: [] }]);
  assert.equal(r.changed, true);
  assert.ok(r.people[0].id);
  assert.equal(r.people[1].id, 'keep');
  const again = D.migrateIds(r.people);
  assert.equal(again.changed, false);
});

test('migration repairs duplicate ids', () => {
  const r = D.migrateIds([{ id: 'x', name: 'A', address: [] }, { id: 'x', name: 'B', address: [] }]);
  assert.notEqual(r.people[0].id, r.people[1].id);
});

test('validation skips bad entries and preserves unknown fields', () => {
  const { people, skipped } = D.validateEntries([
    { name: 'Good', address: [], nickname: 'g' },
    { address: [] },
    { name: 'Bad address', address: 'nope' },
    null,
  ]);
  assert.equal(people.length, 1);
  assert.equal(people[0].nickname, 'g');
  assert.equal(skipped.length, 3);
});

test('text is trimmed and whitespace collapsed, other characters preserved', () => {
  assert.equal(D.normText('  100   Sample Road  '), '100 Sample Road');
  assert.equal(D.normText('Zoë O’Brien'), 'Zoë O’Brien');
  assert.deepEqual(D.normLines(['a', '  ', ' b ']), ['a', 'b']);
});

test('copies: default 1, clamp to 99, invalid reverts', () => {
  assert.equal(D.copiesOf({}), 1);
  assert.equal(D.copiesOf({ copies: 3 }), 3);
  assert.equal(D.clampCopies('150', 2), 99);
  assert.equal(D.clampCopies('0', 4), 4);
  assert.equal(D.clampCopies('abc', 4), 4);
  assert.equal(D.clampCopies('', 4), 4);
  assert.equal(D.clampCopies('7', 1), 7);
});

test('search ignores case, diacritics, and curly vs straight apostrophes', () => {
  const a = person({ name: 'The Fenwick Family', address: [{ line1: '2232 Kapa’a Street', version: 1 }] });
  const b = person({ id: 'b', name: 'Ned and Zoë Birch' });
  assert.ok(D.matchesQuery(a, "Kapa'a"));
  assert.ok(D.matchesQuery(b, 'zoe'));
  assert.ok(D.matchesQuery(a, 'FENWICK'));
  assert.ok(!D.matchesQuery(a, 'zzz'));
  assert.ok(D.matchesQuery(a, ''));
});

test('sort is case-insensitive and keeps ties stable', () => {
  const list = [
    { id: '1', name: 'the zinn family', address: [] },
    { id: '2', name: 'Abbey and Hal Bolt', address: [] },
    { id: '3', name: 'The Alder Family', address: [{ line1: 'first', version: 1 }] },
    { id: '4', name: 'The Alder Family', address: [{ line1: 'second', version: 1 }] },
  ];
  const sorted = D.sortPeople(list).map((p) => p.id);
  assert.deepEqual(sorted, ['2', '3', '4', '1']);
});

test('expandLabels honours checks, copies, and name-only people', () => {
  const people = [
    person({ id: 'a', copies: 3 }),
    { id: 'n', name: 'Pip', address: [] },
    person({ id: 'u', name: 'Unchecked' }),
  ];
  const labels = D.expandLabels(people, new Set(['a', 'n']));
  assert.equal(labels.length, 4);
  assert.deepEqual(labels[3].lines, ['Pip']);
  assert.deepEqual(labels[0].lines, ['The Alder Family', '3008 Sample Lane', 'Exampleton, TX 70001']);
});

test('exact duplicates are found, other people ignored', () => {
  const a = person({ id: '1' });
  const b = person({ id: '2' });
  const c = person({ id: '3', address: [{ line1: 'different', version: 1 }] });
  assert.equal(D.findExactDuplicate([a, c], b).id, '1');
  assert.equal(D.findExactDuplicate([a], a), null);
  assert.equal(D.findExactDuplicate([c], b), null);
});

test('nudge parsing: valid, out of range, and junk', () => {
  assert.deepEqual(S.parseNudge('0.03'), { ok: true, value: 0.03 });
  assert.equal(S.parseNudge('0.9').ok, false);
  assert.equal(S.parseNudge('-0.26').ok, false);
  assert.equal(S.parseNudge('abc').ok, false);
  assert.equal(S.parseNudge('').ok, false);
  assert.equal(S.parseNudge('0.25').ok, true);
});

test('settings fall back to defaults when invalid and keep the active view', () => {
  assert.equal(S.normalizeSettings(null).fallback, true);
  const r = S.normalizeSettings({ nudge: { x: 0.02, y: -0.03 }, activeView: 'p1', checkedIds: ['a'] });
  assert.deepEqual(r.settings.nudge, { x: 0.02, y: -0.03 });
  assert.equal(r.settings.activeView, 'p1');
  assert.equal(r.settings.checkedIds, undefined);
  assert.equal(S.normalizeSettings({}).settings.activeView, 'book');
  assert.equal(S.normalizeSettings({ nudge: { x: 5 } }).fallback, true);
  assert.equal(S.normalizeSettings({ activeView: 7 }).fallback, true);
});

// ---------- hold: "needs an address update" ----------
test('hold: set (no reason is stored), detect, and clear', () => {
  const p = person();
  assert.equal(D.isHeld(p), false);
  const held = D.setHold(p, '2026-11-01T00:00:00.000Z');
  assert.equal(D.isHeld(held), true);
  assert.deepEqual(held.hold, { at: '2026-11-01T00:00:00.000Z' });
  const cleared = D.clearHold(held);
  assert.equal(D.isHeld(cleared), false);
  assert.equal('hold' in cleared, false);
  assert.equal(D.clearHold(p), p);
});

test('hold: "They moved" clears it, a typo fix does not, and the address history is kept', () => {
  const held = D.setHold(person());
  assert.equal(D.isHeld(D.fixInPlace(held, ['1 Main Street', 'Town, CA 90000'])), true);
  const moved = D.moved(held, ['5 New Rd', 'Town, CA 90000']);
  assert.equal(D.isHeld(moved), false);
  assert.equal(moved.address.length, 2);
  assert.equal(D.isHeld(D.useAgain(D.setHold(D.moved(person(), ['a'])), 1)), false);
});

test('hold survives validation (unknown fields are preserved)', () => {
  const { people } = D.validateEntries([{ id: 'a', name: 'A', address: [], hold: { at: '2026-11-01T00:00:00.000Z' } }]);
  assert.equal(D.isHeld(people[0]), true);
});

// ---------- sorting ignores a leading "The" ----------
test('sort key ignores a leading "The" (any case), but not words that merely start with it', () => {
  assert.equal(D.sortKey('The Alder Family'), 'Alder Family');
  assert.equal(D.sortKey('  the   Alder Family'), 'Alder Family');
  assert.equal(D.sortKey('THE Alder Family'), 'Alder Family');
  assert.equal(D.sortKey('Theo Smith'), 'Theo Smith');
  assert.equal(D.sortKey('Theresa'), 'Theresa');
  assert.equal(D.sortKey('The'), 'The'); // a name that is only "The" stays as it is
  assert.equal(D.sortKey('Bob and The Band'), 'Bob and The Band');
});

test('"The" names file under their next word, and the displayed name is unchanged', () => {
  const list = ['The Pearce Family', 'Abbey Bolt', 'The Alder Family', 'Alan Pike', 'Bea and Jo', 'The Zane Family', 'Theo Smith']
    .map((name, i) => ({ id: String(i), name, address: [] }));
  const sorted = D.sortPeople(list).map((p) => p.name);
  assert.deepEqual(sorted, ['Abbey Bolt', 'Alan Pike', 'The Alder Family', 'Bea and Jo', 'The Pearce Family', 'Theo Smith', 'The Zane Family']);
});

test('people with the same name after dropping "The" keep a stable order', () => {
  const list = [{ id: '1', name: 'The Alder Family', address: [] }, { id: '2', name: 'Alder Family', address: [] }];
  assert.deepEqual(D.sortPeople(list).map((p) => p.id), ['1', '2']);
});
