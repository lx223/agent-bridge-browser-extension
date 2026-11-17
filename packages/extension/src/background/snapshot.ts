export interface AXValue {
  type?: string;
  value?: unknown;
}

export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: AXValue;
  name?: AXValue;
  value?: AXValue;
  properties?: { name: string; value: AXValue }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export interface SnapshotOptions {
  interestingOnly: boolean;
  maxNodes: number;
}

const STRUCTURAL_ROLES = new Set(['generic', 'none', 'presentation', 'InlineTextBox', 'LineBreak', 'LayoutTable', 'LayoutTableRow', 'LayoutTableCell']);
const SHOWN_STATES = ['focused', 'checked', 'pressed', 'selected', 'expanded', 'disabled', 'required', 'readonly', 'level'];
const MAX_TEXT = 200;

export const refFor = (backendNodeId: number) => `e${backendNodeId}`;

export function backendNodeIdFromRef(ref: string): number {
  const match = /^e(\d+)$/.exec(ref);
  if (!match) throw new Error(`Invalid ref "${ref}"; use a ref from snapshot_page such as "e42".`);
  return Number(match[1]);
}

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);
const quote = (text: string) => JSON.stringify(clip(text.replace(/\s+/g, ' ').trim()));
const stringOf = (v?: AXValue) => (v?.value === undefined || v.value === null ? '' : String(v.value));

function states(node: AXNode): string[] {
  const out: string[] = [];
  for (const name of SHOWN_STATES) {
    const prop = node.properties?.find((p) => p.name === name);
    if (!prop) continue;
    const value = prop.value.value;
    if (value === false || value === 'false' || value === undefined) continue;
    out.push(value === true || value === 'true' ? name : `${name}=${String(value)}`);
  }
  return out;
}

function describe(node: AXNode, parentName: string): string | undefined {
  const role = stringOf(node.role);
  const name = stringOf(node.name);
  if (role === 'StaticText') {
    if (!name.trim() || name.trim() === parentName.trim()) return undefined;
    return `text ${quote(name)}`;
  }
  const parts = [role || 'unknown'];
  if (name.trim()) parts.push(quote(name));
  if (node.backendDOMNodeId !== undefined) parts.push(`[ref=${refFor(node.backendDOMNodeId)}]`);
  const value = stringOf(node.value);
  if (value.trim()) parts.push(`value=${quote(value)}`);
  const flags = states(node);
  if (flags.length) parts.push(`[${flags.join(', ')}]`);
  return parts.join(' ');
}

function isSkippable(node: AXNode, interestingOnly: boolean) {
  if (node.ignored) return true;
  if (!interestingOnly) return false;
  const role = stringOf(node.role);
  return STRUCTURAL_ROLES.has(role) && !stringOf(node.name).trim() && !states(node).includes('focused');
}

export function formatSnapshot(nodes: AXNode[], options: SnapshotOptions): string {
  if (!nodes.length) return '(empty page)';
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId || !byId.has(n.parentId)) ?? nodes[0]!;
  const lines: string[] = [];
  let omitted = 0;

  const visit = (node: AXNode, depth: number, parentName: string) => {
    const skip = isSkippable(node, options.interestingOnly);
    const line = skip ? undefined : describe(node, parentName);
    let childDepth = depth;
    if (line !== undefined) {
      if (lines.length >= options.maxNodes) omitted++;
      else lines.push(`${'  '.repeat(depth)}- ${line}`);
      childDepth = depth + 1;
    }
    const name = skip ? parentName : stringOf(node.name);
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) visit(child, childDepth, name);
    }
  };

  visit(root, 0, '');
  if (omitted) lines.push(`- … ${omitted} more nodes omitted; raise maxNodes to see them`);
  return lines.join('\n');
}
