import type { AgentInfo } from '@agent-browser-bridge/protocol';

export const agentLabel = (agent: AgentInfo) => (agent.client ? `${agent.client.name} ${agent.client.version}` : 'Agent starting up');

export function renderAgentList(list: HTMLElement, agents: AgentInfo[]) {
  list.replaceChildren(
    ...agents.map((agent) => {
      const item = document.createElement('li');
      const server = document.createElement('span');
      server.className = 'server-version';
      server.textContent = `server ${agent.serverVersion}`;
      item.append(agentLabel(agent), ' ', server);
      return item;
    }),
  );
  list.hidden = agents.length === 0;
}
