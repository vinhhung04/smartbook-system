"""Generate every SmartBook logo SVG from one geometry source.

    python assets/branding/scripts/build_svgs.py

Needs fontTools (pip install fonttools) and the Fraunces SemiBold TTF that the
mobile app already ships (@expo-google-fonts/fraunces). The wordmark is outlined
to paths so the files render without the font; wordmark-editable.svg keeps live
text for edits. Glyph offsets come from wordmark-kerning.json, measured from the
browser's own kerned layout of the word (see render.cjs --measure).
"""
import glob
import json
import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
LOGO = os.path.join(ROOT, 'logo')
SOURCE = os.path.join(ROOT, 'source')

TOKENS = json.load(open(os.path.join(ROOT, 'brand-tokens.json'), encoding='utf-8'))['color']
INK, NIGHT, INDIGO = TOKENS['ink']['value'], TOKENS['night']['value'], TOKENS['indigo']['value']
MIST, LAMP, PAPER = TOKENS['mist']['value'], TOKENS['lamp']['value'], TOKENS['paper']['value']

# --- Symbol --------------------------------------------------------------------
# 48-unit grid. Two books stacked spine-out / spine-in (the way stock is piled so
# the stack stays level). Book height H = 16.5, spine radius R = H / 2, gap and
# page slot share one stroke unit U = 3. Each page slot is R long, so it ends on
# the axis of the other book's spine arc.
H, R, U = 16.5, 8.25, 3.0
X0, X1, Y0 = 9.0, 39.0, 6.0
TOP = (f'M{X0 + R:g} {Y0:g}H{X1:g}V{Y0 + (H - U) / 2:g}H{X1 - R:g}V{Y0 + (H + U) / 2:g}H{X1:g}'
       f'V{Y0 + H:g}H{X0 + R:g}A{R:g} {R:g} 0 0 1 {X0 + R:g} {Y0:g}Z')
Y2 = Y0 + H + U
BOTTOM = (f'M{X0:g} {Y2:g}H{X1 - R:g}A{R:g} {R:g} 0 0 1 {X1 - R:g} {Y2 + H:g}H{X0:g}'
          f'V{Y2 + (H + U) / 2:g}H{X0 + R:g}V{Y2 + (H - U) / 2:g}H{X0:g}Z')
SYMBOL_D = TOP + BOTTOM
MARK_BOX = (X0, Y0, X1 - X0, 2 * H + U)  # 30 x 36 inside the 48 grid


def font_path(family='fraunces', style='600SemiBold', file='Fraunces_600SemiBold.ttf'):
    hits = glob.glob(os.path.join(REPO, 'node_modules', '.pnpm', f'@expo-google-fonts+{family}@*', 'node_modules',
                                  '@expo-google-fonts', family, style, file))
    if not hits:
        sys.exit(f'{file} not found; run pnpm install first.')
    return hits[0]


def plain_text(text, size, ttf):
    """Outline a short caption from advance widths (no kerning; fine for UI-face captions)."""
    font = TTFont(ttf)
    glyphs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font['hmtx']
    scale = size / font['head'].unitsPerEm
    x, parts = 0.0, []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs, ntos=lambda v: f'{round(v, 2):g}')
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        parts.append(pen.getCommands())
        x += hmtx[name][0] * scale
    return ''.join(parts), x


def wordmark(cap):
    """Outlined 'SmartBook' (baseline at y=0) and its ink bounds (xMin, yMin, xMax, yMax)."""
    font = TTFont(font_path())
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    kern = json.load(open(os.path.join(SOURCE, 'wordmark-kerning.json'), encoding='utf-8'))
    em = font['head'].unitsPerEm
    scale = cap / font['OS/2'].sCapHeight
    px_to_units = em / kern['fontSizePx']
    parts, bounds = [], BoundsPen(glyphs)
    for ch, x_px in zip(kern['text'], kern['offsetsPx']):
        pen = SVGPathPen(glyphs, ntos=lambda v: f'{round(v, 2):g}')
        matrix = (scale, 0, 0, -scale, x_px * px_to_units * scale, 0)
        glyphs[cmap[ord(ch)]].draw(TransformPen(pen, matrix))
        glyphs[cmap[ord(ch)]].draw(TransformPen(bounds, matrix))
        parts.append(pen.getCommands())
    return ''.join(parts), bounds.bounds


def svg(w, h, body, title, view=None):
    view = view or f'0 0 {w:g} {h:g}'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{w:g}" height="{h:g}" '
            f'role="img" aria-labelledby="t">\n  <title id="t">{title}</title>\n{body}\n</svg>\n')


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def main():
    cap = 20.0
    word_d, (wx0, _, wx1, _) = wordmark(cap)

    # Symbol: tight 30 x 36 artboard is awkward for icons, so ship it on the 48 grid.
    for name, color in [('ink', INK), ('indigo', INDIGO), ('mist', MIST), ('white', PAPER), ('black', '#000000')]:
        write(os.path.join(LOGO, f'smartbook-symbol-{name}.svg'),
              svg(48, 48, f'  <path fill="{color}" d="{SYMBOL_D}"/>', 'SmartBook'))

    # Horizontal lockup: mark 36 tall, ink gap = R, cap height 20 centred on the mark.
    pad = R  # clear space on every side = one spine radius
    mark_x, mark_y = pad, pad
    text_x = mark_x + MARK_BOX[2] + R - wx0
    baseline = mark_y + MARK_BOX[3] / 2 + cap / 2
    hw, hh = text_x + wx1 + pad, MARK_BOX[3] + 2 * pad
    for name, mark_c, word_c in [('light', INK, INK), ('dark', MIST, PAPER),
                                 ('mono-black', '#000000', '#000000'), ('mono-white', PAPER, PAPER)]:
        body = (f'  <path fill="{mark_c}" transform="translate({mark_x - X0:g} {mark_y - Y0:g})" d="{SYMBOL_D}"/>\n'
                f'  <path fill="{word_c}" transform="translate({text_x:g} {baseline:g})" d="{word_d}"/>')
        write(os.path.join(LOGO, f'smartbook-horizontal-{name}.svg'), svg(hw, hh, body, 'SmartBook'))

    # Stacked lockup: mark above, word centred below, gap = R.
    s_cap = 16.0
    s_word_d, (sx0, sy0, sx1, sy1) = wordmark(s_cap)
    sw = max(MARK_BOX[2], sx1 - sx0) + 2 * pad
    s_mark_x = (sw - MARK_BOX[2]) / 2
    s_base = pad + MARK_BOX[3] + R - sy0  # ink top of the word sits R below the mark
    sh = s_base + sy1 + pad
    for name, mark_c, word_c in [('light', INK, INK), ('dark', MIST, PAPER),
                                 ('mono-black', '#000000', '#000000'), ('mono-white', PAPER, PAPER)]:
        body = (f'  <path fill="{mark_c}" transform="translate({s_mark_x - X0:g} {pad - Y0:g})" d="{SYMBOL_D}"/>\n'
                f'  <path fill="{word_c}" transform="translate({(sw - (sx1 - sx0)) / 2 - sx0:g} {s_base:g})" d="{s_word_d}"/>')
        write(os.path.join(LOGO, f'smartbook-stacked-{name}.svg'), svg(sw, sh, body, 'SmartBook'))

    # App icon / favicon tile: lamp mark on ink. Mark scaled so it fills 56% of the
    # tile height, inside Android's 66% adaptive safe circle and iOS's grid.
    def tile(size, radius, mark_color=LAMP, bg=INK, mark_ratio=0.56):
        k = size * mark_ratio / MARK_BOX[3]
        tx = size / 2 - (X0 + MARK_BOX[2] / 2) * k
        ty = size / 2 - (Y0 + MARK_BOX[3] / 2) * k
        rect = f'  <rect width="{size:g}" height="{size:g}" rx="{radius:g}" fill="{bg}"/>\n' if bg else ''
        return rect + f'  <path fill="{mark_color}" transform="translate({tx:g} {ty:g}) scale({k:g})" d="{SYMBOL_D}"/>'

    write(os.path.join(LOGO, 'smartbook-app-icon.svg'), svg(1024, 1024, tile(1024, 0), 'SmartBook'))
    write(os.path.join(LOGO, 'smartbook-app-icon-rounded.svg'), svg(1024, 1024, tile(1024, 228), 'SmartBook'))
    # Favicon: a fuller mark (68%) on a softly rounded tile reads best at 16 px.
    write(os.path.join(LOGO, 'smartbook-favicon.svg'), svg(32, 32, tile(32, 7, mark_ratio=0.68), 'SmartBook'))
    # Android adaptive layers (108 dp canvas; foreground mark inside the 66 dp safe zone).
    write(os.path.join(LOGO, 'android-foreground.svg'), svg(1024, 1024, tile(1024, 0, bg=None, mark_ratio=0.36), 'SmartBook'))
    write(os.path.join(LOGO, 'android-monochrome.svg'), svg(1024, 1024, tile(1024, 0, mark_color='#000000', bg=None, mark_ratio=0.36), 'SmartBook'))
    write(os.path.join(LOGO, 'splash-mark.svg'), svg(1024, 1024, tile(1024, 0, bg=None, mark_ratio=0.9), 'SmartBook'))

    # Open Graph / social card, 1200 x 630: lamp mark and word on Night, one caption line.
    og_k = 7.0  # mark 252 tall
    og_word_d, _ = wordmark(78.0)
    vn = font_path('be-vietnam-pro', '500Medium', 'BeVietnamPro_500Medium.ttf')
    line_d, _ = plain_text('Thư viện, kho sách và AI hỗ trợ quyết định — một hệ thống.', 25, vn)
    url_d, _ = plain_text('smartbook.io.vn', 22, vn)
    og_mark_x, og_mark_y = 120, (630 - MARK_BOX[3] * og_k) / 2
    og_text_x = og_mark_x + MARK_BOX[2] * og_k + 72
    write(os.path.join(SOURCE, 'og-image.svg'), svg(1200, 630, (
        f'  <rect width="1200" height="630" fill="{NIGHT}"/>\n'
        f'  <path fill="{LAMP}" transform="translate({og_mark_x - X0 * og_k:g} {og_mark_y - Y0 * og_k:g}) scale({og_k:g})" d="{SYMBOL_D}"/>\n'
        f'  <path fill="{PAPER}" transform="translate({og_text_x:g} 318)" d="{og_word_d}"/>\n'
        f'  <path fill="{MIST}" fill-opacity="0.78" transform="translate({og_text_x:g} 380)" d="{line_d}"/>\n'
        f'  <path fill="{LAMP}" transform="translate({og_text_x:g} 470)" d="{url_d}"/>'), 'SmartBook'))

    # Editable sources: the symbol with its construction, and the word as live text.
    write(os.path.join(SOURCE, 'symbol.svg'), svg(48, 48, (
        f'  <!-- 48 grid. Book height {H:g}, spine radius {R:g}, gap = page slot = {U:g}. -->\n'
        f'  <path fill="{INK}" d="{SYMBOL_D}"/>'), 'SmartBook symbol'))
    write(os.path.join(SOURCE, 'wordmark-editable.svg'), svg(hw, hh, (
        f'  <!-- Live text: needs Fraunces SemiBold (SIL OFL 1.1) installed. -->\n'
        f'  <path fill="{INK}" transform="translate({mark_x - X0:g} {mark_y - Y0:g})" d="{SYMBOL_D}"/>\n'
        f'  <text x="{text_x:g}" y="{baseline:g}" fill="{INK}" font-family="Fraunces" font-weight="600" '
        f'font-size="{cap * 2000 / 1400:g}" letter-spacing="-0.02em">SmartBook</text>'), 'SmartBook'))

    # Shared geometry for the React and React Native components.
    json.dump({'viewBox': '0 0 48 48', 'symbol': SYMBOL_D,
               'horizontal': {'viewBox': f'0 0 {hw:g} {hh:g}', 'markTransform': f'translate({mark_x - X0:g} {mark_y - Y0:g})',
                              'wordTransform': f'translate({text_x:g} {baseline:g})', 'word': word_d}},
              open(os.path.join(SOURCE, 'geometry.json'), 'w', encoding='utf-8'), indent=2)
    print('symbol', SYMBOL_D)
    print('horizontal', f'{hw:g}x{hh:g}', 'stacked', f'{sw:g}x{sh:g}')


if __name__ == '__main__':
    main()
