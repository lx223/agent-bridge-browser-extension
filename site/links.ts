import path from 'node:path';
import { PAGES, REPO_URL, SITE_URL, type PageConfig } from './config.ts';
import { withStoreCampaign } from './tracking.ts';

export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'page'; page: PageConfig; hash: string }
  | { kind: 'repo'; repoPath: string; hash: string };

export function classifyLink(href: string, source: string): LinkTarget {
  if (href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return { kind: 'external', href };
  }
  const hashIndex = href.indexOf('#');
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(source), pathPart));
  const page = PAGES.find((candidate) => candidate.source === repoPath);
  return page ? { kind: 'page', page, hash } : { kind: 'repo', repoPath, hash };
}

export function relativeHref(fromSlug: string, toSlug: string): string {
  const relative = path.posix.relative(`/${fromSlug}`, `/${toSlug}`);
  return relative === '' ? './' : `${relative}/`;
}

export function repoUrl(repoPath: string): string {
  return `${REPO_URL}/blob/main/${repoPath}`;
}

export function htmlLink(link: { href: string; text: string }, from: PageConfig): { href: string; text: string } {
  const target = classifyLink(link.href, from.source);
  if (target.kind === 'external') return { href: withStoreCampaign(link.href, 'html'), text: link.text };
  if (target.kind === 'repo') return { href: repoUrl(target.repoPath) + target.hash, text: link.text };
  const linkPath = link.href.split('#')[0];
  const namedByPath = link.text === linkPath || link.text === link.href;
  return {
    href: relativeHref(from.slug, target.page.slug) + target.hash,
    text: namedByPath ? target.page.label : link.text,
  };
}

export function markdownHref(href: string, from: PageConfig): string {
  const target = classifyLink(href, from.source);
  if (target.kind === 'external') return withStoreCampaign(target.href, 'markdown');
  if (target.kind === 'page') return `${SITE_URL}${target.page.slug}index.md${target.hash}`;
  return repoUrl(target.repoPath) + target.hash;
}
