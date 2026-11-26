/* People model: ids, history, normalization, validation, search, selection. Pure (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = Object.assign(root.Shared || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_COPIES = 99;

  // ---------- text ----------
  function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function normLines(lines) { return lines.map(normText).filter(Boolean); }

  // ---------- address history ----------
  function lineKeys(addr) {
    return Object.keys(addr).filter((k) => /^line\d+$/.test(k)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  }
  function addressLines(addr) { return lineKeys(addr).map((k) => addr[k]); }
  function makeAddress(lines, version) {
    const a = {};
    lines.forEach((l, i) => { a['line' + (i + 1)] = l; });
    a.version = version;
    return a;
  }
  function currentAddress(p) {
    if (!p.address || !p.address.length) return null;
    return p.address.reduce((m, a) => (a.version > m.version ? a : m));
  }
  function currentLines(p) { const a = currentAddress(p); return a ? addressLines(a) : []; }
  function maxVersion(p) { return (p.address || []).reduce((m, a) => Math.max(m, a.version || 0), 0); }

  // ---------- hold: "needs an address update" (a flag on the person, so every project sees it) ----------
  const isHeld = (p) => !!(p && p.hold && p.hold.at);
  function setHold(p, at = new Date().toISOString()) {
    return { ...p, hold: { at } };
  }
  function clearHold(p) {
    if (!p.hold) return p;
    const { hold, ...rest } = p;
    return rest;
  }

  /** "They moved": append a new current address (max+1), keeping history. Also clears a hold: the address was just updated. */
  function moved(p, lines) {
    return clearHold({ ...p, address: [...(p.address || []), makeAddress(normLines(lines), maxVersion(p) + 1)] });
  }
  /** "Fix a typo": change the current address in place, version unchanged. */
  function fixInPlace(p, lines) {
    const cur = currentAddress(p);
    if (!cur) return { ...p, address: [makeAddress(normLines(lines), 1)] };
    return { ...p, address: p.address.map((a) => (a === cur ? makeAddress(normLines(lines), cur.version) : a)) };
  }
  /** "Use this again": copy an old address as the new current (max+1). */
  function useAgain(p, version) {
    const old = (p.address || []).find((a) => a.version === version);
    if (!old) return p;
    return moved(p, addressLines(old));
  }
  /** Previous (non-current) addresses, newest first. */
  function previousAddresses(p) {
    const cur = currentAddress(p);
    return (p.address || []).filter((a) => a !== cur).sort((a, b) => b.version - a.version);
  }

  // ---------- ids / copies ----------
  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return require('crypto').randomUUID();
  }
  function clampCopies(value, previous = 1) {
    const s = String(value == null ? '' : value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return previous;
    const n = Math.round(Number(s));
    if (n < 1) return previous;
    return Math.min(MAX_COPIES, n);
  }
  function copiesOf(p) { return Number.isInteger(p.copies) && p.copies >= 1 ? Math.min(MAX_COPIES, p.copies) : 1; }

  // ---------- validation / migration ----------
  /** Split raw entries into valid people (unknown fields preserved) and skipped ones. */
  function validateEntries(raw) {
    const people = [];
    const skipped = [];
    raw.forEach((e, index) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return skipped.push({ index, reason: 'not an object', raw: e });
      if (typeof e.name !== 'string' || !normText(e.name)) return skipped.push({ index, reason: 'missing name', raw: e });
      if (e.address !== undefined && !Array.isArray(e.address)) return skipped.push({ index, reason: 'address is not a list', raw: e });
      const address = (e.address || []).filter((a) => a && typeof a === 'object');
      people.push({ ...e, address: address.map((a, i) => ({ ...a, version: Number.isInteger(a.version) ? a.version : i + 1 })) });
    });
    return { people, skipped };
  }
  /** Give every person an id. Returns whether anything changed. */
  function migrateIds(people) {
    let changed = false;
    const seen = new Set();
    const out = people.map((p) => {
      if (typeof p.id === 'string' && p.id && !seen.has(p.id)) { seen.add(p.id); return p; }
      changed = true;
      let id = makeId();
      while (seen.has(id)) id = makeId();
      seen.add(id);
      return { ...p, id };
    });
    return { people: out, changed };
  }

  // ---------- search / sort ----------
  function foldText(s) {
    return String(s).normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/[’‘ʼ]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  }
  function personText(p) { return [p.name, ...currentLines(p)].join(' \n '); }
  function matchesQuery(p, query) {
    const q = foldText(normText(query));
    if (!q) return true;
    return foldText(personText(p)).includes(q);
  }
  /** The name used for ordering: a leading "The " is ignored, so "The Alder Family" sorts under A. */
  function sortKey(name) {
    const n = normText(name);
    const stripped = n.replace(/^the\s+(?=\S)/i, '');
    return stripped || n;
  }
  function comparePeople(a, b) { return sortKey(a.name).localeCompare(sortKey(b.name), 'en', { sensitivity: 'base' }); }
  function sortPeople(people) { return [...people].sort(comparePeople); }

  // ---------- selection / labels ----------
  /** One printed label per copy, in list order. */
  function expandLabels(sortedPeople, checkedIds) {
    const out = [];
    for (const p of sortedPeople) {
      if (!checkedIds.has(p.id)) continue;
      const lines = [normText(p.name), ...currentLines(p).map(normText)].filter(Boolean);
      for (let i = 0; i < copiesOf(p); i++) out.push({ id: p.id, lines });
    }
    return out;
  }
  function findExactDuplicate(people, candidate) {
    const key = (p) => [normText(p.name), ...currentLines(p).map(normText)].join('\n');
    const k = key(candidate);
    return people.find((p) => p.id !== candidate.id && key(p) === k) || null;
  }
  function addressSummary(p) {
    const l = currentLines(p);
    return l.length ? l.join(' · ') : '';
  }

  return {
    MAX_COPIES, normText, normLines, lineKeys, addressLines, makeAddress, currentAddress, currentLines,
    maxVersion, isHeld, setHold, clearHold, moved, fixInPlace, useAgain, previousAddresses, makeId, clampCopies, copiesOf,
    validateEntries, migrateIds, foldText, matchesQuery, comparePeople, sortPeople, expandLabels,
    findExactDuplicate, addressSummary, sortKey,
  };
});
