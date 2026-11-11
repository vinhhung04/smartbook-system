# SmartBook brand identity

The source of truth for the SmartBook logo, colors and app icons. Open
[`guidelines/index.html`](guidelines/index.html) in a browser for the full brand
guidelines (Vietnamese): meaning, construction, concept study, variants, color,
type, clear space, misuse, favicon, header, sidebar and app icon previews.
`guidelines/preview-full.png` is a full-page capture for reports.

## The mark

Two books seen edge-on, stacked spine-out / spine-in (how stock is piled so it
stays level), forming the S of SmartBook, and with their two stacked blocks,
the bowls of a B. On a 48-unit grid: book height 16.5, spine radius 8.25, gap
and page slot 3. Each page slot is one spine radius long and ends on the axis of
the other book's spine arc.

| Color  | HEX       | Use                                              |
|--------|-----------|--------------------------------------------------|
| Ink    | `#1D1A4A` | Primary. Logo on light; app icon tile            |
| Indigo | `#4338CA` | Secondary. UI primary (links, buttons, focus)    |
| Lamp   | `#F6DFB4` | Accent. Symbol on Ink (icon, favicon, splash)    |
| Night  | `#14123A` | Splash, Open Graph, dark brand surfaces          |
| Mist   | `#E6E8FF` | Symbol on dark UI                                |

Wordmark: Fraunces SemiBold, tracking −0.02em, outlined to paths.

## Layout

```
brand-tokens.json        colors + type, machine-readable
source/                  symbol.svg, wordmark-editable.svg (live text), og-image.svg,
                         geometry.json (paths used by the React components), kerning
logo/                    every SVG variant (horizontal, stacked, symbol; light, dark, mono;
                         favicon, app icon, Android layers, splash mark)
png/                     transparent PNG exports, favicon.ico, app icon, OG image
concepts/                the three concept sketches (A, B selected, C) + rejected exploration
guidelines/              brand guidelines page + full-page preview
scripts/                 build pipeline
```

## Rebuild

```bash
python assets/branding/scripts/build_svgs.py   # SVGs from geometry (needs fonttools)
node   assets/branding/scripts/render.cjs       # PNGs via Playwright + Microsoft Edge
python assets/branding/scripts/sync_apps.py     # favicon.ico, copies into apps/web/public and apps/mobile/assets (needs Pillow)
```

If the geometry changes, also update the path constants in
`apps/web/src/components/brand-logo.tsx` and `apps/mobile/src/components/BrandMark.tsx`
from `source/geometry.json`, and re-run the page generation for `guidelines/index.html`.

## Where it is used

- Web: `BrandLogo` (`apps/web/src/components/brand-logo.tsx`) in the public header,
  customer and staff sign-in, customer header and the staff sidebar; `favicon.ico`,
  `favicon.svg`, `apple-touch-icon.png`, `site.webmanifest`, `og-image.png` in `apps/web/public`.
- Mobile: `BrandMark` on the sign-in screen; `icon.png`, `android-icon-*.png`,
  `splash-icon.png`, `favicon.png` in `apps/mobile/assets`.

## Provenance and limits

- The symbol is drawn from rectangles and circular arcs in `build_svgs.py`. No icon
  library, stock or AI-generated artwork was used.
- Fraunces (The Fraunces Project Authors) and Be Vietnam Pro are SIL Open Font
  License 1.1, which allows use in logos. Inter and JetBrains Mono (UI) are OFL too.
- Tools: Python fontTools and Pillow, Playwright driving Microsoft Edge.
- Similarity check was text search only. No reverse-image search (Google Lens,
  TinEye) or WIPO Global Brand Database figurative search was run. The name
  "SmartBook" is already in use: McGraw Hill has a SMARTBOOK filing for adaptive
  learning software (US), and Smartbook AG uses it for hardware. This is not a
  clearance opinion. Before registering in Viet Nam, search IP Viet Nam's WIPO
  Publish database (Nice classes 9, 35, 41, 42), ask an IP agent for a word and
  figurative search, then file with the Intellectual Property Office of Viet Nam.
