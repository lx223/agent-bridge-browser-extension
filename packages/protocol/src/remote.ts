import { z } from 'zod';
import { SERVER_NAME } from './constants.ts';

export const REMOTE_EXTENSION_PATH = '/extension';
export const REMOTE_MCP_PATH = '/mcp';
export const REMOTE_SERVER_NAME = `${SERVER_NAME}-remote`;
export const REMOTE_UNAUTHORIZED_CLOSE_CODE = 4003;
export const REMOTE_FULL_CLOSE_CODE = 4004;
export const MAX_REMOTE_TOKENS = 50;

const REMOTE_TOKEN_PREFIX = 'abb_';
const SPACE_ID_LENGTH = 22;
const SECRET_BYTES = 32;
const SPACE_CONTEXT = 'agent-browser-bridge-space:';

const tokenHash = z.string().regex(/^[0-9a-f]{64}$/);
export const remoteKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const remoteAuthMessage = z.object({
  type: z.literal('remoteAuth'),
  key: remoteKey,
  tokens: z.array(tokenHash).max(MAX_REMOTE_TOKENS),
});

export const remoteTokensMessage = z.object({
  type: z.literal('remoteTokens'),
  tokens: z.array(tokenHash).max(MAX_REMOTE_TOKENS),
});

export const extensionToRemote = z.union([remoteAuthMessage, remoteTokensMessage]);

export type RemoteAuthMessage = z.infer<typeof remoteAuthMessage>;
export type RemoteTokensMessage = z.infer<typeof remoteTokensMessage>;
export type ExtensionToRemote = z.infer<typeof extensionToRemote>;

const base64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));

export const newRemoteKey = randomSecret;

export async function remoteSpaceId(key: string): Promise<string> {
  return base64url(await sha256(`${SPACE_CONTEXT}${key}`)).slice(0, SPACE_ID_LENGTH);
}

export const newRemoteToken = (spaceId: string) => `${REMOTE_TOKEN_PREFIX}${spaceId}_${randomSecret()}`;

const tokenPattern = new RegExp(`^${REMOTE_TOKEN_PREFIX}([A-Za-z0-9_-]{${SPACE_ID_LENGTH}})_[A-Za-z0-9_-]{43}$`);

export const spaceOfToken = (token: string): string | undefined => tokenPattern.exec(token)?.[1];

export async function remoteTokenHash(token: string): Promise<string> {
  return hex(await sha256(token));
}

export interface RemoteUrls {
  base: string;
  extension: string;
  mcp: string;
}

export function remoteUrls(address: string): RemoteUrls {
  const url = new URL(address.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The relay address must start with https://');
  if (url.username || url.password || url.search || url.hash) throw new Error('The relay address must not contain a user name, query or fragment');
  const path = url.pathname.replace(/\/+$/, '');
  const base = `${url.protocol}//${url.host}${path}`;
  const socket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${path}`;
  return { base, extension: `${socket}${REMOTE_EXTENSION_PATH}`, mcp: `${base}${REMOTE_MCP_PATH}` };
}
