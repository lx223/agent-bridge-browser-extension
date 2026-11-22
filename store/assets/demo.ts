import { createServer } from 'node:http';
import { escapeHtml } from './html.ts';
import { textDirection, topics, type Locale, type Topic } from './locale.ts';

export interface DemoSite {
  url(path: string): string;
  tabPath(topic: Topic, index: number): string;
  close(): Promise<void>;
}

const tabPath = (topic: Topic, index: number) => `/tab/${topic}/${index}`;

function articlePage(locale: Locale, title: string) {
  return `<!doctype html>
<html lang="${locale.languageTag}" dir="${textDirection(locale.languageTag)}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font: 16px/1.6 system-ui, sans-serif; color: #1f2937; }
      main { max-width: 720px; margin: 48px auto; padding: 0 24px; }
      .line { height: 12px; border-radius: 6px; background: #e5e7eb; margin: 14px 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <div class="line"></div><div class="line" style="width: 82%"></div><div class="line" style="width: 64%"></div>
    </main>
  </body>
</html>`;
}

function bookingPage(locale: Locale) {
  const text = locale.strings.booking;
  return `<!doctype html>
<html lang="${locale.languageTag}" dir="${textDirection(locale.languageTag)}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(text.restaurant)}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #292524; background: #fdf8f3; }
      .hero { background: linear-gradient(135deg, #1e3a8a, #2563eb); color: #fff; padding: 28px 36px 64px; }
      .hero h1 { margin: 0; font: 600 34px/1.2 Georgia, 'Times New Roman', serif; letter-spacing: 0.5px; }
      .tiles { display: flex; gap: 6px; margin-top: 12px; }
      .tiles span { width: 14px; height: 14px; border-radius: 3px; background: #fbbf24; }
      .tiles span:nth-child(2n) { background: #fff; opacity: 0.85; }
      .card { margin: -40px 36px 0; background: #fff; border-radius: 14px; padding: 24px 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); }
      h2 { margin: 0 0 16px; font-size: 20px; }
      form { display: grid; grid-template-columns: 1fr 120px; gap: 14px 16px; }
      label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: #57534e; }
      input { font: inherit; font-size: 16px; padding: 9px 12px; border: 1px solid #d6d3d1; border-radius: 8px; color: #1c1917; }
      .when { grid-column: 1 / -1; font-size: 15px; color: #44403c; }
      button { grid-column: 1 / -1; font: inherit; font-weight: 600; padding: 11px; border: 0; border-radius: 8px; background: #1d4ed8; color: #fff; }
      #confirmation { margin-top: 16px; padding: 12px 14px; border-radius: 8px; background: #dcfce7; color: #166534; font-weight: 600; }
      #confirmation[hidden] { display: none; }
    </style>
  </head>
  <body>
    <div class="hero">
      <h1>${escapeHtml(text.restaurant)}</h1>
      <div class="tiles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    </div>
    <div class="card">
      <h2>${escapeHtml(text.heading)}</h2>
      <form id="booking">
        <label>${escapeHtml(text.name)}<input id="name" name="name" autocomplete="off" /></label>
        <label>${escapeHtml(text.guests)}<input id="guests" name="guests" type="number" min="1" max="12" /></label>
        <div class="when"><strong>${escapeHtml(text.when)}:</strong> ${escapeHtml(text.tonight)}</div>
        <button type="submit">${escapeHtml(text.submit)}</button>
      </form>
      <div id="confirmation" role="status" hidden></div>
    </div>
    <script>
      const template = ${JSON.stringify(text.confirmation)};
      document.getElementById('booking').addEventListener('submit', (event) => {
        event.preventDefault();
        const values = { name: document.getElementById('name').value, guests: document.getElementById('guests').value };
        const confirmation = document.getElementById('confirmation');
        confirmation.textContent = template.replace(/\\{(\\w+)\\}/g, (match, key) => values[key] ?? match);
        confirmation.hidden = false;
        document.activeElement.blur();
      });
    </script>
  </body>
</html>`;
}

export function serveDemo(locale: Locale): Promise<DemoSite> {
  const routes = new Map<string, string>([['/booking', bookingPage(locale)]]);
  for (const topic of topics) {
    locale.strings.tabs.pages[topic].forEach((title, index) => routes.set(tabPath(topic, index), articlePage(locale, title)));
  }

  const server = createServer((request, response) => {
    const page = routes.get(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!page) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  });

  return new Promise((ready) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      ready({
        url: (path) => `http://127.0.0.1:${port}${path}`,
        tabPath,
        close: () => new Promise((done) => server.close(() => done())),
      });
    }),
  );
}
