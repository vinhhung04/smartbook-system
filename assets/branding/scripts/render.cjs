// Rasterises the brand SVGs with the Playwright install apps/web already has.
//
//   node assets/branding/scripts/render.cjs            render every PNG in jobs below
//   node assets/branding/scripts/render.cjs --measure  print wordmark kerning offsets
//
// Uses Microsoft Edge (channel msedge); set PW_CHANNEL=chromium to use Playwright's own build.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..', '..');
const { chromium } = require(require.resolve('@playwright/test', { paths: [path.join(REPO, 'apps/web')] }));
const L = (f) => path.join(ROOT, 'logo', f);
const OUT = (f) => path.join(ROOT, 'png', f);

// [svg, out, width, height, background] — background null keeps transparency.
const jobs = [
  ...[16, 24, 32, 48, 64, 128, 256, 512, 1024].map((s) => [L('smartbook-symbol-ink.svg'), OUT(`symbol-ink-${s}.png`), s, s, null]),
  [L('smartbook-symbol-mist.svg'), OUT('symbol-mist-512.png'), 512, 512, null],
  [L('smartbook-symbol-white.svg'), OUT('symbol-white-512.png'), 512, 512, null],
  [L('smartbook-symbol-black.svg'), OUT('symbol-black-512.png'), 512, 512, null],
  ...['light', 'dark', 'mono-black', 'mono-white'].map((v) => [L(`smartbook-horizontal-${v}.svg`), OUT(`horizontal-${v}-1200.png`), 1200, null, null]),
  ...['light', 'dark', 'mono-black', 'mono-white'].map((v) => [L(`smartbook-stacked-${v}.svg`), OUT(`stacked-${v}-800.png`), 800, null, null]),
  [L('smartbook-app-icon.svg'), OUT('app-icon-1024.png'), 1024, 1024, null],
  [L('smartbook-app-icon-rounded.svg'), OUT('app-icon-rounded-1024.png'), 1024, 1024, null],
  ...[16, 32, 48, 180, 192, 512].map((s) => [L('smartbook-favicon.svg'), OUT(`favicon-${s}.png`), s, s, null]),
  [L('smartbook-app-icon.svg'), OUT('apple-touch-icon-180.png'), 180, 180, null],
  [L('android-foreground.svg'), OUT('android-foreground-1024.png'), 1024, 1024, null],
  [L('android-monochrome.svg'), OUT('android-monochrome-1024.png'), 1024, 1024, null],
  [L('splash-mark.svg'), OUT('splash-icon-1024.png'), 1024, 1024, null],
  [path.join(ROOT, 'source', 'og-image.svg'), OUT('og-image-1200x630.png'), 1200, 630, null],
];

function svgSize(file) {
  const m = fs.readFileSync(file, 'utf8').match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return [Number(m[1]), Number(m[2])];
}

async function measure(page) {
  fs.copyFileSync(require.resolve('@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf', { paths: [path.join(REPO, 'apps/mobile')] }),
    path.join(ROOT, 'source', '.measure.ttf'));
  const html = path.join(ROOT, 'source', '.measure.html');
  fs.writeFileSync(html, `<style>@font-face{font-family:F;src:url(.measure.ttf)}body{margin:0}
    #t{font:1000px/1 F;letter-spacing:-0.02em;font-kerning:normal;white-space:pre;position:absolute}</style><span id="t">SmartBook</span>`);
  await page.goto('file:///' + html.split(path.sep).join('/'));
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const el = document.getElementById('t');
    const node = el.firstChild;
    const offsetsPx = [...node.textContent].map((_, i) => {
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
      return r.getBoundingClientRect().left;
    });
    return { offsetsPx, widthPx: el.getBoundingClientRect().width };
  });
  fs.rmSync(html); fs.rmSync(path.join(ROOT, 'source', '.measure.ttf'));
  console.log(JSON.stringify(result));
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  if (process.argv.includes('--measure')) {
    await measure(page);
  } else {
    fs.mkdirSync(path.join(ROOT, 'png'), { recursive: true });
    for (const [svg, out, w, hIn, bg] of jobs) {
      const [vw, vh] = svgSize(svg);
      const h = hIn || Math.round((w * vh) / vw);
      await page.setViewportSize({ width: w, height: h });
      const markup = fs.readFileSync(svg, 'utf8').replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}" height="${h}"`);
      await page.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}">${markup}</body></html>`);
      await page.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: w, height: h } });
      console.log(path.relative(REPO, out), `${w}x${h}`);
    }
  }
  await browser.close();
})();
