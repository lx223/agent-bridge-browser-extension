import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type HelloMessage } from '@agent-browser-bridge/protocol';
import { missingToolMessage, updateNotice } from './outdated.ts';

const hello = (extensionVersion: string, extra: Partial<HelloMessage> = {}): HelloMessage => ({
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  extensionVersion,
  userAgent: 'test',
  browser: 'chrome',
  ...extra,
});

describe('missingToolMessage', () => {
  it('names the versions, the tool and how to update Chrome', () => {
    expect(missingToolMessage(hello('0.3.0', { label: 'Chrome' }), 'chrome_tabs_update', '0.5.0')).toBe(
      'The Chrome extension is version 0.3.0, older than this server (0.5.0), and does not have chrome_tabs_update. Ask the user to quit and reopen Chrome, which installs the waiting extension update.',
    );
  });

  it('uses the browser label and leaves out an unknown server version', () => {
    expect(missingToolMessage(hello('0.4.1', { label: 'Edge' }), 'chrome_tabs_wait_for')).toBe(
      'The Edge extension is version 0.4.1 and does not have chrome_tabs_wait_for. Ask the user to quit and reopen Edge, which installs the waiting extension update.',
    );
  });

  it('points Safari users to the Mac App Store', () => {
    expect(missingToolMessage(hello('0.5.0', { browser: 'safari' }), 'safari_tabs_wait_for', '0.6.0')).toMatch(
      /^The Safari extension is version 0\.5\.0, .* Ask the user to update Agent Browser Bridge from the Mac App Store\.$/,
    );
  });
});

describe('updateNotice', () => {
  it('asks for a browser restart when the extension cannot apply updates by itself', () => {
    expect(updateNotice(hello('0.3.0'))).toBe(
      'The Chrome extension is version 0.3.0, which cannot install updates while it is connected to an agent. Tell the user to quit and reopen Chrome to install the latest version.',
    );
  });

  it('stays quiet for extensions that update themselves and for Safari', () => {
    expect(updateNotice(hello('0.4.0'))).toBeUndefined();
    expect(updateNotice(hello('1.0.0'))).toBeUndefined();
    expect(updateNotice(hello('0.3.0', { browser: 'safari' }))).toBeUndefined();
  });
});
