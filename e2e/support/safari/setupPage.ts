import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { LOCAL_ONLY } from '../harness.ts';
import { defaultLocaleMessages, type Messages } from './i18n.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

export interface SafariSetupPage {
  page: Page;
  errors: string[];
  close(): Promise<void>;
}

export interface SafariSetupPageOptions {
  extensionDir: string;
  extensionOrigin: string;
  sendMessage(message: unknown): Promise<unknown>;
}

function serveExtension(extensionDir: string): Promise<Server> {
  const root = resolve(extensionDir);
  const server = createServer((request, response) => {
    const path = resolve(root, `.${new URL(request.url ?? '/', 'http://localhost').pathname}`);
    if (!path.startsWith(`${root}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

function installSafariExtensionApi({ origin, messages }: { origin: string; messages: Messages }) {
  const getMessage = (key: string, substitutions: string | string[] = []) => {
    const values = [substitutions].flat();
    return (messages[key]?.message ?? '').replace(/\$([1-9])/g, (_, slot: string) => values[Number(slot) - 1] ?? '');
  };
  const page = globalThis as unknown as { sendToBackground(message: unknown): Promise<unknown> };
  const event = { addListener() {}, removeListener() {} };
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      i18n: {
        getMessage,
        getUILanguage: () => 'en',
      },
      runtime: {
        getURL: (path = '') => `${origin}/${path.replace(/^\//, '')}`,
        sendMessage: (message: unknown) => page.sendToBackground(message),
        onMessage: event,
      },
      storage: {
        local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
        onChanged: event,
      },
    },
  });
}

export async function openSetupPageAsSafari(options: SafariSetupPageOptions): Promise<SafariSetupPage> {
  const server = await serveExtension(options.extensionDir);
  let browser: Browser | undefined;
  const close = async () => {
    await browser?.close().catch(() => {});
    await new Promise((done) => server.close(done));
  };

  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true, args: [LOCAL_ONLY] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeFunction('sendToBackground', options.sendMessage);
    await page.addInitScript(installSafariExtensionApi, {
      origin: options.extensionOrigin,
      messages: defaultLocaleMessages(options.extensionDir),
    });
    const { port } = server.address() as { port: number };
    await page.goto(`http://127.0.0.1:${port}/src/welcome/index.html`);
    return { page, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}
