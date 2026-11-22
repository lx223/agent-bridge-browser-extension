export const AGENT_TABS = ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'other'] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

export const AGENT_TAB_KEY = 'setupAgentTab';

export const isAgentTab = (value: unknown): value is AgentTab => AGENT_TABS.includes(value as AgentTab);

export const initialAgentTab = (stored: unknown): AgentTab => (isAgentTab(stored) ? stored : AGENT_TABS[0]);

const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

export function tabAfterKey(index: number, key: string, count: number): number | undefined {
  return STEPS[key]?.(index, count);
}
