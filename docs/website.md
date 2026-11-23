# Website

The project website is served by GitHub Pages at <https://lanxiao.dev/agent-bridge-browser-extension/>. GitHub serves it on `lanxiao.dev` because the `lx223/lx223.github.io` user site uses that custom domain, and project sites inherit it under their repository name. No DNS record or `CNAME` file is needed in this repository.

## What is published

The site is generated from the Markdown already in the repository, so it stays in step with it:

| Page | Source |
| --- | --- |
| `/` | `README.md` |
| `/docs/chat/`, `/docs/sessions/`, `/docs/profiles/`, `/docs/waiting/`, `/docs/updates/`, `/docs/localisation/` | The matching file in `docs/` |
| `/privacy/` | `PRIVACY.md` |

The list lives in `site/config.ts`. Maintainer docs such as release and testing notes are not published; links to them, and to any other repository file, point at the file on GitHub.

## Discoverability

Each page carries a canonical URL, a meta description, Open Graph tags and schema.org JSON-LD (`SoftwareApplication` on the home page, `TechArticle` on the others). Headings get the same anchors GitHub gives them, so links such as `PRIVACY.md#safari` keep working.

For agents and AI search, every page also has a Markdown copy at `index.md` next to its `index.html`, advertised with `<link rel="alternate" type="text/markdown">`, with links made absolute. `llms.txt` at the site root lists every page with its description, and `sitemap.xml` lists the HTML pages.

`robots.txt` is only read from the root of a domain, so it belongs to the `lanxiao.dev` user site rather than this one. No `robots.txt` there means crawlers may index everything.

## Analytics

The site counts visits and install intent with PostHog in cookieless mode, in the same PostHog project as the extension. The [privacy policy](../PRIVACY.md#website) describes it for visitors.

`site/site.js` is the only script on the site. It adds a **Copy** button to each code block and, when the build was given a PostHog key, loads the PostHog web SDK from `eu-assets.i.posthog.com` with cookies, storage, autocapture, session recording, heatmaps, surveys and feature flags all off. Every event carries `app: agent-browser-bridge-site`, which keeps the site apart from the extension's `agent-browser-bridge` events.

| Event | When | Properties |
| --- | --- | --- |
| `$pageview`, `$pageleave` | A page opens or closes | PostHog's standard page, referrer and UTM properties |
| `site_install_viewed` | The home page's Install heading scrolls into view, once per page view | |
| `site_link_clicked` | A tracked link is followed | `target`: `chrome_web_store`, `github_releases`, `claude_desktop_extension`, `github_file`, `github` or `npm`; `placement`: `header`, `hero`, `content` or `footer` |
| `site_snippet_copied` | A code block is copied | `snippet`: `claude-code-cmd`, `json-config`, `safari-build` or `other`, named like the setup page's snippets; `method`: `button` or `selection` |

The build decides which links and snippets are tracked: `site/tracking.ts` names them, and the build adds them to the HTML as `data-track` and `data-snippet` attributes. Links between the site's own pages are not tracked; page views cover them.

Links to the Chrome Web Store get `utm_source=website`, with `utm_medium=html` on the HTML pages and `utm_medium=markdown` in the Markdown copies and `llms.txt`. The store's statistics then show installs that started on the site, including ones where an agent read the Markdown and passed the link on, which the site script cannot see. The extension's `extension_installed` and `extension_active` events carry `install_type` (`normal` for a store install, `development` for an unpacked ZIP), so PostHog shows how many people install from the store.

The build turns analytics on only when `SITE_POSTHOG_KEY` is set; `SITE_POSTHOG_HOST` defaults to `https://eu.i.posthog.com`. The Publish website workflow sets both. Local builds without the key ship the same pages with the copy buttons and no analytics.

Cookieless events are dropped unless the PostHog project has cookieless tracking turned on, under **Settings > Project > Web analytics**. The **Agent Browser Bridge** dashboard in PostHog has a Website section built from these events.

## Building and deploying

```bash
npm run build:site
```

This writes the site to `site/dist/`. Presubmit runs the build and the tests in `site/build.test.ts`, which check that every in-site link and anchor resolves and every repository link points at a file that exists.

The Publish website workflow (`.github/workflows/pages.yml`) builds and deploys the site on every push to `main`, and can be run by hand. It needs GitHub Pages turned on once, under **Settings > Pages**, with **Source** set to **GitHub Actions**.
