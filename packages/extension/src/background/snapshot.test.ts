import { describe, expect, it } from 'vitest';
import { backendNodeIdFromRef, formatSnapshot, type AXNode } from './snapshot.ts';

const node = (nodeId: string, role: string, name: string, extra: Partial<AXNode> = {}): AXNode => ({
  nodeId,
  ignored: false,
  role: { value: role },
  name: { value: name },
  ...extra,
});

const tree: AXNode[] = [
  node('1', 'RootWebArea', 'Example', { childIds: ['2', '3'], backendDOMNodeId: 1 }),
  node('2', 'generic', '', { parentId: '1', childIds: ['4', '5', '6'], backendDOMNodeId: 2 }),
  node('3', 'none', '', { parentId: '1', ignored: true, childIds: [] }),
  node('4', 'heading', 'Welcome', {
    parentId: '2',
    childIds: ['7'],
    backendDOMNodeId: 4,
    properties: [{ name: 'level', value: { value: 1 } }],
  }),
  node('5', 'textbox', 'Search', {
    parentId: '2',
    backendDOMNodeId: 5,
    value: { value: 'cats' },
    properties: [
      { name: 'focused', value: { value: true } },
      { name: 'disabled', value: { value: false } },
    ],
  }),
  node('6', 'button', 'Go', { parentId: '2', backendDOMNodeId: 6 }),
  node('7', 'StaticText', 'Welcome', { parentId: '4' }),
];

describe('formatSnapshot', () => {
  it('flattens structural nodes and labels actionable ones with refs', () => {
    expect(formatSnapshot(tree, { interestingOnly: true, maxNodes: 100 })).toBe(
      [
        '- RootWebArea "Example" [ref=e1]',
        '  - heading "Welcome" [ref=e4] [level=1]',
        '  - textbox "Search" [ref=e5] value="cats" [focused]',
        '  - button "Go" [ref=e6]',
      ].join('\n'),
    );
  });

  it('keeps structural nodes when interestingOnly is off', () => {
    expect(formatSnapshot(tree, { interestingOnly: false, maxNodes: 100 })).toContain('  - generic [ref=e2]');
  });

  it('reports omitted nodes past maxNodes', () => {
    const out = formatSnapshot(tree, { interestingOnly: true, maxNodes: 2 }).split('\n');
    expect(out).toHaveLength(3);
    expect(out[2]).toBe('- … 2 more nodes omitted; raise maxNodes to see them');
  });
});

describe('backendNodeIdFromRef', () => {
  it('parses refs and rejects anything else', () => {
    expect(backendNodeIdFromRef('e42')).toBe(42);
    expect(() => backendNodeIdFromRef('42')).toThrow('Invalid ref');
  });
});
