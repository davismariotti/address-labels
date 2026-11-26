/* File-backed store for people + settings. Node only. Never overwrites data it could not read. */
const fs = require('node:fs');
const path = require('node:path');
const D = require('../shared/data.js');
const S = require('../shared/settings.js');
const Projects = require('../shared/projects.js');

const BACKUPS_KEPT = 20;
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_FILES_KEPT = 5;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function describeParseError(err, text) {
  const m = /position (\d+)/.exec(err.message);
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return `${err.message} (line ${line}, column ${col})`;
  }
  return err.message;
}

function createStore(dir) {
  const file = path.join(dir, 'addresses.json');
  const settingsFile = path.join(dir, 'settings.json');
  const projectsFile = path.join(dir, 'projects.json');
  const backupDir = path.join(dir, 'backups');
  const logDir = path.join(dir, 'logs');
  /** @type {{status:'unloaded'|'missing'|'ok'|'corrupt'|'readonly', error?:string, skipped:any[]}} */
  const state = { status: 'unloaded', skipped: [] };
  const lastBackup = {};
  /** @type {{status:'unloaded'|'missing'|'ok'|'corrupt'|'readonly', error?:string, skipped:any[], extra:object}} */
  const pstate = { status: 'unloaded', skipped: [], extra: {} };

  // ---------- logging ----------
  function log(level, message) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const f = path.join(logDir, 'app.log');
      try {
        if (fs.statSync(f).size > LOG_MAX_BYTES) {
          for (let i = LOG_FILES_KEPT - 1; i >= 1; i--) {
            const from = i === 1 ? f : path.join(logDir, `app.${i - 1}.log`);
            const to = path.join(logDir, `app.${i}.log`);
            if (fs.existsSync(from)) fs.renameSync(from, to);
          }
          // drop anything beyond the newest N
          for (const name of fs.readdirSync(logDir)) {
            const m = /^app\.(\d+)\.log$/.exec(name);
            if (m && Number(m[1]) >= LOG_FILES_KEPT) fs.rmSync(path.join(logDir, name));
          }
        }
      } catch { /* no log yet */ }
      fs.appendFileSync(f, `${new Date().toISOString()} [${level}] ${message}\n`);
    } catch { /* logging must never throw */ }
  }

  // ---------- people ----------
  function load() {
    state.skipped = [];
    state.error = undefined;
    if (!fs.existsSync(file)) {
      state.status = 'missing';
      return { status: 'missing', people: [], skipped: [] };
    }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      state.status = 'corrupt'; state.error = `Could not read ${path.basename(file)}: ${e.message}`;
      return { status: 'corrupt', error: state.error, people: [], skipped: [] };
    }
    let raw;
    try { raw = JSON.parse(text); } catch (e) {
      state.status = 'corrupt'; state.error = describeParseError(e, text);
      log('error', `addresses.json parse error: ${state.error}`);
      return { status: 'corrupt', error: state.error, people: [], skipped: [] };
    }
    if (!Array.isArray(raw)) {
      state.status = 'corrupt'; state.error = 'Expected a list of people at the top level.';
      return { status: 'corrupt', error: state.error, people: [], skipped: [] };
    }
    const { people, skipped } = D.validateEntries(raw);
    state.skipped = skipped;
    const migrated = D.migrateIds(people);
    state.status = 'ok';
    if (migrated.changed) {
      try {
        fs.copyFileSync(file, path.join(dir, `addresses.pre-migration-${stamp()}.json`));
        atomicWrite(file, JSON.stringify([...migrated.people, ...skipped.map((s) => s.raw)], null, 2));
      } catch (e) {
        state.status = 'readonly';
        state.error = `Could not add ids to ${path.basename(file)}: ${e.message}. Opened read-only; your file is unchanged.`;
        log('error', state.error);
      }
    }
    return {
      status: state.status, error: state.error, people: migrated.people,
      skipped: skipped.map((s) => ({ index: s.index, reason: s.reason })),
    };
  }

  /** Copy `src` into backups/<prefix>-<timestamp>.json and keep the newest BACKUPS_KEPT per prefix. */
  function backupOf(src, prefix) {
    if (!fs.existsSync(src)) return null;
    fs.mkdirSync(backupDir, { recursive: true });
    // Names are millisecond timestamps; never reuse one, or a burst of saves would overwrite an older backup.
    let name = `${prefix}-${stamp()}.json`;
    while (fs.existsSync(path.join(backupDir, name))) name = `${prefix}-${stamp()}-${process.hrtime.bigint()}.json`;
    lastBackup[prefix] = name;
    fs.copyFileSync(src, path.join(backupDir, name));
    for (const old of listBackups(prefix).slice(BACKUPS_KEPT)) fs.rmSync(path.join(backupDir, old.name), { force: true });
    return name;
  }
  const backupNow = () => backupOf(file, 'addresses');

  function listBackups(prefix = 'addresses') {
    if (!fs.existsSync(backupDir)) return [];
    const re = new RegExp(`^${prefix}-.*\\.json$`);
    return fs.readdirSync(backupDir)
      .filter((n) => re.test(n))
      .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  function save(people) {
    if (state.status === 'corrupt' || state.status === 'readonly' || state.status === 'unloaded') {
      return { ok: false, error: state.error || `Not saving: file state is ${state.status}.` };
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      backupNow();
      atomicWrite(file, JSON.stringify([...people, ...state.skipped.map((s) => s.raw)], null, 2));
      state.status = 'ok';
      return { ok: true };
    } catch (e) {
      log('error', `save failed: ${e.message}`);
      return { ok: false, error: `Could not save ${path.basename(file)}: ${e.message}` };
    }
  }

  /** Restore a backup (or the newest valid one). The current file is kept as a backup / broken copy. */
  function restoreBackup(name) {
    const list = listBackups();
    const candidates = name ? list.filter((b) => b.name === name) : list;
    for (const b of candidates) {
      const p = path.join(backupDir, b.name);
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!Array.isArray(raw)) continue;
        if (fs.existsSync(file)) {
          if (state.status === 'corrupt') fs.renameSync(file, path.join(dir, `addresses.broken-${stamp()}.json`));
          else backupNow();
        }
        fs.copyFileSync(p, file);
        return { ok: true, name: b.name, ...load() };
      } catch { /* try the next one */ }
    }
    return { ok: false, error: 'No valid backup found.' };
  }

  // ---------- settings ----------
  function loadSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      const r = S.normalizeSettings(raw);
      return { ...r.settings, notice: r.fallback ? 'Some saved settings were invalid and were reset.' : undefined };
    } catch (e) {
      if (e.code === 'ENOENT') return { ...S.normalizeSettings({}).settings };
      log('warn', `settings.json invalid: ${e.message}`);
      return { ...S.normalizeSettings(null).settings, notice: 'Saved settings could not be read and were reset.' };
    }
  }
  function saveSettings(settings) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      atomicWrite(settingsFile, JSON.stringify({ nudge: settings.nudge, activeView: settings.activeView, printScope: settings.printScope }, null, 2));
      return { ok: true };
    } catch (e) {
      log('error', `settings save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  // ---------- projects ----------
  function loadProjects() {
    pstate.skipped = []; pstate.error = undefined; pstate.extra = {};
    if (!fs.existsSync(projectsFile)) { pstate.status = 'missing'; return { status: 'missing', projects: [], skipped: [] }; }
    let text;
    try { text = fs.readFileSync(projectsFile, 'utf8'); } catch (e) {
      pstate.status = 'corrupt'; pstate.error = `Could not read projects.json: ${e.message}`;
      return { status: 'corrupt', error: pstate.error, projects: [], skipped: [] };
    }
    let raw;
    try { raw = JSON.parse(text); } catch (e) {
      pstate.status = 'corrupt'; pstate.error = describeParseError(e, text);
      log('error', `projects.json parse error: ${pstate.error}`);
      return { status: 'corrupt', error: pstate.error, projects: [], skipped: [] };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.projects)) {
      pstate.status = 'corrupt'; pstate.error = 'Expected an object with a "projects" list.';
      return { status: 'corrupt', error: pstate.error, projects: [], skipped: [] };
    }
    const { projects: _list, ...extra } = raw;
    pstate.extra = extra;
    const { projects, skipped } = Projects.validateProjects(raw.projects);
    pstate.skipped = skipped;
    pstate.status = 'ok';
    return { status: 'ok', projects, skipped: skipped.map((s) => ({ index: s.index, reason: s.reason })) };
  }

  function saveProjects(projects) {
    if (pstate.status === 'corrupt' || pstate.status === 'readonly' || pstate.status === 'unloaded') {
      return { ok: false, error: pstate.error || `Not saving projects: file state is ${pstate.status}.` };
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      backupOf(projectsFile, 'projects');
      atomicWrite(projectsFile, JSON.stringify({ ...pstate.extra, version: 1, projects: [...projects, ...pstate.skipped.map((s) => s.raw)] }, null, 2));
      pstate.status = 'ok';
      return { ok: true };
    } catch (e) {
      log('error', `projects save failed: ${e.message}`);
      return { ok: false, error: `Could not save projects.json: ${e.message}` };
    }
  }

  function restoreProjectsBackup(name) {
    const list = listBackups('projects');
    const candidates = name ? list.filter((b) => b.name === name) : list;
    for (const b of candidates) {
      const p = path.join(backupDir, b.name);
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!raw || !Array.isArray(raw.projects)) continue;
        if (fs.existsSync(projectsFile)) {
          if (pstate.status === 'corrupt') fs.renameSync(projectsFile, path.join(dir, `projects.broken-${stamp()}.json`));
          else backupOf(projectsFile, 'projects');
        }
        fs.copyFileSync(p, projectsFile);
        return { ok: true, name: b.name, ...loadProjects() };
      } catch { /* try the next one */ }
    }
    return { ok: false, error: 'No valid backup found.' };
  }

  /** Drop recipients whose person no longer exists. Saves only when something changed. */
  function pruneOrphans(projects, personIds) {
    const pruned = Projects.pruneOrphans(projects, personIds);
    const changed = pruned.some((p, i) => p.recipients.length !== projects[i].recipients.length);
    if (changed && (pstate.status === 'ok')) saveProjects(pruned);
    return changed ? pruned : projects;
  }

  /**
   * One-time migration of the old global checklist. Runs when projects.json is missing and settings.json still has a
   * `checkedIds` key. On any failure everything is left as it was and it retries next launch.
   */
  function migrateProjects(people) {
    if (pstate.status !== 'missing') return { migrated: null };
    let raw;
    try { raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return { migrated: null }; }
    if (!raw || typeof raw !== 'object' || !('checkedIds' in raw)) return { migrated: null };
    const project = Projects.migrateChecklist(raw.checkedIds, people);
    let createdProjects = false;
    try {
      fs.copyFileSync(settingsFile, path.join(dir, `settings.pre-projects-${stamp()}.json`));
      if (project) {
        atomicWrite(projectsFile, JSON.stringify({ version: 1, projects: [project] }, null, 2));
        createdProjects = true;
      }
      const next = { ...raw };
      delete next.checkedIds;
      if (project) next.activeView = project.id;
      atomicWrite(settingsFile, JSON.stringify(next, null, 2));
    } catch (e) {
      if (createdProjects) { try { fs.rmSync(projectsFile, { force: true }); } catch { /* ignore */ } }
      const error = `Could not move your checked list into a project: ${e.message}. It will be tried again next time.`;
      log('error', error);
      return { migrated: null, error };
    }
    return { migrated: project ? project.name : null, projectId: project ? project.id : null };
  }

  return {
    dir, file, state, pstate, load, save, listBackups, backupNow, restoreBackup, loadSettings, saveSettings, log,
    loadProjects, saveProjects, restoreProjectsBackup, pruneOrphans, migrateProjects,
  };
}

module.exports = { createStore, BACKUPS_KEPT, LOG_MAX_BYTES, LOG_FILES_KEPT };
