import { browserLabels, type Browser, type HelloMessage } from '@agent-browser-bridge/protocol';
import { isNewerVersion } from './version.ts';

export const SELF_UPDATING_EXTENSION_VERSION = '0.4.0';

const labelOf = (hello: HelloMessage) => hello.label ?? browserLabels[hello.browser as Browser] ?? hello.browser;

function howToUpdate(hello: HelloMessage) {
  if (hello.browser === 'safari') return 'Ask the user to update Agent Browser Bridge from the Mac App Store.';
  return `Ask the user to quit and reopen ${labelOf(hello)}, which installs the waiting extension update.`;
}

export function missingToolMessage(hello: HelloMessage, tool: string, serverVersion?: string) {
  const comparison = serverVersion ? `, older than this server (${serverVersion}),` : '';
  return `The ${labelOf(hello)} extension is version ${hello.extensionVersion}${comparison} and does not have ${tool}. ${howToUpdate(hello)}`;
}

export function updateNotice(hello: HelloMessage): string | undefined {
  if (hello.browser === 'safari' || !isNewerVersion(SELF_UPDATING_EXTENSION_VERSION, hello.extensionVersion)) return undefined;
  const label = labelOf(hello);
  return `The ${label} extension is version ${hello.extensionVersion}, which cannot install updates while it is connected to an agent. Tell the user to quit and reopen ${label} to install the latest version.`;
}
