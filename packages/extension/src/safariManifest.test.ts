import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { safariManifest } from './safariManifest.ts';

describe('safariManifest', () => {
  it('runs the background service worker as a non-persistent background page', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf-8'));

    const { background, permissions, host_permissions, ...rest } = safariManifest(manifest);

    expect(background).toEqual({ scripts: ['background.js'], persistent: false });
    expect(permissions).toEqual(manifest.permissions);
    expect(permissions).toContain('scripting');
    expect(host_permissions).toEqual(['<all_urls>']);
    expect({ ...rest, background: manifest.background, permissions: manifest.permissions, host_permissions: manifest.host_permissions }).toEqual(manifest);
  });

  it('adds scripting once, so Safari can show questions in pages without the debugger', () => {
    const safari = safariManifest({ background: { service_worker: 'background.js' }, permissions: ['tabs', 'scripting'] });

    expect(safari.permissions).toEqual(['tabs', 'scripting']);
  });

  it('refuses a module background script', () => {
    expect(() => safariManifest({ background: { service_worker: 'background.js', type: 'module' } })).toThrow(/classic scripts/);
  });
});
