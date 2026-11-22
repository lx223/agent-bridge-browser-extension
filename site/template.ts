import { NPM_URL, PAGES, PRODUCT_NAME, RELEASES_URL, REPO_URL, type PageConfig } from './config.ts';
import { relativeHref } from './links.ts';

export interface PageView {
  page: PageConfig;
  documentTitle: string;
  title: string;
  description: string;
  canonical: string;
  bodyHtml: string;
  structuredData: object;
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

function callToAction(): string {
  return `<p class="actions">
        <a class="button primary" href="${RELEASES_URL}">Download the extension</a>
        <a class="button" href="${REPO_URL}">View on GitHub</a>
      </p>`;
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
  <script type="application/ld+json">
${jsonForScript(view.structuredData)}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="${root}"><img src="${root}icon.svg" alt="" width="28" height="28">${PRODUCT_NAME}</a>
      <nav aria-label="Site">
        ${navLink(view, home, 'Overview')}
        ${navLink(view, guides[0] ?? home, 'Guides')}
        ${navLink(view, privacy, 'Privacy')}
        <a href="${REPO_URL}">GitHub</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <article>
      <h1>${escapeHtml(view.title)}</h1>
      ${isHome ? callToAction() : ''}
${view.bodyHtml}
    </article>
  </main>
  <footer class="site-footer">
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
          <li><a href="${REPO_URL}">Source code</a></li>
          <li><a href="${RELEASES_URL}">Releases</a></li>
          <li><a href="${NPM_URL}">MCP server on npm</a></li>
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
