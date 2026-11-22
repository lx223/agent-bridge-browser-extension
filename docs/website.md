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

## Building and deploying

```bash
npm run build:site
```

This writes the site to `site/dist/`. Presubmit runs the build and the tests in `site/build.test.ts`, which check that every in-site link and anchor resolves and every repository link points at a file that exists.

The Publish website workflow (`.github/workflows/pages.yml`) builds and deploys the site on every push to `main`, and can be run by hand. It needs GitHub Pages turned on once, under **Settings > Pages**, with **Source** set to **GitHub Actions**.
