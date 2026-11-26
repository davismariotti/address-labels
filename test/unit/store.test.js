const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, BACKUPS_KEPT } = require('../../src/main/store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'labels-test-'));
const write = (dir, name, text) => fs.writeFileSync(path.join(dir, name), typeof text === 'string' ? text : JSON.stringify(text));
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('missing file starts empty and creates the file on first save', () => {
  const dir = tmp();
  const s = createStore(dir);
  const r = s.load();
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.people, []);
  assert.ok(!fs.existsSync(path.join(dir, 'addresses.json')));
  assert.ok(s.save([{ id: '1', name: 'A', address: [] }]).ok);
  assert.equal(read(dir, 'addresses.json').length, 1);
});

test('migration adds ids, writes a pre-migration copy, and is idempotent', () => {
  const dir = tmp();
  write(dir, 'addresses.json', [{ name: 'A', address: [{ line1: 'x', version: 1 }] }, { name: 'B', address: [] }]);
  const s = createStore(dir);
  const r = s.load();
  assert.equal(r.status, 'ok');
  assert.ok(r.people.every((p) => p.id));
  const pre = fs.readdirSync(dir).filter((n) => n.startsWith('addresses.pre-migration-'));
  assert.equal(pre.length, 1);
  assert.ok(read(dir, 'addresses.json').every((p) => p.id));
  const again = createStore(dir).load();
  assert.deepEqual(again.people.map((p) => p.id), r.people.map((p) => p.id));
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('addresses.pre-migration-')).length, 1);
});

test('corrupt JSON: reports the position, refuses to save, leaves the file untouched', () => {
  const dir = tmp();
  const bad = '[ {"name": "A", } ]';
  write(dir, 'addresses.json', bad);
  const s = createStore(dir);
  const r = s.load();
  assert.equal(r.status, 'corrupt');
  assert.match(r.error, /line \d+, column \d+|JSON/);
  const saved = s.save([{ id: '1', name: 'X', address: [] }]);
  assert.equal(saved.ok, false);
  assert.equal(fs.readFileSync(path.join(dir, 'addresses.json'), 'utf8'), bad);
});

test('wrong top-level shape is corrupt', () => {
  const dir = tmp();
  write(dir, 'addresses.json', { people: [] });
  assert.equal(createStore(dir).load().status, 'corrupt');
});

test('invalid entries are skipped, reported, and preserved on save with unknown fields', () => {
  const dir = tmp();
  write(dir, 'addresses.json', [
    { id: '1', name: 'Good', address: [], nickname: 'g' },
    { id: '2', address: [] },
  ]);
  const s = createStore(dir);
  const r = s.load();
  assert.equal(r.people.length, 1);
  assert.deepEqual(r.skipped, [{ index: 1, reason: 'missing name' }]);
  assert.ok(s.save(r.people).ok);
  const out = read(dir, 'addresses.json');
  assert.equal(out.length, 2);
  assert.equal(out[0].nickname, 'g');
  assert.equal(out[1].id, '2');
});

test('save writes atomically (no temp files left) and backs up the previous file', () => {
  const dir = tmp();
  write(dir, 'addresses.json', [{ id: '1', name: 'A', address: [] }]);
  const s = createStore(dir);
  s.load();
  assert.ok(s.save([{ id: '1', name: 'A2', address: [] }]).ok);
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
  const backups = s.listBackups();
  assert.equal(backups.length, 1);
  assert.equal(read(path.join(dir, 'backups'), backups[0].name)[0].name, 'A');
});

test(`rolling backups keep only ${BACKUPS_KEPT} and never prune the pre-migration copy`, () => {
  const dir = tmp();
  write(dir, 'addresses.json', [{ name: 'A', address: [] }]);
  const s = createStore(dir);
  const r = s.load();
  for (let i = 0; i < BACKUPS_KEPT + 7; i++) assert.ok(s.save([{ ...r.people[0], name: 'A' + i }]).ok);
  assert.equal(s.listBackups().length, BACKUPS_KEPT);
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('addresses.pre-migration-')).length, 1);
});

test('restore latest backup renames a broken file and loads the backup', () => {
  const dir = tmp();
  write(dir, 'addresses.json', [{ id: '1', name: 'Original', address: [] }]);
  const s = createStore(dir);
  s.load();
  s.save([{ id: '1', name: 'Edited', address: [] }]);
  write(dir, 'addresses.json', '{ broken');
  const s2 = createStore(dir);
  assert.equal(s2.load().status, 'corrupt');
  const r = s2.restoreBackup();
  assert.ok(r.ok);
  assert.equal(r.people[0].name, 'Original');
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('addresses.broken-')));
});

test('settings: defaults when missing, fallback notice when invalid, round trip', () => {
  const dir = tmp();
  const s = createStore(dir);
  assert.deepEqual(s.loadSettings().nudge, { x: 0, y: 0 });
  write(dir, 'settings.json', '{ nope');
  const bad = s.loadSettings();
  assert.deepEqual(bad.nudge, { x: 0, y: 0 });
  assert.ok(bad.notice);
  assert.ok(s.saveSettings({ nudge: { x: 0.02, y: -0.03 }, activeView: 'proj-1' }).ok);
  const ok = s.loadSettings();
  assert.deepEqual(ok.nudge, { x: 0.02, y: -0.03 });
  assert.equal(ok.activeView, 'proj-1');
  assert.equal(ok.checkedIds, undefined);
  assert.equal(ok.notice, undefined);
});

test('logs rotate past 1 MB and keep at most 5 files', () => {
  const dir = tmp();
  const s = createStore(dir);
  const big = 'x'.repeat(1024 * 1024 + 10);
  fs.mkdirSync(path.join(dir, 'logs'));
  for (let i = 0; i < 8; i++) {
    fs.writeFileSync(path.join(dir, 'logs', 'app.log'), big);
    s.log('info', 'tick');
  }
  const files = fs.readdirSync(path.join(dir, 'logs'));
  assert.ok(files.length <= 5, files.join(','));
  assert.ok(files.includes('app.log'));
});

test('save failure is reported without throwing', () => {
  const dir = tmp();
  write(dir, 'addresses.json', [{ id: '1', name: 'A', address: [] }]);
  const s = createStore(dir);
  s.load();
  fs.chmodSync(dir, 0o500);
  const r = s.save([{ id: '1', name: 'B', address: [] }]);
  fs.chmodSync(dir, 0o700);
  assert.equal(r.ok, false);
  assert.match(r.error, /Could not save/);
});


// ---------- projects.json ----------
const PROJ = (extra = {}) => ({ version: 1, projects: [{ id: 'p1', name: 'Christmas 2026', createdAt: '2026-11-01T00:00:00.000Z', recipients: [{ personId: 'a', copies: 2, selected: true }], runs: [] }], ...extra });

test('projects: missing file loads empty and the first save creates it atomically', () => {
  const dir = tmp();
  const s = createStore(dir);
  assert.equal(s.loadProjects().status, 'missing');
  assert.ok(!fs.existsSync(path.join(dir, 'projects.json')));
  assert.ok(s.saveProjects(PROJ().projects).ok);
  assert.equal(read(dir, 'projects.json').projects[0].name, 'Christmas 2026');
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
});

test('projects: unknown top-level and per-project fields are preserved on save', () => {
  const dir = tmp();
  const raw = PROJ({ futureThing: { x: 1 } });
  raw.projects[0].color = 'red';
  write(dir, 'projects.json', raw);
  const s = createStore(dir);
  const r = s.loadProjects();
  assert.equal(r.status, 'ok');
  assert.ok(s.saveProjects(r.projects).ok);
  const out = read(dir, 'projects.json');
  assert.deepEqual(out.futureThing, { x: 1 });
  assert.equal(out.projects[0].color, 'red');
});

test('projects: invalid projects are skipped, reported, and written back untouched', () => {
  const dir = tmp();
  const raw = PROJ();
  raw.projects.push({ id: 'bad', recipients: [] }, 'junk');
  write(dir, 'projects.json', raw);
  const s = createStore(dir);
  const r = s.loadProjects();
  assert.equal(r.projects.length, 1);
  assert.deepEqual(r.skipped.map((x) => x.index), [1, 2]);
  assert.ok(s.saveProjects(r.projects).ok);
  const out = read(dir, 'projects.json');
  assert.equal(out.projects.length, 3);
  assert.equal(out.projects[2], 'junk');
});

test('projects: corrupt file is reported with a position, never overwritten, saves refused', () => {
  const dir = tmp();
  const bad = '{ "projects": [ { "id": ';
  write(dir, 'projects.json', bad);
  const s = createStore(dir);
  const r = s.loadProjects();
  assert.equal(r.status, 'corrupt');
  assert.match(r.error, /JSON|line|position/i);
  assert.equal(s.saveProjects([]).ok, false);
  assert.equal(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'), bad);
});

test('projects: wrong shape (a bare list) is corrupt', () => {
  const dir = tmp();
  write(dir, 'projects.json', []);
  assert.equal(createStore(dir).loadProjects().status, 'corrupt');
});

test('projects: backups rotate at 20 separately from address backups', () => {
  const dir = tmp();
  write(dir, 'addresses.json', [{ id: '1', name: 'A', address: [] }]);
  write(dir, 'projects.json', PROJ());
  const s = createStore(dir);
  s.load(); const r = s.loadProjects();
  for (let i = 0; i < BACKUPS_KEPT + 6; i++) assert.ok(s.saveProjects(r.projects).ok);
  assert.equal(s.listBackups('projects').length, BACKUPS_KEPT);
  assert.equal(s.listBackups('addresses').length, 0, 'address backups are separate');
  for (let i = 0; i < 3; i++) s.save([{ id: '1', name: 'A' + i, address: [] }]);
  assert.equal(s.listBackups('projects').length, BACKUPS_KEPT, 'address saves do not prune project backups');
  assert.equal(s.listBackups('addresses').length, 3);
});

test('projects: restore of a broken file renames it and loads the newest valid backup', () => {
  const dir = tmp();
  write(dir, 'projects.json', PROJ());
  const s = createStore(dir);
  s.loadProjects();
  s.saveProjects(PROJ().projects);
  write(dir, 'projects.json', '{ nope');
  const s2 = createStore(dir);
  assert.equal(s2.loadProjects().status, 'corrupt');
  const r = s2.restoreProjectsBackup();
  assert.ok(r.ok);
  assert.equal(r.projects[0].name, 'Christmas 2026');
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('projects.broken-')));
  assert.equal(createStore(tmp()).restoreProjectsBackup().ok, false);
});

test('projects: a failing save reports an error without throwing', () => {
  const dir = tmp();
  write(dir, 'projects.json', PROJ());
  const s = createStore(dir);
  const r = s.loadProjects();
  fs.chmodSync(dir, 0o500);
  const out = s.saveProjects(r.projects);
  fs.chmodSync(dir, 0o700);
  assert.equal(out.ok, false);
  assert.match(out.error, /Could not save projects\.json/);
});

test('projects: orphaned recipients are pruned and saved only when something changed', () => {
  const dir = tmp();
  const raw = PROJ();
  raw.projects[0].recipients.push({ personId: 'gone', copies: 1, selected: true });
  write(dir, 'projects.json', raw);
  const s = createStore(dir);
  const r = s.loadProjects();
  const pruned = s.pruneOrphans(r.projects, ['a']);
  assert.deepEqual(pruned[0].recipients.map((x) => x.personId), ['a']);
  assert.deepEqual(read(dir, 'projects.json').projects[0].recipients.map((x) => x.personId), ['a']);
  const again = s.pruneOrphans(pruned, ['a']);
  assert.equal(again, pruned);
});

// ---------- migration of the old checklist ----------
const PEOPLE = [{ id: 'a', name: 'A', address: [], copies: 3 }, { id: 'b', name: 'B', address: [] }];
const seedSettings = (dir, obj) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(obj));

test('migration: a non-empty checkedIds becomes "Checked list (migrated)" and settings are cleaned', () => {
  const dir = tmp();
  seedSettings(dir, { nudge: { x: 0.02, y: 0 }, checkedIds: ['a', 'b', 'zzz'] });
  const s = createStore(dir);
  s.loadProjects();
  const m = s.migrateProjects(PEOPLE);
  assert.equal(m.migrated, 'Checked list (migrated)');
  const projects = read(dir, 'projects.json').projects;
  assert.deepEqual(projects[0].recipients, [{ personId: 'a', copies: 3, selected: true }, { personId: 'b', copies: 1, selected: true }]);
  const settings = read(dir, 'settings.json');
  assert.equal('checkedIds' in settings, false);
  assert.equal(settings.activeView, projects[0].id);
  assert.deepEqual(settings.nudge, { x: 0.02, y: 0 });
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('settings.pre-projects-')).length, 1);
});

test('migration: empty or unknown ids create no project but the key is removed', () => {
  for (const ids of [[], ['zzz']]) {
    const dir = tmp();
    seedSettings(dir, { checkedIds: ids });
    const s = createStore(dir);
    s.loadProjects();
    assert.equal(s.migrateProjects(PEOPLE).migrated, null);
    assert.ok(!fs.existsSync(path.join(dir, 'projects.json')));
    assert.equal('checkedIds' in read(dir, 'settings.json'), false);
  }
});

test('migration: no settings file or no checkedIds key does nothing', () => {
  const a = tmp();
  const sa = createStore(a); sa.loadProjects();
  assert.equal(sa.migrateProjects(PEOPLE).migrated, null);
  assert.ok(!fs.existsSync(path.join(a, 'settings.json')));
  const b = tmp();
  seedSettings(b, { nudge: { x: 0, y: 0 } });
  const sb = createStore(b); sb.loadProjects();
  sb.migrateProjects(PEOPLE);
  assert.equal(fs.readdirSync(b).filter((n) => n.startsWith('settings.pre-projects-')).length, 0);
});

test('migration: runs once', () => {
  const dir = tmp();
  seedSettings(dir, { checkedIds: ['a'] });
  const s = createStore(dir);
  s.loadProjects();
  assert.ok(s.migrateProjects(PEOPLE).migrated);
  const s2 = createStore(dir);
  s2.loadProjects();
  assert.equal(s2.migrateProjects(PEOPLE).migrated, null);
  assert.equal(read(dir, 'projects.json').projects.length, 1);
});

test('migration: a failure leaves settings untouched, creates no project, and can be retried', () => {
  const dir = tmp();
  const original = JSON.stringify({ checkedIds: ['a'] });
  fs.writeFileSync(path.join(dir, 'settings.json'), original);
  const s = createStore(dir);
  s.loadProjects();
  fs.chmodSync(dir, 0o500);
  const m = s.migrateProjects(PEOPLE);
  fs.chmodSync(dir, 0o700);
  assert.equal(m.migrated, null);
  assert.match(m.error, /Could not move your checked list/);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), original);
  assert.ok(!fs.existsSync(path.join(dir, 'projects.json')));
  const retry = createStore(dir);
  retry.loadProjects();
  assert.ok(retry.migrateProjects(PEOPLE).migrated);
});
