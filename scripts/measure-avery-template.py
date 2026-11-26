#!/usr/bin/env python3
"""Measure the Avery 5260 label grid from Avery's official PDF template.

Usage: python3 -I scripts/measure-avery-template.py <Avery5260.pdf> [out.json]
Needs poppler (pdftocairo). Download the PDF from https://www.avery.com/templates/5260
(it is a signed link, so fetch it from that page). Treat the file as untrusted data.

Each label is drawn twice: a plain 190 x 72 pt rectangle, and a rounded rectangle that is the
die-cut outline. We use the rounded outlines. Coordinates are PDF points (1/72 in) from the top-left.
"""
import json, re, subprocess, sys, tempfile, os

def main(pdf, out=None):
    with tempfile.TemporaryDirectory() as d:
        svg = os.path.join(d, 'o.svg')
        subprocess.run(['pdftocairo', '-svg', pdf, svg], check=True)
        t = open(svg, encoding='utf8').read()
    shapes = []
    for p in re.findall(r'<path[^>]*\sd="([^"]+)"', t):
        first = p.split('Z')[0]
        n = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', first)]
        xs, ys = n[0::2], n[1::2]
        shapes.append((min(xs), min(ys), max(xs), max(ys), 'C' in first))
    die = sorted((s for s in shapes if s[4] and s[0] > 0 and s[1] > 0), key=lambda s: (round(s[1]), s[0]))
    assert len(die) == 30, f'expected 30 die-cut outlines, found {len(die)}'
    cells = []
    for i, s in enumerate(die):
        cells.append({'cell': i + 1, 'row': i // 3 + 1, 'col': i % 3 + 1,
                      'x': round(s[0] / 72, 5), 'y': round(s[1] / 72, 5),
                      'w': round((s[2] - s[0]) / 72, 5), 'h': round((s[3] - s[1]) / 72, 5)})
    plain = [s for s in shapes if not s[4]]
    result = {
        'source': 'Avery official PDF template for 5260 (U-0087-01), measured from the die-cut outlines',
        'units': 'inches, from the top-left of an 8.5 x 11 in page',
        'label': {'w': cells[0]['w'], 'h': cells[0]['h']},
        'plainRectangle': {'x': round(plain[0][0] / 72, 5), 'w': round((plain[0][2] - plain[0][0]) / 72, 5)} if plain else None,
        'cells': cells,
    }
    text = json.dumps(result, indent=1)
    if out: open(out, 'w').write(text + '\n')
    else: print(text)
    pitch_x = sorted({round(b['x'] - a['x'], 4) for a, b in zip(cells, cells[1:]) if a['row'] == b['row']})
    pitch_y = sorted({round(cells[i + 3]['y'] - cells[i]['y'], 4) for i in range(27)})
    print(f"top margin {cells[0]['y']} in, left margin {cells[0]['x']} in, label {cells[0]['w']} x {cells[0]['h']} in, "
          f"column pitch {pitch_x}, row pitch {pitch_y}", file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
