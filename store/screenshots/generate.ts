import { mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { startHarness } from '../../e2e/support/harness.ts';
import { serveDemo } from './demo.ts';
import { FRAME, frameHtml } from './frame.ts';
import { availableLocales, loadLocale, sceneNames, type Locale, type SceneName } from './locale.ts';
import { captureOrder, scenes } from './scenes.ts';

const DEFAULT_OUT = join(import.meta.dirname, 'out');
const AGENT = { name: 'claude-code', version: '2.1.0' };

const usage = `Usage: npm run screenshots -- [--locale <code>[,<code>...]] [--scene <name>[,<name>...]] [--out <dir>]

Generates ${FRAME.width}x${FRAME.height} Chrome Web Store screenshots for each locale.

  --locale  Locales to render. Default: every file in store/screenshots/locales (${availableLocales().join(', ')}).
  --scene   Scenes to render. Default: ${sceneNames.join(', ')}.
  --out     Output directory. Default: store/screenshots/out.`;

const list = (values: string[] | undefined) => values?.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);

function parseOptions() {
  const { values } = parseArgs({
    options: {
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
  const requestedScenes = list(values.scene) ?? [...sceneNames];
  const unknown = requestedScenes.filter((scene) => !sceneNames.includes(scene as SceneName));
  if (unknown.length) throw new Error(`Unknown scene ${unknown.join(', ')}. Choose from ${sceneNames.join(', ')}.`);
  return {
    locales: (list(values.locale) ?? availableLocales()).map(loadLocale),
    scenes: requestedScenes as SceneName[],
    out: resolve(values.out ?? DEFAULT_OUT),
  };
}

async function renderFrame(browser: Browser, locale: Locale, scene: SceneName, stage: string, file: string) {
  const context = await browser.newContext({ viewport: FRAME, deviceScaleFactor: 1, locale: locale.languageTag, colorScheme: 'light' });
  try {
    const page = await context.newPage();
    await page.setContent(frameHtml({ languageTag: locale.languageTag, caption: locale.strings.captions[scene], stage }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const overflowing = await page.locator('[data-fit]').evaluateAll((elements) =>
      elements.filter((element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1).map((element) => element.className || element.tagName.toLowerCase()),
    );
    await page.screenshot({ path: file });
    return overflowing;
  } finally {
    await context.close();
  }
}

async function generateLocale(browser: Browser, locale: Locale, wanted: SceneName[], out: string) {
  const demo = await serveDemo(locale);
  const harness = await startHarness({ locale: locale.languageTag, deviceScaleFactor: 2, colorScheme: 'light', agentName: AGENT.name, agentVersion: AGENT.version });
  const warnings: string[] = [];
  try {
    const directory = join(out, locale.code);
    mkdirSync(directory, { recursive: true });
    for (const scene of captureOrder.filter((name) => wanted.includes(name))) {
      const stage = await scenes[scene]({ harness, demo, locale });
      const file = join(directory, `${sceneNames.indexOf(scene) + 1}-${scene}.png`);
      const overflowing = await renderFrame(browser, locale, scene, stage, file);
      if (overflowing.length) warnings.push(`${locale.code}/${scene}: text does not fit in ${overflowing.join(', ')}`);
      console.log(`  ${relative(process.cwd(), file)}`);
    }
  } finally {
    await harness.close();
    await demo.close();
  }
  return warnings;
}

async function main() {
  const options = parseOptions();
  const browser = await chromium.launch();
  const warnings: string[] = [];
  try {
    for (const locale of options.locales) {
      console.log(`${locale.code}:`);
      warnings.push(...(await generateLocale(browser, locale, options.scenes, options.out)));
    }
  } finally {
    await browser.close();
  }
  if (warnings.length) {
    console.warn(`\nShorten these strings, then run again:\n  ${warnings.join('\n  ')}`);
    process.exitCode = 1;
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
