import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_PACKAGE, STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { MIN_NODE_VERSION, launch } from '../packages/extension/src/welcome/install.ts';

const repoDir = join(import.meta.dirname, '..');
const pluginDir = join(repoDir, 'plugins/claude');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('Claude plugin', () => {
  const manifest = readJson(join(pluginDir, '.claude-plugin/plugin.json'));
  const setupSkill = readFileSync(join(pluginDir, 'skills/setup/SKILL.md'), 'utf8');

  it('starts the published server at an exact version', () => {
    const { mcpServers } = readJson(join(pluginDir, '.mcp.json'));
    expect(Object.keys(mcpServers)).toEqual([SERVER_NAME]);
    const { command, args } = mcpServers[SERVER_NAME];
    expect(command).toBe(launch.command);
    expect(args.slice(0, -1)).toEqual(launch.args.slice(0, -1));
    expect(args.at(-1)).toMatch(new RegExp(`^${SERVER_PACKAGE}@\\d+\\.\\d+\\.\\d+$`));
  });

  it('describes itself in a README long enough for the plugin directory', () => {
    const prose = readFileSync(join(pluginDir, 'README.md'), 'utf8').replace(/```[\s\S]*?```/g, '');
    expect(prose.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
  });

  it('has a version and the icon the plugin directory asks for', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(pluginDir, '.claude-plugin/icon.png'))).toBe(true);
  });

  it('keeps the setup skill in step with the server', () => {
    expect(setupSkill).toContain(`\`${STATUS_TOOL}\``);
    expect(setupSkill).toContain(`\`${SERVER_PACKAGE}\``);
    expect(setupSkill).toContain(`Node.js ${MIN_NODE_VERSION} or later`);
  });
});
