import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { pathToFileURL } from 'node:url';
import {
  newSessionEnv,
  projectFromPath,
  projectFromRoots,
  SESSION_ID_ENV,
  SESSION_STARTED_AT_ENV,
  sessionIdentity,
  trackProject,
} from './session.ts';

const HOME = '/home/ada';
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('session identity', () => {
  it('is created once by the launcher and handed to every worker', () => {
    const env = newSessionEnv(1234);
    expect(env[SESSION_ID_ENV]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionIdentity(env, 9999)).toEqual({ sessionId: env[SESSION_ID_ENV], startedAt: 1234 });
  });

  it('is made up by a worker started without the launcher', () => {
    const identity = sessionIdentity({}, 5678);
    expect(identity.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.startedAt).toBe(5678);
    expect(sessionIdentity({ [SESSION_STARTED_AT_ENV]: 'soon' }, 42).startedAt).toBe(42);
  });
});

describe('projectFromPath', () => {
  it('names the project after its folder', () => {
    expect(projectFromPath('/home/ada/code/shop', HOME)).toEqual({ name: 'shop', path: '/home/ada/code/shop' });
  });

  it('ignores the home folder and the filesystem root', () => {
    expect(projectFromPath(HOME, HOME)).toBeUndefined();
    expect(projectFromPath('/', HOME)).toBeUndefined();
    expect(projectFromPath('', HOME)).toBeUndefined();
  });
});

describe('projectFromRoots', () => {
  it('uses the first usable file root and its name', () => {
    expect(
      projectFromRoots(
        [
          { uri: 'https://example.com/repo' },
          { uri: pathToFileURL(HOME).href },
          { uri: pathToFileURL('/home/ada/code/shop').href, name: 'Shop' },
          { uri: pathToFileURL('/home/ada/code/other').href },
        ],
        HOME,
      ),
    ).toEqual({ name: 'Shop', path: '/home/ada/code/shop' });
  });

  it('skips malformed file uris and finds nothing in an empty list', () => {
    expect(projectFromRoots([{ uri: 'file://remote-host/share' }], HOME)).toBeUndefined();
    expect(projectFromRoots([], HOME)).toBeUndefined();
  });
});

describe('trackProject', () => {
  async function connect(roots?: () => { uri: string; name?: string }[]) {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    const client = new Client({ name: 'client', version: '1.0.0' }, { capabilities: roots ? { roots: { listChanged: true } } : {} });
    if (roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots() }));
    const found = vi.fn();
    const refresh = trackProject(server, HOME, found);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(() => client.close());
    return { client, refresh, found };
  }

  it('reads the project from the client roots and follows changes', async () => {
    let folder = '/home/ada/code/shop';
    const { client, refresh, found } = await connect(() => [{ uri: pathToFileURL(folder).href }]);
    await refresh();
    expect(found).toHaveBeenLastCalledWith({ name: 'shop', path: '/home/ada/code/shop' });
    folder = '/home/ada/code/blog';
    await client.sendRootsListChanged();
    await vi.waitFor(() => expect(found).toHaveBeenLastCalledWith({ name: 'blog', path: '/home/ada/code/blog' }));
  });

  it('does nothing for clients without roots or without a usable root', async () => {
    const plain = await connect();
    await plain.refresh();
    expect(plain.found).not.toHaveBeenCalled();
    const homeOnly = await connect(() => [{ uri: pathToFileURL(HOME).href }]);
    await homeOnly.refresh();
    expect(homeOnly.found).not.toHaveBeenCalled();
  });

  it('survives a client that fails to list its roots', async () => {
    const { refresh, found } = await connect(() => {
      throw new Error('no roots today');
    });
    await expect(refresh()).resolves.toBeUndefined();
    expect(found).not.toHaveBeenCalled();
  });
});
