import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const svgDir = join(root, 'icons');
const pngDir = join(root, 'public/icons');
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
    <path d="M34 102 L64 26 L94 102 M45 76 H83" fill="none" stroke="#ffffff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${badge}
</svg>
`;
}

const variants = {
  icon: { svg: { background: BRAND }, sizes: [16, 32, 48, 128] },
  connected: { svg: { background: BRAND, dot: GREEN }, sizes: [16, 32] },
  disconnected: { svg: { background: BRAND, dot: OFFLINE }, sizes: [16, 32] },
};

mkdirSync(svgDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'icons-'));

try {
  for (const [name, { svg, sizes }] of Object.entries(variants)) {
    const source = iconSvg(svg);
    writeFileSync(join(svgDir, `${name}.svg`), source);
    for (const size of sizes) {
      const html = join(work, `${name}-${size}.html`);
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
        `--screenshot=${join(pngDir, `${name}-${size}.png`)}`,
        `file://${html}`,
      ], { stdio: 'ignore' });
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
