import type { AgentInfo, AgentInstanceUse, AgentSession } from '@agent-browser-bridge/protocol';
import { plural, relativeTime, t } from '../i18n/messages.ts';

export const agentLabel = (agent: AgentInfo) => (agent.client ? `${agent.client.name} ${agent.client.version}` : t('agentStartingUp'));

export const sessionTitle = (agent: AgentInfo) => (agent.project ? t('sessionInProject', agentLabel(agent), agent.project.name) : agentLabel(agent));

const MINUTE = 60_000;

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
        ...(agent.startedAt !== undefined ? [t('sessionStarted', relativeTime(agent.startedAt, now))] : []),
        activity
          ? plural('sessionLastUsed', activity.calls, activity.lastTool, relativeTime(activity.lastUsedAt, now))
          : t('sessionUnused'),
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
  item.title = [view.sessionId && t('sessionId', view.sessionId), t('serverVersion', view.serverVersion)].filter(Boolean).join(' · ');

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
      element.textContent = chip.current ? t('instanceThisBrowser', chip.text) : chip.text;
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
