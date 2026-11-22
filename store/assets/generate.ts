import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { startHarness } from '../../e2e/support/harness.ts';
import { serveDemo } from './demo.ts';
import { documentHtml, SCREENSHOT_LAYOUT, slideHtml, type ChatLabels, type Slide, type Stage } from './frame.ts';
import { availableLocales, loadLocale, REFERENCE_LOCALE, sceneNames, type Locale, type SceneName } from './locale.ts';
import { renderStill } from './render.ts';
import { safariSlides, SAFARI_VIDEO } from './safari.ts';
import { captureOrder, scenes } from './scenes.ts';
import { renderPromoImages } from './tiles.ts';
import { APP_PREVIEW_SECONDS, renderVideo, titleCards, VIDEO, type VideoScript } from './video.ts';

const DEFAULT_OUT = join(import.meta.dirname, 'out');
const AGENT = { name: 'claude-code', version: '2.1.0' };
const stores = ['chrome', 'safari'] as const;
const kinds = ['screenshots', 'video', 'promo'] as const;
type Store = (typeof stores)[number];

const usage = `Usage: npm run store:assets -- [--store <name>[,...]] [--kind <name>[,...]] [--locale <code>[,...]] [--scene <name>[,...]] [--out <dir>]

Generates the images and videos for the Chrome Web Store and Mac App Store listings.

  --store   Stores to generate for: ${stores.join(', ')}. Default: both.
  --kind    What to generate: ${kinds.join(', ')}. Default: all.
              screenshots  ${SCREENSHOT_LAYOUT.width}x${SCREENSHOT_LAYOUT.height} PNG screenshots
              video        ${VIDEO.width}x${VIDEO.height} H.264 MP4 promo video
              promo        Chrome Web Store promo tiles and store icon (Chrome only)
  --locale  Chrome locales. Default: every file in store/assets/locales (${availableLocales().join(', ')}).
  --scene   Chrome scenes. Default: ${sceneNames.join(', ')}.
  --out     Output directory. Default: store/assets/out.`;

const list = (values: string[] | undefined) => values?.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);

function choose<T extends string>(flag: string, requested: string[] | undefined, allowed: readonly T[]): T[] {
  const values = requested ?? [...allowed];
  const unknown = values.filter((value) => !allowed.includes(value as T));
  if (unknown.length) throw new Error(`Unknown ${flag} ${unknown.join(', ')}. Choose from ${allowed.join(', ')}.`);
  return values as T[];
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      store: { type: 'string', multiple: true },
      kind: { type: 'string', multiple: true },
      locale: { type: 'string', multiple: true },
      scene: { type: 'string', multiple: true },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  return {
    stores: choose('store', list(values.store), stores),
    kinds: choose('kind', list(values.kind), kinds),
    locales: (list(values.locale) ?? availableLocales()).map(loadLocale),
    scenes: choose('scene', list(values.scene), sceneNames),
    out: resolve(values.out ?? DEFAULT_OUT),
  };
}

type Options = ReturnType<typeof parseOptions>;

function requireFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf-8' });
  if (probe.error || probe.status !== 0) throw new Error('Rendering videos needs ffmpeg on the PATH. Install it, or leave out --kind video.');
  if (!probe.stdout.includes('libx264')) throw new Error('Rendering videos needs an ffmpeg build with libx264.');
}

const show = (file: string) => console.log(`  ${relative(process.cwd(), file)}`);

class Report {
  readonly warnings: string[] = [];

  overflow(name: string, overflowing: string[]) {
    if (overflowing.length) this.warnings.push(`${name}: text does not fit in ${overflowing.join(', ')}`);
  }
}

async function screenshot(browser: Browser, report: Report, options: { languageTag: string; labels: ChatLabels; slide: Slide; file: string; name: string }) {
  const html = documentHtml({ languageTag: options.languageTag, layout: SCREENSHOT_LAYOUT, content: slideHtml(options.labels, options.slide) });
  report.overflow(options.name, await renderStill(browser, { html, size: SCREENSHOT_LAYOUT, languageTag: options.languageTag, file: options.file }));
  show(options.file);
}

async function video(browser: Browser, report: Report, script: VideoScript, file: string, name: string) {
  const { seconds, overflowing } = await renderVideo(browser, script, file);
  report.overflow(name, overflowing);
  show(file);
  return seconds;
}

async function captureChromeStages(locale: Locale, wanted: SceneName[]) {
  const demo = await serveDemo(locale);
  const harness = await startHarness({ locale: locale.languageTag, deviceScaleFactor: 2, colorScheme: 'light', agentName: AGENT.name, agentVersion: AGENT.version });
  try {
    const stages = new Map<SceneName, Stage>();
    for (const scene of captureOrder.filter((name) => wanted.includes(name))) stages.set(scene, await scenes[scene]({ harness, demo, locale }));
    return stages;
  } finally {
    await harness.close();
    await demo.close();
  }
}

async function chrome(browser: Browser, options: Options, report: Report) {
  const root = join(options.out, 'chrome');
  if (options.kinds.includes('promo')) {
    console.log('chrome/promo:');
    const directory = join(root, 'promo');
    mkdirSync(directory, { recursive: true });
    for (const image of await renderPromoImages(browser, loadLocale(REFERENCE_LOCALE), directory)) {
      report.overflow(relative(options.out, image.file), image.overflowing);
      show(image.file);
    }
  }
  if (!options.kinds.includes('screenshots') && !options.kinds.includes('video')) return;
  for (const locale of options.locales) {
    console.log(`chrome/${locale.code}:`);
    const directory = join(root, locale.code);
    mkdirSync(directory, { recursive: true });
    const stages = await captureChromeStages(locale, options.scenes);
    const slides = sceneNames.filter((scene) => stages.has(scene)).map((scene) => ({ scene, caption: locale.strings.captions[scene], stage: stages.get(scene)! }));
    if (options.kinds.includes('screenshots')) {
      for (const slide of slides) {
        const file = join(directory, `${sceneNames.indexOf(slide.scene) + 1}-${slide.scene}.png`);
        await screenshot(browser, report, { languageTag: locale.languageTag, labels: locale.strings.chat, slide, file, name: `chrome/${locale.code}/${slide.scene}` });
      }
    }
    if (options.kinds.includes('video')) {
      const script = { languageTag: locale.languageTag, labels: locale.strings.chat, slides, ...titleCards(locale.strings.video.tagline, locale.strings.video.closing) };
      await video(browser, report, script, join(directory, 'promo-video.mp4'), `chrome/${locale.code}/promo-video`);
    }
  }
}

async function safari(browser: Browser, options: Options, report: Report) {
  if (!options.kinds.includes('screenshots') && !options.kinds.includes('video')) return;
  console.log('safari:');
  const directory = join(options.out, 'safari');
  mkdirSync(directory, { recursive: true });
  const labels = loadLocale(REFERENCE_LOCALE).strings.chat;
  const slides = await safariSlides();
  if (options.kinds.includes('screenshots')) {
    for (const slide of slides) await screenshot(browser, report, { languageTag: 'en', labels, slide, file: join(directory, `${slide.file}.png`), name: `safari/${slide.file}` });
  }
  if (options.kinds.includes('video')) {
    const script = { languageTag: 'en', labels, slides, ...titleCards(SAFARI_VIDEO.tagline, SAFARI_VIDEO.closing) };
    const seconds = await video(browser, report, script, join(directory, 'app-preview.mp4'), 'safari/app-preview');
    if (seconds < APP_PREVIEW_SECONDS.min || seconds > APP_PREVIEW_SECONDS.max) {
      report.warnings.push(`safari/app-preview: lasts ${seconds.toFixed(1)}s, but App Store previews must last ${APP_PREVIEW_SECONDS.min} to ${APP_PREVIEW_SECONDS.max}s`);
    }
  }
}

const generators: Record<Store, (browser: Browser, options: Options, report: Report) => Promise<void>> = { chrome, safari };

async function main() {
  const options = parseOptions();
  if (options.kinds.includes('video')) requireFfmpeg();
  const report = new Report();
  const browser = await chromium.launch();
  try {
    for (const store of options.stores) await generators[store](browser, options, report);
  } finally {
    await browser.close();
  }
  if (report.warnings.length) {
    console.warn(`\nFix these, then run again:\n  ${report.warnings.join('\n  ')}`);
    process.exitCode = 1;
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
