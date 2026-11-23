import { CHROME_WEB_STORE_URL, NPM_URL, REPO_URL } from './config.ts';

export type LinkTarget = 'chrome_web_store' | 'claude_desktop_extension' | 'github_releases' | 'github_file' | 'npm' | 'github';

export function linkTarget(href: string): LinkTarget | undefined {
  if (href.startsWith(CHROME_WEB_STORE_URL)) return 'chrome_web_store';
  if (href.endsWith('.mcpb')) return 'claude_desktop_extension';
  if (href.startsWith(`${REPO_URL}/releases`)) return 'github_releases';
  if (href.startsWith(`${REPO_URL}/blob/`)) return 'github_file';
  if (href.startsWith(NPM_URL)) return 'npm';
  if (href.startsWith(REPO_URL)) return 'github';
  return undefined;
}

export function snippetName(code: string): string {
  if (code.includes('claude mcp add')) return 'claude-code-cmd';
  if (code.includes('"mcpServers"')) return 'json-config';
  if (code.includes('build:safari')) return 'safari-build';
  return 'other';
}

export type StoreLinkMedium = 'html' | 'markdown';

export function storeUrl(medium: StoreLinkMedium): string {
  return `${CHROME_WEB_STORE_URL}?utm_source=website&utm_medium=${medium}`;
}

export function withStoreCampaign(href: string, medium: StoreLinkMedium): string {
  return href === CHROME_WEB_STORE_URL ? storeUrl(medium) : href;
}
