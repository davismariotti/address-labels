/* Settings model: alignment nudge (clamped) and the active view. Pure (UMD).
   Checked ids moved into projects (see projects.js); legacy `checkedIds` is only read by migration. */
(function (root, factory) {
  const geo = typeof module === 'object' && module.exports ? require('./geometry.js') : root.Shared;
  if (typeof module === 'object' && module.exports) module.exports = factory(geo);
  else root.Shared = Object.assign(root.Shared || {}, factory(geo));
})(typeof self !== 'undefined' ? self : this, function (geo) {
  const { NUDGE_LIMIT } = geo;

  /** Parse a nudge field. Returns {ok, value} or {ok:false, error}. */
  function parseNudge(text) {
    const s = String(text == null ? '' : text).trim();
    if (s === '' || !Number.isFinite(Number(s))) return { ok: false, error: 'Use a value between -0.25 and 0.25 in' };
    const n = Number(s);
    if (n < -NUDGE_LIMIT || n > NUDGE_LIMIT) return { ok: false, error: 'Use a value between -0.25 and 0.25 in' };
    return { ok: true, value: Math.round(n * 1000) / 1000 };
  }

  /** Normalise parsed settings; invalid input gives defaults. `fallback` is true if anything was replaced. */
  function normalizeSettings(raw) {
    const out = { nudge: { x: 0, y: 0 }, activeView: 'book', printScope: 'sheet' };
    let fallback = false;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings: out, fallback: true };
    for (const axis of ['x', 'y']) {
      const v = raw.nudge && raw.nudge[axis];
      const r = parseNudge(v);
      if (r.ok) out.nudge[axis] = r.value; else if (v !== undefined) fallback = true;
    }
    if (typeof raw.activeView === 'string' && raw.activeView) out.activeView = raw.activeView;
    else if (raw.activeView !== undefined) fallback = true;
    if (raw.printScope === 'sheet' || raw.printScope === 'all') out.printScope = raw.printScope;
    else if (raw.printScope !== undefined) fallback = true;
    return { settings: out, fallback };
  }

  return { parseNudge, normalizeSettings };
});
