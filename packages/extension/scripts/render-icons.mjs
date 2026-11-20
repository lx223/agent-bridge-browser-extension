import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const svgDir = join(root, 'icons');
const pngDir = join(root, 'public/icons');
const appIconSetDir = join(root, 'safari-app/AppIcon.appiconset');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const BRAND = '#4f46e5';
const OFFLINE = '#9ca3af';
const GREEN = '#22c55e';

function iconSvg({ background, dot }) {
  const badge = dot
    ? `<circle cx="100" cy="100" r="24" fill="${dot}"/>`
    : '';
  const mask = dot ? ' mask="url(#cut)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <mask id="cut"><rect width="128" height="128" fill="#fff"/><circle cx="100" cy="100" r="32" fill="#000"/></mask>
  </defs>
  <g${mask}>
    <rect x="4" y="4" width="120" height="120" rx="28" fill="${background}"/>
    <path d="${GLYPH}" fill="none" stroke="#ffffff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${badge}
</svg>
`;
}

const GLYPH = 'M34 102 L64 26 L94 102 M45 76 H83';
const APP_ICON_CANVAS = 1024;
const APP_ICON_PLATE = 824;
const APP_ICON_POINT_SIZES = [16, 32, 128, 256, 512];

function appIconSvg() {
  const inset = (APP_ICON_CANVAS - APP_ICON_PLATE) / 2;
  const scale = APP_ICON_PLATE / 120;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${APP_ICON_CANVAS} ${APP_ICON_CANVAS}" width="${APP_ICON_CANVAS}" height="${APP_ICON_CANVAS}">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="${inset}" y="${inset}" width="${APP_ICON_PLATE}" height="${APP_ICON_PLATE}" rx="185" fill="url(#plate)" filter="url(#shadow)"/>
  <g transform="translate(${inset} ${inset}) scale(${scale}) translate(-4 -4)">
    <path d="${GLYPH}" fill="none" stroke="#ffffff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;
}

const variants = {
  icon: { svg: { background: BRAND }, sizes: [16, 32, 48, 128] },
  connected: { svg: { background: BRAND, dot: GREEN }, sizes: [16, 32] },
  disconnected: { svg: { background: BRAND, dot: OFFLINE }, sizes: [16, 32] },
};

function render(work, source, size, output) {
  const html = join(work, `${size}-${output.replace(/[^a-z0-9]/gi, '-')}.html`);
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
  writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:transparent"><img src="${dataUri}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`,
    `--screenshot=${output}`,
    `file://${html}`,
  ], { stdio: 'ignore' });
}

mkdirSync(svgDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });
mkdirSync(appIconSetDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'icons-'));

try {
  for (const [name, { svg, sizes }] of Object.entries(variants)) {
    const source = iconSvg(svg);
    writeFileSync(join(svgDir, `${name}.svg`), source);
    for (const size of sizes) render(work, source, size, join(pngDir, `${name}-${size}.png`));
  }

  const appIcon = appIconSvg();
  writeFileSync(join(svgDir, 'app-icon.svg'), appIcon);
  const images = APP_ICON_POINT_SIZES.flatMap((points) =>
    [1, 2].map((scale) => ({
      size: `${points}x${points}`,
      idiom: 'mac',
      filename: scale === 1 ? `icon_${points}x${points}.png` : `icon_${points}x${points}@2x.png`,
      scale: `${scale}x`,
      pixels: points * scale,
    })),
  );
  for (const { filename, pixels } of images) render(work, appIcon, pixels, join(appIconSetDir, filename));
  writeFileSync(
    join(appIconSetDir, 'Contents.json'),
    `${JSON.stringify({ images: images.map(({ pixels, ...image }) => image), info: { version: 1, author: 'xcode' } }, null, 2)}\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
