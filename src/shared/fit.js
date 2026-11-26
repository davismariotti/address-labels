/* Deterministic text fitting for labels. Pure: uses a Helvetica width table so the
 * preview, the PDF, and the tests all agree without needing a DOM or canvas. */
(function (root, factory) {
  const geo = typeof module === 'object' && module.exports ? require('./geometry.js') : root.Shared;
  if (typeof module === 'object' && module.exports) module.exports = factory(geo);
  else root.Shared = Object.assign(root.Shared || {}, factory(geo));
})(typeof self !== 'undefined' ? self : this, function (geo) {
  const { GEOMETRY } = geo;

  // Helvetica advance widths per 1000 em (standard AFM values).
  const W = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333,
    '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584,
    '>': 584, '?': 556, '@': 1015, '’': 222, '‘': 222, '“': 333, '”': 333, '–': 556, '—': 1000,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556,
    M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667,
    Y: 667, Z: 611, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
    k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500,
    w: 722, x: 500, y: 500, z: 500,
  };
  for (const d of '0123456789') W[d] = 556;

  function charWidth(ch) {
    if (W[ch] !== undefined) return W[ch];
    const base = ch.normalize('NFD')[0];
    if (/\p{M}/u.test(ch)) return 0;
    return W[base] !== undefined ? W[base] : 556;
  }

  /** Width of a string in inches at a given point size. */
  function textWidthIn(text, pt) {
    let units = 0;
    for (const ch of text) units += charWidth(ch);
    return (units / 1000) * (pt / 72);
  }

  function innerSize(g = GEOMETRY) {
    return { w: g.label.w - 2 * g.padding.x, h: g.label.h - 2 * g.padding.y };
  }

  function fitsAt(lines, pt, g = GEOMETRY) {
    const { w, h } = innerSize(g);
    const widest = Math.max(0, ...lines.map((l) => textWidthIn(l, pt)));
    const height = lines.length * g.lineHeight * (pt / 72);
    return widest <= w + 1e-9 && height <= h + 1e-9;
  }

  /**
   * Fit lines into a label. Shrinks from startPt to floorPt in stepPt steps.
   * status: 'ok' (>= small threshold), 'small' (< smallPt), 'nofit' (does not fit at floor).
   * A 'nofit' label is reported at the floor size and is never truncated here.
   */
  function fitLines(lines, g = GEOMETRY) {
    const { startPt, floorPt, smallPt, stepPt } = g.font;
    for (let pt = startPt; pt >= floorPt - 1e-9; pt -= stepPt) {
      if (fitsAt(lines, pt, g)) return { pt, status: pt < smallPt ? 'small' : 'ok' };
    }
    return { pt: floorPt, status: 'nofit' };
  }

  return { charWidth, textWidthIn, innerSize, fitsAt, fitLines };
});
