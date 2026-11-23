import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSite } from './build.ts';
import { analyticsFromEnv, CHROME_WEB_STORE_URL, NPM_URL, PAGES, REPO_URL, SITE_URL } from './config.ts';
import { classifyLink, htmlLink, markdownHref, relativeHref } from './links.ts';
import { githubSlug, rewriteMarkdownLinks } from './markdown.ts';
import { linkTarget, snippetName, storeUrl } from './tracking.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
let outDir: string;
let files: string[];

const read = (relativePath: string) => readFile(path.join(outDir, relativePath), 'utf8');

beforeAll(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), 'site-'));
  files = await buildSite(repoRoot, outDir);
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe('site build', () => {
  it('writes an HTML page and a Markdown copy for every configured page', () => {
    for (const page of PAGES) {
      expect(files).toContain(`${page.slug}index.html`);
      expect(files).toContain(`${page.slug}index.md`);
    }
    expect(files).toEqual(expect.arrayContaining(['llms.txt', 'sitemap.xml', 'style.css', 'site.js', 'icon.svg', '.nojekyll']));
  });

  it('gives the home page a canonical URL, description and software metadata', async () => {
    const html = await read('index.html');
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}">`);
    expect(html).toContain('<meta name="description" content="Control your own browser with any AI agent you like.');
    expect(html).toContain('"@type": "SoftwareApplication"');
    expect(html).toContain('<h1>Agent Browser Bridge</h1>');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it('links published Markdown sources to their pages and the rest to GitHub', async () => {
    const html = await read('index.html');
    expect(html).toContain('href="docs/chat/"');
    expect(html).toContain('href="privacy/"');
    expect(html).toContain(`href="${REPO_URL}/blob/main/docs/safari-app-store.md"`);
    expect(html).toContain('<a href="docs/chat/">Chat from the side panel</a>');
    expect(html).toContain('<a href="privacy/">privacy policy</a>');
    const chat = await read('docs/chat/index.html');
    expect(chat).toContain('href="../updates/#what-survives-an-update"');
    expect(chat).toContain('href="../../privacy/"');
  });

  it('gives headings the same anchors GitHub does', async () => {
    const privacy = await read('privacy/index.html');
    expect(privacy).toContain('href="#safari"');
    expect(privacy).toContain('id="safari"');
    const updates = await read('docs/updates/index.html');
    expect(updates).toContain('id="riding-out-reconnects"');
  });

  it('points every in-site link at a page that exists', async () => {
    for (const page of PAGES) {
      const html = await read(`${page.slug}index.html`);
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^[a-z]+:/i.test(href)) continue;
        const [target, hash] = href.split('#');
        const resolved = path.join(outDir, page.slug, target);
        const file = target === '' ? path.join(outDir, page.slug, 'index.html') : target.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
        expect(existsSync(file), `${href} from ${page.slug || '/'}`).toBe(true);
        if (hash) expect(await readFile(file, 'utf8'), `${href} from ${page.slug || '/'}`).toContain(`id="${hash}"`);
      }
    }
  });

  it('points every repository link at a file that exists', async () => {
    for (const page of PAGES) {
      const html = await read(`${page.slug}index.html`);
      for (const [, href] of html.matchAll(new RegExp(`href="${REPO_URL}/blob/main/([^"#]+)`, 'g'))) {
        expect(existsSync(path.join(repoRoot, href)), `${href} from ${page.source}`).toBe(true);
      }
    }
  });

  it('makes Markdown copies link to absolute URLs', async () => {
    const markdown = await read('index.md');
    expect(markdown).toContain(`(${SITE_URL}docs/chat/index.md)`);
    expect(markdown).toContain(`(${SITE_URL}privacy/index.md)`);
    expect(markdown).not.toContain('](docs/');
  });

  it('sends people to the Chrome Web Store, tagged as coming from the website', async () => {
    const html = await read('index.html');
    const storeLink = storeUrl('html').replace(/&/g, '&amp;');
    expect(html).toContain(`<a class="button primary" href="${storeLink}" data-track="chrome_web_store">Add to Chrome</a>`);
    expect(html).toContain(`"installUrl": "${CHROME_WEB_STORE_URL}"`);
    expect(html).not.toContain(`href="${CHROME_WEB_STORE_URL}"`);
    expect(await read('llms.txt')).toContain(`(${storeUrl('markdown')})`);
    expect(await read('index.md')).toContain(`(${storeUrl('markdown')})`);
  });

  it('marks install links and code snippets so the site script can count them', async () => {
    const html = await read('index.html');
    expect(html).toContain('<header class="site-header" data-area="header">');
    expect(html).toContain('<footer class="site-footer" data-area="footer">');
    expect(html).toContain('data-track="claude_desktop_extension" href="https://github.com/lx223/agent-bridge-browser-extension/releases/latest/download/agent-browser-bridge.mcpb"');
    expect(html).toContain('<pre data-snippet="claude-code-cmd">');
    expect(html).toContain('<pre data-snippet="json-config">');
    expect(html).toContain('<pre data-snippet="safari-build">');
    expect(html).not.toMatch(/<a [^>]*href="(?:\.|#|docs\/|privacy\/)[^"]*"[^>]*data-track/);
  });

  it('loads the site script without analytics unless a PostHog key is given', async () => {
    for (const page of PAGES) {
      const html = await read(`${page.slug}index.html`);
      expect(html).toMatch(/<script src="(?:\.\.\/)*(?:\.\/)?site\.js" defer><\/script>/);
      expect(html).not.toContain('data-posthog');
    }
  });

  it('lists every page in llms.txt and the sitemap', async () => {
    const llms = await read('llms.txt');
    const sitemap = await read('sitemap.xml');
    expect(llms.startsWith('# Agent Browser Bridge\n\n> ')).toBe(true);
    for (const page of PAGES) {
      expect(llms).toContain(`(${SITE_URL}${page.slug}index.md)`);
      expect(sitemap).toContain(`<loc>${SITE_URL}${page.slug}</loc>`);
    }
  });
});

describe('site build with analytics', () => {
  let analyticsDir: string;

  beforeAll(async () => {
    analyticsDir = await mkdtemp(path.join(os.tmpdir(), 'site-analytics-'));
    await buildSite(repoRoot, analyticsDir, { analytics: { key: 'phc_example', host: 'https://eu.i.posthog.com' } });
  });

  afterAll(async () => {
    await rm(analyticsDir, { recursive: true, force: true });
  });

  it('passes the PostHog key, host and app tag to the site script', async () => {
    const html = await readFile(path.join(analyticsDir, 'docs/chat/index.html'), 'utf8');
    expect(html).toContain(
      '<script src="../../site.js" defer data-posthog-key="phc_example" data-posthog-host="https://eu.i.posthog.com" data-app="agent-browser-bridge-site"></script>',
    );
  });
});

describe('analytics settings', () => {
  it('turns analytics on only when a key is set, defaulting to the EU host', () => {
    expect(analyticsFromEnv({})).toBeUndefined();
    expect(analyticsFromEnv({ SITE_POSTHOG_KEY: ' ' })).toBeUndefined();
    expect(analyticsFromEnv({ SITE_POSTHOG_KEY: 'phc_x' })).toEqual({ key: 'phc_x', host: 'https://eu.i.posthog.com' });
    expect(analyticsFromEnv({ SITE_POSTHOG_KEY: 'phc_x', SITE_POSTHOG_HOST: 'https://us.i.posthog.com/' })).toEqual({
      key: 'phc_x',
      host: 'https://us.i.posthog.com',
    });
  });
});

describe('tracking', () => {
  it('names the destinations worth counting', () => {
    expect(linkTarget(storeUrl('html'))).toBe('chrome_web_store');
    expect(linkTarget(`${REPO_URL}/releases/latest/download/agent-browser-bridge.mcpb`)).toBe('claude_desktop_extension');
    expect(linkTarget(`${REPO_URL}/releases`)).toBe('github_releases');
    expect(linkTarget(`${REPO_URL}/blob/main/docs/asking.md`)).toBe('github_file');
    expect(linkTarget(NPM_URL)).toBe('npm');
    expect(linkTarget(REPO_URL)).toBe('github');
    expect(linkTarget('https://example.com/')).toBeUndefined();
    expect(linkTarget('../privacy/')).toBeUndefined();
  });

  it('names snippets the way the setup page does', () => {
    expect(snippetName('claude mcp add agent-browser-bridge -- npx -y agent-browser-bridge-mcp@latest')).toBe('claude-code-cmd');
    expect(snippetName('{ "mcpServers": {} }')).toBe('json-config');
    expect(snippetName('npm run build:safari -w agent-browser-bridge-extension')).toBe('safari-build');
    expect(snippetName('npm run build:site')).toBe('other');
  });

  it('tags store links by where they were followed from', () => {
    const readme = PAGES[0];
    expect(htmlLink({ href: CHROME_WEB_STORE_URL, text: 'store' }, readme).href).toBe(storeUrl('html'));
    expect(markdownHref(CHROME_WEB_STORE_URL, readme)).toBe(storeUrl('markdown'));
    expect(storeUrl('html')).toBe(`${CHROME_WEB_STORE_URL}?utm_source=website&utm_medium=html`);
  });
});

describe('links', () => {
  it('leaves anchors and absolute URLs alone', () => {
    expect(classifyLink('#safari', 'PRIVACY.md')).toEqual({ kind: 'external', href: '#safari' });
    expect(classifyLink('https://example.com/a.md', 'README.md')).toEqual({ kind: 'external', href: 'https://example.com/a.md' });
    expect(classifyLink('mailto:someone@example.com', 'README.md').kind).toBe('external');
  });

  it('resolves relative paths against the source file', () => {
    expect(classifyLink('../PRIVACY.md#usage-analytics', 'docs/chat.md')).toMatchObject({ kind: 'page', hash: '#usage-analytics' });
    expect(classifyLink('../store/safari/submission.md', 'docs/safari-app-store.md')).toEqual({
      kind: 'repo',
      repoPath: 'store/safari/submission.md',
      hash: '',
    });
  });

  it('names links to pages by the page when their text is just the path', () => {
    const sessions = PAGES.find((page) => page.source === 'docs/sessions.md')!;
    expect(htmlLink({ href: 'profiles.md', text: 'profiles.md' }, sessions)).toEqual({ href: '../profiles/', text: 'Browsers and profiles' });
    expect(htmlLink({ href: 'chat.md#x', text: 'chat.md' }, sessions)).toEqual({ href: '../chat/#x', text: 'Chat from the side panel' });
    expect(htmlLink({ href: 'updates.md', text: 'updates' }, sessions)).toEqual({ href: '../updates/', text: 'updates' });
    expect(htmlLink({ href: '../store/x.md', text: 'store/x.md' }, sessions)).toEqual({
      href: `${REPO_URL}/blob/main/store/x.md`,
      text: 'store/x.md',
    });
  });

  it('builds relative hrefs between page directories', () => {
    expect(relativeHref('', '')).toBe('./');
    expect(relativeHref('', 'docs/chat/')).toBe('docs/chat/');
    expect(relativeHref('docs/chat/', '')).toBe('../../');
    expect(relativeHref('privacy/', 'docs/chat/')).toBe('../docs/chat/');
    expect(relativeHref('docs/chat/', 'docs/chat/')).toBe('./');
  });
});

describe('markdown helpers', () => {
  it('slugs headings like GitHub', () => {
    expect(githubSlug('Riding out reconnects')).toBe('riding-out-reconnects');
    expect(githubSlug("Chrome's `debugger` permission")).toBe('chromes-debugger-permission');
    expect(githubSlug('1. Install the Chrome extension')).toBe('1-install-the-chrome-extension');
  });

  it('rewrites inline links outside code fences only', () => {
    const source = 'See [a](a.md).\n\n```md\n[b](b.md)\n```\n';
    expect(rewriteMarkdownLinks(source, (href) => `x/${href}`)).toBe('See [a](x/a.md).\n\n```md\n[b](b.md)\n```\n');
  });
});
