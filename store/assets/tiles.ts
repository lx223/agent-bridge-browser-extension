import { join } from 'node:path';
import type { Browser } from 'playwright';
import { BACKGROUND, documentHtml, fontStack, GROUP_COLORS, ICON_URI, PRODUCT_NAME, windowCard, type Size } from './frame.ts';
import { escapeHtml } from './html.ts';
import { renderStill } from './render.ts';

export const SMALL_TILE: Size = { width: 440, height: 280 };
export const MARQUEE: Size = { width: 1400, height: 560 };
export const STORE_ICON: Size = { width: 128, height: 128 };
const STORE_ICON_ARTWORK = 96;
const MARQUEE_GROUPS = [
  { color: GROUP_COLORS.blue, tabs: [78, 52] },
  { color: GROUP_COLORS.purple, tabs: [58, 70] },
  { color: GROUP_COLORS.orange, tabs: [66, 48] },
];

const tileStyles = (size: Size) => `
  body.tile { width: ${size.width}px; height: ${size.height}px; font-family: ${fontStack('en')}; background: ${BACKGROUND}; color: #fff; }
  .small { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 32px; }
  .small img { width: 100px; height: 100px; border-radius: 20px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.4); }
  .small h1 { margin: 24px 0 0; font-size: 36px; line-height: 1.1; font-weight: 700; letter-spacing: -0.01em; }
  .marquee { height: 100%; display: flex; align-items: center; gap: 64px; padding: 0 80px; }
  .marquee .copy { flex: 1; min-width: 0; }
  .marquee .copy img { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.4); }
  .marquee h1 { margin: 28px 0 0; max-height: none; white-space: nowrap; font-size: 52px; line-height: 1.2; font-weight: 700; letter-spacing: -0.015em; }
  .sketch { height: 100%; padding: 20px 26px; display: flex; flex-direction: column; gap: 12px; background: #f8fafc; }
  .sketch .strip { display: flex; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0; }
  .sketch .strip i { height: 22px; border-radius: 8px; }
  .sketch .group { border-inline-start: 4px solid; padding-inline-start: 14px; display: flex; flex-direction: column; gap: 6px; }
  .sketch .group b { width: 110px; height: 12px; border-radius: 6px; margin-bottom: 3px; }
  .sketch .tab { display: flex; align-items: center; gap: 12px; height: 34px; padding: 0 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
  .sketch .tab i { flex: none; width: 18px; height: 18px; border-radius: 5px; }
  .sketch .tab u { height: 10px; border-radius: 5px; background: #cbd5e1; }
  .marquee .window { height: 440px; flex: none; }
  body.icon-page { background: transparent; }
  .icon { width: ${STORE_ICON.width}px; height: ${STORE_ICON.height}px; display: flex; align-items: center; justify-content: center; background: transparent; }
  .icon img { width: ${STORE_ICON_ARTWORK}px; height: ${STORE_ICON_ARTWORK}px; }
`;

const tileDocument = (size: Size, content: string, bodyClass = 'tile') =>
  documentHtml({ languageTag: 'en', layout: { ...size, stageTop: 0 }, content, extraStyles: tileStyles(size) }).replace('<body>', `<body class="${bodyClass}">`);

function smallTile() {
  return tileDocument(SMALL_TILE, `<div class="small"><img src="${ICON_URI}" alt="" /><h1>${escapeHtml(PRODUCT_NAME)}</h1></div>`);
}

function tabGroupsSketch() {
  const chips = MARQUEE_GROUPS.map((group) => `<i style="width: ${40 + group.tabs.length * 14}px; background: ${group.color}"></i>`).join('');
  const groups = MARQUEE_GROUPS.map((group) => {
    const tabs = group.tabs.map((width) => `<div class="tab"><i style="background: ${group.color}"></i><u style="width: ${width}%"></u></div>`).join('');
    return `<div class="group" style="border-color: ${group.color}"><b style="background: ${group.color}"></b>${tabs}</div>`;
  });
  return `<div class="sketch" data-fit><div class="strip">${chips}</div>${groups.join('')}</div>`;
}

function marquee() {
  const window = windowCard({ size: { width: 560, height: 440 }, body: tabGroupsSketch() });
  const copy = `<div class="copy"><img src="${ICON_URI}" alt="" /><h1 data-fit>${escapeHtml(PRODUCT_NAME)}</h1></div>`;
  return tileDocument(MARQUEE, `<div class="marquee">${copy}${window}</div>`);
}

const storeIcon = () => tileDocument(STORE_ICON, `<div class="icon"><img src="${ICON_URI}" alt="" /></div>`, 'icon-page');

export async function renderPromoImages(browser: Browser, directory: string) {
  const images = [
    { file: 'small-promo-tile-440x280.png', size: SMALL_TILE, html: smallTile() },
    { file: 'marquee-promo-tile-1400x560.png', size: MARQUEE, html: marquee() },
    { file: 'store-icon-128.png', size: STORE_ICON, html: storeIcon(), transparent: true },
  ];
  const written: Array<{ file: string; overflowing: string[] }> = [];
  for (const image of images) {
    const file = join(directory, image.file);
    const overflowing = await renderStill(browser, { html: image.html, size: image.size, languageTag: 'en', file, omitBackground: image.transparent });
    written.push({ file, overflowing });
  }
  return written;
}
