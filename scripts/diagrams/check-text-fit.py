#!/usr/bin/env python3
"""Text-fit check for Diagram Design HTML diagrams (SmartBook thesis workflow).

Renders the diagram in Playwright Chromium and reports:
  * any <text> that overflows the plate/note/node rect it sits on (cut-off text),
  * any text outside the 40px safe margin of the viewBox,
  * overlapping opaque label plates.
It also prints the font sizes and families actually used. With --word-png it saves a
PNG of the SVG at 605px wide (= 16 cm in Word at 96 dpi) to check legibility when
the figure is inserted into the report.

Usage: python scripts/diagrams/check-text-fit.py <diagram.html> [--word-png out.png]
Exit code: 0 clean, 1 problems found. Needs the Python `playwright` package and its
Chromium (on this machine: `python`, not the `python3` alias).
"""
import sys, json, pathlib
from playwright.sync_api import sync_playwright

JS = r"""
() => {
  const svg = document.querySelector('svg');
  const vb = svg.viewBox.baseVal;
  const rects = [...svg.querySelectorAll('rect')].filter(r => r.getAttribute('width') !== '100%').map((r, i) => {
    const b = r.getBBox(); return {i, x: b.x, y: b.y, w: b.width, h: b.height, fill: r.getAttribute('fill') || '', stroke: r.getAttribute('stroke') || ''};
  });
  const texts = [...svg.querySelectorAll('text')].map(t => {
    const b = t.getBBox(); return {s: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height, size: +t.getAttribute('font-size'), fam: getComputedStyle(t).fontFamily};
  });
  return {vb: {w: vb.width, h: vb.height}, rects, texts};
}
"""

def contains(r, t, tol=0.5):
    return t["x"] >= r["x"] - tol and t["y"] >= r["y"] - tol and t["x"] + t["w"] <= r["x"] + r["w"] + tol and t["y"] + t["h"] <= r["y"] + r["h"] + tol

def main():
    src = pathlib.Path(sys.argv[1]).resolve()
    word_png = sys.argv[sys.argv.index("--word-png") + 1] if "--word-png" in sys.argv else None
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1400, "height": 1000})
        pg.goto(src.as_uri()); pg.wait_for_load_state("load")
        d = pg.evaluate(JS)
        if word_png:
            pg2 = b.new_page(viewport={"width": 700, "height": 900}, device_scale_factor=1)
            pg2.goto(src.as_uri())
            pg2.add_style_tag(content="svg{min-width:0!important;max-width:none!important;width:605px!important} body{padding:0;display:block} .frame{max-width:none}")
            pg2.locator("svg").first.screenshot(path=word_png)
        b.close()
    problems = []
    W, H = d["vb"]["w"], d["vb"]["h"]
    for t in d["texts"]:
        if t["x"] < 40 - 0.5 or t["y"] < 0 or t["x"] + t["w"] > W - 40 + 0.5 or t["y"] + t["h"] > H:
            problems.append(f"outside 40px margin/viewBox: {t['s']!r}")
        cx, cy = t["x"] + t["w"] / 2, t["y"] + t["h"] / 2
        hosts = [r for r in d["rects"] if r["w"] >= 20 and r["x"] <= cx <= r["x"] + r["w"] and r["y"] <= cy <= r["y"] + r["h"]]
        if not hosts:
            continue  # free text (legend)
        host = min(hosts, key=lambda r: r["w"] * r["h"])
        if not contains(host, t):
            problems.append(f"text overflows its plate: {t['s']!r} text=({t['x']:.1f},{t['y']:.1f},{t['w']:.1f}x{t['h']:.1f}) plate=({host['x']},{host['y']},{host['w']}x{host['h']})")
    plates = [r for r in d["rects"] if r["fill"] in ("#ffffff",) and not r["stroke"] and r["h"] <= 80 and r["w"] < 300]
    for i, a in enumerate(plates):
        for bb in plates[i + 1:]:
            if a["x"] < bb["x"] + bb["w"] and bb["x"] < a["x"] + a["w"] and a["y"] < bb["y"] + bb["h"] and bb["y"] < a["y"] + a["h"]:
                if (a["x"], a["y"], a["w"], a["h"]) == (bb["x"], bb["y"], bb["w"], bb["h"]):
                    continue  # node mask + node box pair
                problems.append(f"label plates overlap: {a} / {bb}")
    fams = sorted({t["fam"] for t in d["texts"]})
    sizes = sorted({t["size"] for t in d["texts"]})
    print(json.dumps({"file": src.name, "texts": len(d["texts"]), "font_sizes": sizes, "families": fams, "problems": problems}, ensure_ascii=False, indent=1))
    sys.exit(1 if problems else 0)

main()
