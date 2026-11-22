import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { plural, t } from '../i18n/messages.ts';

export interface StatusCopy {
  headline: string;
  hint: string;
}

export function describeStatus(status: Pick<ConnectionStatus, 'state' | 'agents'> | undefined): StatusCopy {
  const state = status?.state ?? 'disconnected';
  if (state === 'connecting') return { headline: t('statusLooking'), hint: t('statusSetUpHint') };
  if (state === 'disconnected') return { headline: t('statusNotConnected'), hint: t('statusSetUpHint') };
  const sessions = status?.agents.length ?? 0;
  return {
    headline: sessions > 1 ? plural('statusConnectedMany', sessions) : t('statusConnected'),
    hint: t('statusConnectedHint'),
  };
}
