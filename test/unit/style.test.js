/* Tier 3: design-token tests (palette contrast in both themes, no literals outside tokens.css). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '../../src/renderer');
const tokens = fs.readFileSync(path.join(RENDERER, 'tokens.css'), 'utf8');

function vars(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const darkBlock = tokens.match(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n  \}/)[1];
const light = vars(rootBlock);
const dark = { ...light, ...vars(darkBlock) };

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

const TEXT_PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'accent-tint'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'accent-tint'],
  ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ['warning', 'warning-bg'], ['warning', 'bg'], ['danger', 'danger-bg'], ['danger', 'bg'],
  ['success', 'success-bg'], ['success', 'bg'],
  ['ink', 'paper'],
];
const UI_PAIRS = [['border-strong', 'bg'], ['border-strong', 'surface'], ['focus', 'bg'], ['focus', 'surface'], ['accent', 'bg']];

for (const [theme, t] of [['light', light], ['dark', dark]]) {
  test(`${theme}: every text pair is at least 4.5:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = ratio(t[`color-${fg}`], t[`color-${bg}`]);
      assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
  });
  test(`${theme}: control outlines, focus ring, and accent are at least 3:1`, () => {
    for (const [fg, bg] of UI_PAIRS) {
      const r = ratio(t[`color-${fg}`], t[`color-${bg}`]);
      assert.ok(r >= 3, `${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
  });
}

test('the preview paper stays white with black ink in both themes', () => {
  for (const t of [light, dark]) { assert.equal(t['color-paper'], '#FFFFFF'); assert.equal(t['color-ink'], '#000000'); }
});

test('both themes define every token', () => {
  for (const k of Object.keys(light).filter((k) => k.startsWith('color-'))) assert.ok(dark[k], k);
});

// ---- lint: no literals outside tokens.css ----
const CSS_FILES = fs.readdirSync(RENDERER).filter((f) => f.endsWith('.css') && f !== 'tokens.css');

test('no hex colors or rgb()/rgba() outside tokens.css', () => {
  for (const f of CSS_FILES) {
    const css = fs.readFileSync(path.join(RENDERER, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), `${f} has a hex color`);
    assert.ok(!/rgba?\(/.test(css), `${f} has rgb()/rgba()`);
  }
});

test('no px font sizes or px spacing outside tokens.css (only 0 and 1px hairlines)', () => {
  const props = /(font-size|padding[\w-]*|margin[\w-]*|gap|width|height|min-width|max-width|min-height|top|left|right|bottom|border-radius|outline-offset):\s*([^;{}]+);/g;
  const bad = [];
  for (const f of CSS_FILES) {
    const css = fs.readFileSync(path.join(RENDERER, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(props)) {
      const value = m[2].replace(/var\([^)]*\)/g, '');
      for (const px of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) if (!['0', '1'].includes(px[1])) bad.push(`${f}: ${m[1]}: ${m[2].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});
