import type { AgentInfo, AgentInstanceUse, AgentSession } from '@agent-browser-bridge/protocol';

export const agentLabel = (agent: AgentInfo) => (agent.client ? `${agent.client.name} ${agent.client.version}` : 'Agent starting up');

export const sessionTitle = (agent: AgentInfo) => (agent.project ? `${agentLabel(agent)} in ${agent.project.name}` : agentLabel(agent));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 45_000) return 'just now';
  if (elapsed < 90 * MINUTE) return `${Math.max(1, Math.round(elapsed / MINUTE))} min ago`;
  if (elapsed < 36 * HOUR) return `${Math.round(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export interface InstanceChip {
  text: string;
  current: boolean;
}

export interface SessionView {
  key: string;
  client: string;
  serverVersion: string;
  project?: string;
  projectPath?: string;
  sessionId?: string;
  details: string[];
  instances: InstanceChip[];
  active: boolean;
}

const ACTIVE_WINDOW_MS = 2 * MINUTE;

const instanceText = (use: AgentInstanceUse) => {
  const browser = use.label ?? use.browser;
  return use.name ? `${use.name} (${browser})` : browser;
};

const recency = (agent: AgentSession) => agent.activity?.lastUsedAt ?? agent.startedAt ?? 0;

export function sessionViews(agents: AgentSession[], now: number, ownInstanceId?: string): SessionView[] {
  return [...agents]
    .sort((a, b) => recency(b) - recency(a))
    .map((agent, index) => {
      const { activity } = agent;
      const details = [
        ...(agent.startedAt !== undefined ? [`Started ${relativeTime(agent.startedAt, now)}`] : []),
        activity
          ? `Last used ${activity.lastTool} ${relativeTime(activity.lastUsedAt, now)}, ${activity.calls} ${activity.calls === 1 ? 'call' : 'calls'}`
          : 'Has not used a browser yet',
      ];
      return {
        key: agent.sessionId ?? `session-${index}`,
        client: agentLabel(agent),
        serverVersion: agent.serverVersion,
        ...(agent.project && { project: agent.project.name, projectPath: agent.project.path }),
        ...(agent.sessionId !== undefined && { sessionId: agent.sessionId }),
        details,
        instances: (activity?.instances ?? []).map((use) => ({
          text: instanceText(use),
          current: ownInstanceId !== undefined && use.instanceId === ownInstanceId,
        })),
        active: activity !== undefined && now - activity.lastUsedAt < ACTIVE_WINDOW_MS,
      };
    });
}

function renderSession(view: SessionView): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'session';
  item.dataset.active = String(view.active);
  item.title = [view.sessionId && `Session ${view.sessionId}`, `server ${view.serverVersion}`].filter(Boolean).join(' · ');

  const head = document.createElement('div');
  head.className = 'session-head';
  const client = document.createElement('strong');
  client.textContent = view.client;
  head.append(client);
  if (view.project) {
    const project = document.createElement('span');
    project.className = 'session-project';
    project.textContent = view.project;
    if (view.projectPath) project.title = view.projectPath;
    head.append(project);
  }

  const details = document.createElement('div');
  details.className = 'session-details';
  details.textContent = view.details.join(' · ');
  item.append(head, details);

  if (view.instances.length) {
    const instances = document.createElement('div');
    instances.className = 'session-instances';
    for (const chip of view.instances) {
      const element = document.createElement('span');
      element.className = chip.current ? 'chip current' : 'chip';
      element.textContent = chip.current ? `${chip.text}, this browser` : chip.text;
      instances.append(element);
    }
    item.append(instances);
  }
  return item;
}

export function renderSessionList(list: HTMLElement, agents: AgentSession[], ownInstanceId?: string, now = Date.now()) {
  list.replaceChildren(...sessionViews(agents, now, ownInstanceId).map(renderSession));
  list.hidden = agents.length === 0;
}
