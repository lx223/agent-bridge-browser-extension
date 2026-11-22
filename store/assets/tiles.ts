import { join } from 'node:path';
import type { Browser } from 'playwright';
import { BACKGROUND, documentHtml, FONT_STACK, ICON_URI, PRODUCT_NAME, tabGroupsBody, windowCard, type Size } from './frame.ts';
import { escapeHtml } from './html.ts';
import { topics, type Locale } from './locale.ts';
import { renderStill } from './render.ts';
import { TOPIC_COLORS } from './scenes.ts';

export const SMALL_TILE: Size = { width: 440, height: 280 };
export const MARQUEE: Size = { width: 1400, height: 560 };
export const STORE_ICON: Size = { width: 128, height: 128 };
const STORE_ICON_ARTWORK = 96;
const MARQUEE_TABS_PER_GROUP = 2;

const tileStyles = (size: Size) => `
  body.tile { width: ${size.width}px; height: ${size.height}px; font-family: ${FONT_STACK}; background: ${BACKGROUND}; color: #fff; }
  .small { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 32px; }
  .small img { width: 84px; height: 84px; border-radius: 20px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.4); }
  .small h1 { margin: 22px 0 0; font-size: 34px; line-height: 1.1; font-weight: 700; letter-spacing: -0.01em; }
  .small p { margin: 10px 0 0; font-size: 17px; line-height: 1.35; color: #e0e7ff; max-height: 46px; overflow: hidden; text-wrap: balance; }
  .marquee { height: 100%; display: flex; align-items: center; gap: 64px; padding: 0 80px; }
  .marquee .copy { flex: 1; min-width: 0; }
  .marquee .copy img { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.4); }
  .marquee h1 { margin: 28px 0 0; font-size: 56px; line-height: 1.1; font-weight: 700; letter-spacing: -0.015em; }
  .marquee p { margin: 18px 0 0; font-size: 24px; line-height: 1.4; color: #e0e7ff; max-height: 101px; overflow: hidden; text-wrap: balance; }
  .marquee .window { height: 440px; flex: none; }
  body.icon-page { background: transparent; }
  .icon { width: ${STORE_ICON.width}px; height: ${STORE_ICON.height}px; display: flex; align-items: center; justify-content: center; background: transparent; }
  .icon img { width: ${STORE_ICON_ARTWORK}px; height: ${STORE_ICON_ARTWORK}px; }
`;

const tileDocument = (size: Size, content: string, bodyClass = 'tile') =>
  documentHtml({ languageTag: 'en', layout: { ...size, stageTop: 0 }, content, extraStyles: tileStyles(size) }).replace('<body>', `<body class="${bodyClass}">`);

function smallTile(locale: Locale) {
  return tileDocument(SMALL_TILE, `<div class="small"><img src="${ICON_URI}" alt="" /><h1>${escapeHtml(PRODUCT_NAME)}</h1><p data-fit>${escapeHtml(locale.strings.video.tagline)}</p></div>`);
}

function marquee(locale: Locale) {
  const text = locale.strings.tabs;
  const groups = topics.map((topic) => ({ title: text.groups[topic], color: TOPIC_COLORS[topic], tabs: text.pages[topic].slice(0, MARQUEE_TABS_PER_GROUP) }));
  const window = windowCard({ size: { width: 560, height: 440 }, body: tabGroupsBody(groups) });
  const copy = `<div class="copy"><img src="${ICON_URI}" alt="" /><h1>${escapeHtml(PRODUCT_NAME)}</h1><p data-fit>${escapeHtml(locale.strings.video.tagline)}</p></div>`;
  return tileDocument(MARQUEE, `<div class="marquee">${copy}${window}</div>`);
}

const storeIcon = () => tileDocument(STORE_ICON, `<div class="icon"><img src="${ICON_URI}" alt="" /></div>`, 'icon-page');

export async function renderPromoImages(browser: Browser, locale: Locale, directory: string) {
  const images = [
    { file: 'small-promo-tile-440x280.png', size: SMALL_TILE, html: smallTile(locale) },
    { file: 'marquee-promo-tile-1400x560.png', size: MARQUEE, html: marquee(locale) },
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
