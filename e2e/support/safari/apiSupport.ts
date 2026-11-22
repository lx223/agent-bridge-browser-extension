import { createRequire } from 'node:module';

interface SupportStatement {
  version_added: string | boolean | null;
  version_removed?: string | boolean | null;
}

interface CompatNode {
  __compat?: { support: Record<string, SupportStatement | SupportStatement[] | undefined> };
  [member: string]: unknown;
}

interface CompatData {
  __meta: { version: string };
  webextensions: { api: CompatNode };
}

export type SafariSupport =
  | { status: 'supported'; since: string }
  | { status: 'unsupported' }
  | { status: 'unknown' };

const compatData = createRequire(import.meta.url)('@mdn/browser-compat-data') as CompatData;

export const COMPAT_DATA_VERSION = compatData.__meta.version;

function compatNode(path: string): CompatNode | undefined {
  let node: CompatNode | undefined = compatData.webextensions.api;
  for (const key of path.split('.')) node = node?.[key] as CompatNode | undefined;
  return node;
}

export function safariSupport(path: string): SafariSupport {
  const listed = compatNode(path)?.__compat?.support.safari;
  const statement = Array.isArray(listed) ? listed[0] : listed;
  if (!statement) return { status: 'unknown' };
  if (typeof statement.version_added !== 'string' || statement.version_removed) return { status: 'unsupported' };
  return { status: 'supported', since: statement.version_added.replace(/^≤/, '') };
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function describeSafariSupport(path: string): string {
  const support = safariSupport(path);
  if (support.status === 'unsupported') return `${path}: MDN lists it as not supported in Safari`;
  if (support.status === 'supported') return `${path}: Safari ${support.since} has it, but the simulation in e2e/safari does not yet`;
  return `${path}: MDN has no Safari data for it`;
}
