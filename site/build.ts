import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HOME_TITLE, NPM_URL, PAGES, PRODUCT_NAME, RELEASES_URL, REPO_URL, SITE_URL, type PageConfig } from './config.ts';
import { htmlLink, markdownHref } from './links.ts';
import { renderMarkdown, rewriteMarkdownLinks, type RenderedMarkdown } from './markdown.ts';
import { renderPage } from './template.ts';

interface BuiltPage {
  page: PageConfig;
  rendered: RenderedMarkdown;
}

function structuredData(built: BuiltPage, version: string): object {
  const url = SITE_URL + built.page.slug;
  if (built.page.slug === '') {
    return {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: PRODUCT_NAME,
      description: built.rendered.description,
      url,
      applicationCategory: 'BrowserApplication',
      operatingSystem: 'Windows, macOS, Linux',
      softwareVersion: version,
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      downloadUrl: RELEASES_URL,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      sameAs: [REPO_URL, NPM_URL],
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: built.rendered.title,
    description: built.rendered.description,
    url,
    isPartOf: { '@type': 'WebSite', name: PRODUCT_NAME, url: SITE_URL },
  };
}

function llmsTxt(pages: BuiltPage[]): string {
  const [home] = pages;
  const lines = [
    `# ${PRODUCT_NAME}`,
    '',
    `> ${home.rendered.description}`,
    '',
    `${PRODUCT_NAME} is a Chrome and Safari extension plus a local MCP server (\`agent-browser-bridge-mcp\` on npm). It lets Claude Code, Claude Desktop, Cursor, VS Code and other MCP clients read and organise the user's real browser tabs, history, bookmarks and pages.`,
    '',
    '## Docs',
    '',
    ...pages.map((built) => `- [${built.rendered.title}](${SITE_URL}${built.page.slug}index.md): ${built.rendered.description}`),
    '',
    '## Optional',
    '',
    `- [Source code](${REPO_URL})`,
    `- [Latest release](${RELEASES_URL})`,
    `- [MCP server on npm](${NPM_URL})`,
    '',
  ];
  return lines.join('\n');
}

function sitemap(pages: BuiltPage[]): string {
  const urls = pages.map((built) => `  <url><loc>${SITE_URL}${built.page.slug}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export async function buildSite(repoRoot: string, outDir: string): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true });
  const written: string[] = [];
  const write = async (relativePath: string, content: string) => {
    const target = path.join(outDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(relativePath);
  };

  const extensionPackage = JSON.parse(await readFile(path.join(repoRoot, 'packages/extension/package.json'), 'utf8'));
  const version: string = extensionPackage.version;

  const pages: BuiltPage[] = [];
  for (const page of PAGES) {
    const markdown = await readFile(path.join(repoRoot, page.source), 'utf8');
    const parsed = renderMarkdown(markdown, (link) => htmlLink(link, page));
    const rendered = { ...parsed, description: page.description ?? parsed.description };
    const built = { page, rendered };
    pages.push(built);
    await write(
      `${page.slug}index.html`,
      renderPage({
        page,
        documentTitle: page.slug === '' ? HOME_TITLE : `${rendered.title} · ${PRODUCT_NAME}`,
        title: rendered.title,
        description: rendered.description,
        canonical: SITE_URL + page.slug,
        bodyHtml: rendered.html,
        structuredData: structuredData(built, version),
      }),
    );
    await write(`${page.slug}index.md`, rewriteMarkdownLinks(markdown, (href) => markdownHref(href, page)));
  }

  await write('llms.txt', llmsTxt(pages));
  await write('sitemap.xml', sitemap(pages));
  await write('.nojekyll', '');

  await copyFile(path.join(repoRoot, 'site/style.css'), path.join(outDir, 'style.css'));
  written.push('style.css');
  await copyFile(path.join(repoRoot, 'packages/extension/icons/icon.svg'), path.join(outDir, 'icon.svg'));
  written.push('icon.svg');

  return written;
}
