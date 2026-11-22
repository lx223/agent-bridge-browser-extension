import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSite } from './build.ts';
import { PAGES, REPO_URL, SITE_URL } from './config.ts';
import { classifyLink, htmlLink, relativeHref } from './links.ts';
import { githubSlug, rewriteMarkdownLinks } from './markdown.ts';

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
    expect(files).toEqual(expect.arrayContaining(['llms.txt', 'sitemap.xml', 'style.css', 'icon.svg', '.nojekyll']));
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
