import { z } from 'zod';

/**
 * Every browser capability exposed over MCP is declared here once.
 * The server registers each entry as an MCP tool; the extension implements
 * a handler per `method` and validates params with the same schema.
 */

const tabId = z.number().int().nonnegative();
const windowId = z.number().int().nonnegative();
const groupId = z.number().int().nonnegative();

export const groupColor = z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
export type GroupColor = z.infer<typeof groupColor>;

const groupProps = {
  title: z.string().optional().describe('Group title shown on the tab strip.'),
  color: groupColor.optional(),
  collapsed: z.boolean().optional(),
};

export const toolDefinitions = {
  'windows.list': {
    tool: 'list_windows',
    description: 'List open browser windows with their ids, focus state and tab counts.',
    params: z.object({}),
    readOnly: true,
  },
  'tabs.list': {
    tool: 'list_tabs',
    description:
      'List open tabs (id, windowId, index, title, url, groupId, pinned, active, lastAccessed). Optionally filter by window.',
    params: z.object({ windowId: windowId.optional() }),
    readOnly: true,
  },
  'tabGroups.list': {
    tool: 'list_tab_groups',
    description: 'List tab groups (id, windowId, title, color, collapsed, tabIds). Optionally filter by window.',
    params: z.object({ windowId: windowId.optional() }),
    readOnly: true,
  },
  'tabs.group': {
    tool: 'group_tabs',
    description:
      'Put tabs into a group. Pass groupId to add to an existing group, otherwise a new group is created (in windowId if given). Optionally set title/color/collapsed. Pinned tabs cannot be grouped.',
    params: z.object({
      tabIds: z.array(tabId).min(1),
      groupId: groupId.optional(),
      windowId: windowId.optional(),
      ...groupProps,
    }),
    readOnly: false,
  },
  'tabGroups.update': {
    tool: 'update_tab_group',
    description: "Change a tab group's title, color or collapsed state.",
    params: z.object({ groupId, ...groupProps }),
    readOnly: false,
  },
  'tabs.ungroup': {
    tool: 'ungroup_tabs',
    description: 'Remove tabs from whatever group they are in. Empty groups disappear.',
    params: z.object({ tabIds: z.array(tabId).min(1) }),
    readOnly: false,
  },
  'tabs.move': {
    tool: 'move_tabs',
    description: 'Move tabs to a position (index, -1 for the end), optionally into another window.',
    params: z.object({ tabIds: z.array(tabId).min(1), index: z.number().int().min(-1), windowId: windowId.optional() }),
    readOnly: false,
  },
  'tabGroups.move': {
    tool: 'move_tab_group',
    description: 'Move a whole tab group to a position (index, -1 for the end), optionally into another window.',
    params: z.object({ groupId, index: z.number().int().min(-1), windowId: windowId.optional() }),
    readOnly: false,
  },
  'tabs.close': {
    tool: 'close_tabs',
    description: 'Close tabs. This cannot be undone with undo_last_plan; confirm with the user before closing.',
    params: z.object({ tabIds: z.array(tabId).min(1) }),
    readOnly: false,
    destructive: true,
  },
  'plan.apply': {
    tool: 'apply_tab_plan',
    description:
      'Reorganise tabs in one step. Each group entry lists the tabs it should contain; a group whose title matches an existing group (in the same window when windowId is given) is reused, otherwise one is created. Tabs listed in ungroupTabIds are removed from their groups. Use dryRun to preview. The prior layout is saved so undo_last_plan can restore it.',
    params: z.object({
      windowId: windowId.optional().describe('Window to create new groups in. Defaults to the window of the first tab in each group.'),
      groups: z
        .array(z.object({ title: z.string().min(1), color: groupColor.optional(), collapsed: z.boolean().optional(), tabIds: z.array(tabId).min(1) }))
        .default([]),
      ungroupTabIds: z.array(tabId).default([]),
      dryRun: z.boolean().default(false),
    }),
    readOnly: false,
  },
  'plan.undo': {
    tool: 'undo_last_plan',
    description: 'Restore the tab and group layout saved before the last apply_tab_plan (best effort; closed tabs are not reopened).',
    params: z.object({}),
    readOnly: false,
  },
} as const satisfies Record<
  string,
  { tool: string; description: string; params: z.ZodObject; readOnly: boolean; destructive?: boolean }
>;

export type Method = keyof typeof toolDefinitions;
export type ParamsOf<M extends Method> = z.output<(typeof toolDefinitions)[M]['params']>;
export const methods = Object.keys(toolDefinitions) as Method[];
