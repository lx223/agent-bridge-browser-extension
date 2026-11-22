import { describe, expect, it } from 'vitest';
import { SIDE_WINDOW, type ChatMessage, type Slide } from './frame.ts';
import { APP_PREVIEW_SECONDS, timeline, videoSeconds, type VideoScript } from './video.ts';

const chatSlide = (count: number, stateSteps: number[]): Slide => ({
  caption: { headline: 'Headline', subline: 'Subline' },
  stage: {
    messages: Array.from({ length: count }, (_, index): ChatMessage => ({ kind: 'tool', name: `tool_${index}` })),
    window: { size: SIDE_WINDOW, states: stateSteps.map((step) => ({ step, body: '' })) },
  },
});

const script = (slides: Slide[]): VideoScript => ({
  languageTag: 'en',
  labels: { you: 'You', agent: 'Agent' },
  opening: { headline: 'Opening', subline: 'Tagline' },
  slides,
  closing: { headline: 'Closing', subline: 'Closing line' },
});

describe('promo video timeline', () => {
  it('plays the title cards and slides one after another', () => {
    const timings = timeline(script([chatSlide(0, [0]), chatSlide(4, [0, 2])]));
    expect(timings).toHaveLength(4);
    timings.slice(1).forEach((timing, index) => expect(timing.start).toBeCloseTo(timings[index]!.start + timings[index]!.duration));
    expect(timings[0]!.fadeIn).toBe(0);
    expect(timings.at(-1)!.fadeOut).toBe(0);
  });

  it('shows each message after the previous one and each window state after its message', () => {
    const [, slide] = timeline(script([chatSlide(4, [0, 2, 3])]));
    expect(slide!.steps).toEqual([...slide!.steps].sort((a, b) => a - b));
    expect(new Set(slide!.steps).size).toBe(4);
    expect(slide!.states.map((state) => state.step)).toEqual([2, 3]);
    slide!.states.forEach((state) => expect(state.at).toBeGreaterThan(slide!.steps[state.step]!));
    expect(slide!.duration).toBeGreaterThan(slide!.steps.at(-1)!);
  });

  it('keeps the Safari app preview within the App Store length limits', () => {
    const seconds = videoSeconds(timeline(script([chatSlide(0, [0]), chatSlide(5, [0, 2, 3])])));
    expect(seconds).toBeGreaterThanOrEqual(APP_PREVIEW_SECONDS.min);
    expect(seconds).toBeLessThanOrEqual(APP_PREVIEW_SECONDS.max);
  });
});
