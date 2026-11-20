import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { MIN_NODE_VERSION, launch, mcpJsonConfig } from '../packages/extension/src/welcome/install.ts';

const repoDir = join(import.meta.dirname, '..');
const pluginDir = join(repoDir, 'plugins/claude');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('Claude plugin', () => {
  const marketplace = readJson(join(repoDir, '.claude-plugin/marketplace.json'));
  const manifest = readJson(join(pluginDir, '.claude-plugin/plugin.json'));
  const setupSkill = readFileSync(join(pluginDir, 'skills/setup/SKILL.md'), 'utf8');

  it('starts the server the same way as every other agent', () => {
    expect(readJson(join(pluginDir, '.mcp.json'))).toEqual(JSON.parse(mcpJsonConfig));
  });

  it('is listed in the marketplace under its own name and folder', () => {
    expect(marketplace.plugins).toHaveLength(1);
    const [entry] = marketplace.plugins;
    expect(entry.name).toBe(manifest.name);
    expect(join(repoDir, entry.source)).toBe(pluginDir);
    expect(entry.description).toBe(manifest.description);
  });

  it('has a version and the icon the plugin directory asks for', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(pluginDir, '.claude-plugin/icon.png'))).toBe(true);
  });

  it('keeps the setup skill in step with the server', () => {
    expect(setupSkill).toContain(`\`${STATUS_TOOL}\``);
    expect(setupSkill).toContain(`\`${launch.command} ${launch.args.join(' ')}\``);
    expect(setupSkill).toContain(`Node.js ${MIN_NODE_VERSION} or later`);
  });
});
