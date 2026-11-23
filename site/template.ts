import { NPM_URL, PAGES, PRODUCT_NAME, RELEASES_URL, REPO_URL, SITE_APP_TAG, type AnalyticsConfig, type PageConfig } from './config.ts';
import { relativeHref } from './links.ts';
import { linkTarget, storeUrl } from './tracking.ts';

export interface PageView {
  page: PageConfig;
  documentTitle: string;
  title: string;
  description: string;
  canonical: string;
  bodyHtml: string;
  structuredData: object;
  analytics?: AnalyticsConfig;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForScript(value: object): string {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function navLink(view: PageView, target: PageConfig, label: string): string {
  const current = target.slug === view.page.slug ? ' aria-current="page"' : '';
  return `<a href="${relativeHref(view.page.slug, target.slug)}"${current}>${escapeHtml(label)}</a>`;
}

export function trackAttribute(href: string): string {
  const target = linkTarget(href);
  return target ? ` data-track="${target}"` : '';
}

function externalLink(href: string, label: string, className?: string): string {
  const classAttribute = className ? ` class="${className}"` : '';
  return `<a${classAttribute} href="${escapeHtml(href)}"${trackAttribute(href)}>${escapeHtml(label)}</a>`;
}

function callToAction(): string {
  return `<p class="actions" data-area="hero">
        ${externalLink(storeUrl('html'), 'Add to Chrome', 'button primary')}
        ${externalLink(REPO_URL, 'View on GitHub', 'button')}
      </p>`;
}

function siteScript(root: string, analytics: AnalyticsConfig | undefined): string {
  const config = analytics
    ? ` data-posthog-key="${escapeHtml(analytics.key)}" data-posthog-host="${escapeHtml(analytics.host)}" data-app="${SITE_APP_TAG}"`
    : '';
  return `<script src="${root}site.js" defer${config}></script>`;
}

export function renderPage(view: PageView): string {
  const root = relativeHref(view.page.slug, '');
  const home = PAGES[0];
  const privacy = PAGES.find((page) => page.slug === 'privacy/') ?? home;
  const guides = PAGES.filter((page) => page.slug.startsWith('docs/'));
  const isHome = view.page.slug === home.slug;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(view.documentTitle)}</title>
  <meta name="description" content="${escapeHtml(view.description)}">
  <link rel="canonical" href="${view.canonical}">
  <link rel="alternate" type="text/markdown" href="index.md" title="Markdown version">
  <link rel="icon" href="${root}icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${root}style.css">
  <meta name="color-scheme" content="light dark">
  <meta property="og:type" content="${isHome ? 'website' : 'article'}">
  <meta property="og:site_name" content="${PRODUCT_NAME}">
  <meta property="og:title" content="${escapeHtml(view.documentTitle)}">
  <meta property="og:description" content="${escapeHtml(view.description)}">
  <meta property="og:url" content="${view.canonical}">
  <meta name="twitter:card" content="summary">
  ${siteScript(root, view.analytics)}
  <script type="application/ld+json">
${jsonForScript(view.structuredData)}
  </script>
</head>
<body>
  <header class="site-header" data-area="header">
    <div class="wrap">
      <a class="brand" href="${root}"><img src="${root}icon.svg" alt="" width="28" height="28">${PRODUCT_NAME}</a>
      <nav aria-label="Site">
        ${navLink(view, home, 'Overview')}
        ${navLink(view, guides[0] ?? home, 'Guides')}
        ${navLink(view, privacy, 'Privacy')}
        ${externalLink(REPO_URL, 'GitHub')}
      </nav>
    </div>
  </header>
  <main class="wrap">
    <article data-area="content">
      <h1>${escapeHtml(view.title)}</h1>
      ${isHome ? callToAction() : ''}
${view.bodyHtml}
    </article>
  </main>
  <footer class="site-footer" data-area="footer">
    <div class="wrap">
      <section>
        <h2>Guides</h2>
        <ul>
          ${guides.map((guide) => `<li>${navLink(view, guide, guide.label)}</li>`).join('\n          ')}
        </ul>
      </section>
      <section>
        <h2>Project</h2>
        <ul>
          <li>${externalLink(storeUrl('html'), 'Chrome Web Store')}</li>
          <li>${externalLink(REPO_URL, 'Source code')}</li>
          <li>${externalLink(RELEASES_URL, 'Releases')}</li>
          <li>${externalLink(NPM_URL, 'MCP server on npm')}</li>
          <li>${navLink(view, privacy, 'Privacy policy')}</li>
          <li><a href="${root}llms.txt">llms.txt</a></li>
        </ul>
      </section>
      <p class="license">${PRODUCT_NAME} is open source under the Apache License 2.0.</p>
    </div>
  </footer>
</body>
</html>
`;
}
