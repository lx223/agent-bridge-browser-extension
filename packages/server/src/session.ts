import { randomUUID } from 'node:crypto';
import { basename, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AgentProject } from '@agent-browser-bridge/protocol';

export const SESSION_ID_ENV = 'AGENT_BROWSER_BRIDGE_SESSION_ID';
export const SESSION_STARTED_AT_ENV = 'AGENT_BROWSER_BRIDGE_SESSION_STARTED_AT';

const ROOTS_TIMEOUT_MS = 5_000;

export interface SessionIdentity {
  sessionId: string;
  startedAt: number;
}

export function newSessionEnv(now = Date.now()): Record<string, string> {
  return { [SESSION_ID_ENV]: randomUUID(), [SESSION_STARTED_AT_ENV]: String(now) };
}

export function sessionIdentity(env: Record<string, string | undefined>, now = Date.now()): SessionIdentity {
  const startedAt = Number(env[SESSION_STARTED_AT_ENV]);
  return {
    sessionId: env[SESSION_ID_ENV] || randomUUID(),
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : now,
  };
}

export function projectFromPath(path: string, home: string): AgentProject | undefined {
  if (!path || path === home || path === parse(path).root) return undefined;
  return { name: basename(path), path };
}

export function projectFromRoots(roots: { uri: string; name?: string }[], home: string): AgentProject | undefined {
  for (const root of roots) {
    if (!root.uri.startsWith('file:')) continue;
    let path: string;
    try {
      path = fileURLToPath(root.uri);
    } catch {
      continue;
    }
    const project = projectFromPath(path, home);
    if (project) return root.name ? { ...project, name: root.name } : project;
  }
  return undefined;
}

export function trackProject(server: Server, home: string, onChange: (project: AgentProject) => void) {
  const refresh = async () => {
    if (!server.getClientCapabilities()?.roots) return;
    try {
      const { roots } = await server.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS });
      const project = projectFromRoots(roots, home);
      if (project) onChange(project);
    } catch {
      return;
    }
  };
  server.setNotificationHandler(RootsListChangedNotificationSchema, () => refresh());
  return refresh;
}
