import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { safariManifest } from './safariManifest.ts';

describe('safariManifest', () => {
  it('runs the background service worker as a non-persistent background page', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf-8'));

    const safari = safariManifest(manifest);

    expect(safari.background).toEqual({ scripts: ['background.js'], persistent: false });
    expect({ ...safari, background: manifest.background }).toEqual(manifest);
  });

  it('refuses a module background script', () => {
    expect(() => safariManifest({ background: { service_worker: 'background.js', type: 'module' } })).toThrow(/classic scripts/);
  });
});
