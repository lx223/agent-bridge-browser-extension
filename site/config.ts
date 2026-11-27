export { CHROME_WEB_STORE_URL } from '../packages/protocol/src/constants.ts';

export const PRODUCT_NAME = 'Agent Browser Bridge';
export const SITE_URL = 'https://lanxiao.dev/agent-bridge-browser-extension/';
export const REPO_URL = 'https://github.com/lx223/agent-bridge-browser-extension';
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const NPM_URL = 'https://www.npmjs.com/package/agent-browser-bridge-mcp';
export const SITE_APP_TAG = 'agent-browser-bridge-site';
export const HOME_TITLE = 'Agent Browser Bridge: control your own browser with any AI agent';

export interface AnalyticsConfig {
  key: string;
  host: string;
}

export function analyticsFromEnv(env: Record<string, string | undefined>): AnalyticsConfig | undefined {
  const key = env.SITE_POSTHOG_KEY?.trim();
  if (!key) return undefined;
  return { key, host: (env.SITE_POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com').replace(/\/$/, '') };
}

export interface PageConfig {
  source: string;
  slug: string;
  label: string;
  description?: string;
}

export const PAGES: PageConfig[] = [
  { source: 'README.md', slug: '', label: 'Overview' },
  { source: 'docs/chat.md', slug: 'docs/chat/', label: 'Chat from the side panel' },
  { source: 'docs/sessions.md', slug: 'docs/sessions/', label: 'Agent sessions' },
  { source: 'docs/profiles.md', slug: 'docs/profiles/', label: 'Browsers and profiles' },
  { source: 'docs/waiting.md', slug: 'docs/waiting/', label: 'Waiting for the user' },
  { source: 'docs/remote.md', slug: 'docs/remote/', label: 'Remote access' },
  { source: 'docs/updates.md', slug: 'docs/updates/', label: 'Updates without restarts' },
  { source: 'docs/localisation.md', slug: 'docs/localisation/', label: 'Languages' },
  {
    source: 'PRIVACY.md',
    slug: 'privacy/',
    label: 'Privacy policy',
    description:
      'What browser information Agent Browser Bridge sends to the bridge on your computer, what your agent can receive, and how optional usage analytics work.',
  },
];
