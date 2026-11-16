import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, cursorInstallUrl, mcpJsonConfig, vscodeInstallUrl } from './install.ts';

describe('install snippets', () => {
  it('builds the Claude Code command', () => {
    expect(claudeCodeCommand).toBe('claude mcp add agent-browser-bridge -- npx -y @lx223/agent-browser-bridge-mcp');
  });

  it('builds a standard mcpServers config', () => {
    expect(JSON.parse(mcpJsonConfig)).toEqual({
      mcpServers: { 'agent-browser-bridge': { command: 'npx', args: ['-y', '@lx223/agent-browser-bridge-mcp'] } },
    });
  });

  it('encodes the Cursor deeplink config as base64 JSON', () => {
    const url = new URL(cursorInstallUrl());
    expect(url.protocol).toBe('cursor:');
    expect(url.searchParams.get('name')).toBe('agent-browser-bridge');
    expect(JSON.parse(atob(url.searchParams.get('config')!))).toEqual({ command: 'npx', args: ['-y', '@lx223/agent-browser-bridge-mcp'] });
  });

  it('encodes the VS Code install link as URL-encoded JSON', () => {
    const url = vscodeInstallUrl();
    expect(url.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split('?')[1]))).toEqual({
      name: 'agent-browser-bridge',
      command: 'npx',
      args: ['-y', '@lx223/agent-browser-bridge-mcp'],
    });
  });
});
