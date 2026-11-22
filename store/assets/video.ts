import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Browser } from 'playwright';
import { documentHtml, ICON_URI, PRODUCT_NAME, slideHtml, VIDEO_LAYOUT, type ChatLabels, type Slide } from './frame.ts';
import { escapeHtml } from './html.ts';
import { openDocument, overflowingElements } from './render.ts';

export const VIDEO = { width: 1920, height: 1080, fps: 30 };
export const APP_PREVIEW_SECONDS = { min: 15, max: 30 };

const SCALE = VIDEO.width / VIDEO_LAYOUT.width;
const FADE = 0.4;
const TITLE_SECONDS = 3.2;
const CLOSING_SECONDS = 4;
const STILL_SECONDS = 4.5;
const FIRST_STEP = 1;
const STEP = 1.1;
const HOLD = 2.6;
const STATE_DELAY = 0.35;

export interface TitleCard {
  headline: string;
  subline: string;
}

export interface VideoScript {
  languageTag: string;
  labels: ChatLabels;
  opening: TitleCard;
  slides: Slide[];
  closing: TitleCard;
}

interface Timing {
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  steps: number[];
  states: Array<{ step: number; at: number }>;
}

const titleStyles = `
  html { zoom: ${SCALE}; }
  .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 140px; }
  .title img { width: 128px; height: 128px; border-radius: 30px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.4); }
  .title h1 { margin: 36px 0 0; color: #fff; font-size: 64px; line-height: 1.1; font-weight: 700; letter-spacing: -0.015em; }
  .title p { margin: 20px 0 0; color: #e0e7ff; font-size: 28px; line-height: 1.4; max-width: 900px; text-wrap: balance; }
  .slide { position: absolute; inset: 0; }
`;

const titleHtml = (card: TitleCard) =>
  `<div class="title"><img src="${ICON_URI}" alt="" /><h1>${escapeHtml(card.headline)}</h1><p data-fit>${escapeHtml(card.subline)}</p></div>`;

const stepTime = (step: number) => FIRST_STEP + step * STEP;

function sceneTiming(slide: Slide) {
  const count = slide.stage.messages.length;
  const steps = slide.stage.messages.map((_, step) => stepTime(step));
  const first = Math.min(...slide.stage.window.states.map((state) => state.step));
  const states = slide.stage.window.states.filter((state) => state.step !== first).map((state) => ({ step: state.step, at: stepTime(state.step) + STATE_DELAY }));
  const duration = count ? stepTime(count - 1) + HOLD : STILL_SECONDS;
  return { duration, steps, states };
}

export function timeline(script: VideoScript): Timing[] {
  const parts = [
    { duration: TITLE_SECONDS, steps: [], states: [] },
    ...script.slides.map(sceneTiming),
    { duration: CLOSING_SECONDS, steps: [], states: [] },
  ];
  let start = 0;
  return parts.map((part, index) => {
    const last = index === parts.length - 1;
    const timing = { ...part, start, fadeIn: index === 0 ? 0 : FADE, fadeOut: last ? 0 : FADE };
    start += part.duration;
    return timing;
  });
}

export const videoSeconds = (timings: Timing[]) => {
  const last = timings.at(-1)!;
  return last.start + last.duration;
};

function videoHtml(script: VideoScript) {
  const slides = [
    titleHtml(script.opening),
    ...script.slides.map((slide) => slideHtml(script.labels, slide, true)),
    titleHtml(script.closing),
  ];
  const content = slides.map((slide, index) => `<div class="slide" data-slide="${index}">${slide}</div>`).join('');
  return documentHtml({ languageTag: script.languageTag, layout: VIDEO_LAYOUT, content, extraStyles: titleStyles });
}

function animate(timings: Timing[]) {
  const ms = (seconds: number) => Math.round(seconds * 1000);
  const easing = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
  const enter = (element: Element | null, at: number, rise: number, duration = 0.45) =>
    element?.animate([{ opacity: 0, transform: `translateY(${rise}px)` }, { opacity: 1, transform: 'none' }], { delay: ms(at), duration: ms(duration), fill: 'both', easing });

  timings.forEach((timing, index) => {
    const slide = document.querySelector(`[data-slide="${index}"]`)!;
    const opacity: Keyframe[] = [{ opacity: timing.fadeIn ? 0 : 1, offset: 0 }];
    if (timing.fadeIn) opacity.push({ opacity: 1, offset: timing.fadeIn / timing.duration });
    if (timing.fadeOut) opacity.push({ opacity: 1, offset: 1 - timing.fadeOut / timing.duration });
    opacity.push({ opacity: timing.fadeOut ? 0 : 1, offset: 1 });
    slide.animate(opacity, { delay: ms(timing.start), duration: ms(timing.duration), fill: 'both' });

    if (index > 0) {
      enter(slide.querySelector('.title img'), timing.start + 0.1, 16, 0.6);
      enter(slide.querySelector('.title h1'), timing.start + 0.25, 16, 0.6);
      enter(slide.querySelector('.title p'), timing.start + 0.45, 16, 0.6);
    }
    enter(slide.querySelector('header'), timing.start + 0.1, 12, 0.6);
    enter(slide.querySelector('.chat'), timing.start + 0.2, 20, 0.6);
    enter(slide.querySelector('.window'), timing.start + 0.3, 20, 0.6);
    slide.querySelectorAll('.chat [data-step]').forEach((element) => enter(element, timing.start + timing.steps[Number((element as HTMLElement).dataset.step)]!, 8, 0.35));
    for (const state of timing.states) {
      slide.querySelectorAll(`.state[data-step="${state.step}"]`).forEach((element) =>
        element.animate([{ opacity: 0 }, { opacity: 1 }], { delay: ms(timing.start + state.at), duration: 450, fill: 'both', easing }),
      );
    }
  });
  for (const animation of document.getAnimations()) animation.pause();
}

function seek(milliseconds: number) {
  const animations = document.getAnimations();
  for (const animation of animations) animation.currentTime = milliseconds;
  return animations
    .map((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (!target) return '-';
      const style = getComputedStyle(target);
      return `${style.opacity}/${style.transform}`;
    })
    .join(',');
}

function startEncoder(file: string) {
  const encoder = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(VIDEO.fps), '-c:v', 'png', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map', '0:v', '-map', '1:a', '-shortest',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '16', '-r', String(VIDEO.fps),
      '-c:a', 'aac', '-b:a', '256k',
      '-movflags', '+faststart',
      file,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const exited = new Promise<void>((done, fail) => {
    encoder.once('error', (error) => fail(new Error(`Could not start ffmpeg: ${error.message}. Install ffmpeg with libx264 and try again.`)));
    encoder.once('close', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited with code ${code}`))));
  });
  exited.catch(() => undefined);
  encoder.stdin.on('error', () => undefined);
  return {
    async write(frame: Buffer) {
      if (!encoder.stdin.write(frame)) await Promise.race([once(encoder.stdin, 'drain'), exited]);
    },
    async finish() {
      encoder.stdin.end();
      await exited;
    },
    abort() {
      encoder.kill();
    },
  };
}

export async function renderVideo(browser: Browser, script: VideoScript, file: string) {
  const timings = timeline(script);
  const seconds = videoSeconds(timings);
  const { page, close } = await openDocument(browser, { html: videoHtml(script), size: VIDEO, languageTag: script.languageTag });
  try {
    const overflowing = await overflowingElements(page);
    await page.evaluate(animate, timings);
    const cdp = await page.context().newCDPSession(page);
    const encoder = startEncoder(file);
    try {
      let signature = '';
      let frame: Buffer = Buffer.alloc(0);
      for (let index = 0; index < Math.round(seconds * VIDEO.fps); index += 1) {
        const next = await page.evaluate(seek, (index * 1000) / VIDEO.fps);
        if (next !== signature) {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
          frame = Buffer.from(data, 'base64');
          signature = next;
        }
        await encoder.write(frame);
      }
      await encoder.finish();
    } catch (error) {
      encoder.abort();
      throw error;
    }
    return { seconds, overflowing };
  } finally {
    await close();
  }
}

export const titleCards = (tagline: string, closing: string) => ({
  opening: { headline: PRODUCT_NAME, subline: tagline },
  closing: { headline: PRODUCT_NAME, subline: closing },
});
