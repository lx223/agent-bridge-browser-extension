import { z } from 'zod';
import { SERVER_NAME } from './constants.ts';

export const REMOTE_EXTENSION_PATH = '/extension';
export const REMOTE_MCP_PATH = '/mcp';
export const REMOTE_SERVER_NAME = `${SERVER_NAME}-remote`;
export const REMOTE_UNAUTHORIZED_CLOSE_CODE = 4003;
export const REMOTE_FULL_CLOSE_CODE = 4004;
export const MIN_REMOTE_TOKEN_LENGTH = 32;
export const MAX_REMOTE_TOKEN_LENGTH = 512;
export const AGENT_TOKEN_ENV = 'AGENT_BROWSER_BRIDGE_AGENT_TOKEN';
export const BROWSER_TOKEN_ENV = 'AGENT_BROWSER_BRIDGE_BROWSER_TOKEN';

const NONCE_BYTES = 32;
const TOKEN_BYTES = 32;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const proof = z.string().regex(/^[0-9a-f]{64}$/);

export const remoteChallengeMessage = z.object({ type: z.literal('remoteChallenge'), nonce });
export const remoteAuthMessage = z.object({ type: z.literal('remoteAuth'), nonce, proof });
export const remoteWelcomeMessage = z.object({ type: z.literal('remoteWelcome'), proof });

export type RemoteChallengeMessage = z.infer<typeof remoteChallengeMessage>;
export type RemoteAuthMessage = z.infer<typeof remoteAuthMessage>;
export type RemoteWelcomeMessage = z.infer<typeof remoteWelcomeMessage>;
export type ExtensionToRemote = RemoteAuthMessage;

export type RemoteRole = 'browser' | 'relay';

const base64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const randomText = (size: number) => base64url(crypto.getRandomValues(new Uint8Array(size)));

export const newRemoteNonce = () => randomText(NONCE_BYTES);

export const newRemoteToken = () => randomText(TOKEN_BYTES);

export interface ProofInput {
  role: RemoteRole;
  relayHost: string;
  relayNonce: string;
  browserNonce: string;
}

export const normalizeRelayHost = (host: string) => host.trim().toLowerCase();

export async function remoteProof(token: string, { role, relayHost, relayNonce, browserNonce }: ProofInput): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const text = `agent-browser-bridge/${role}\n${normalizeRelayHost(relayHost)}\n${relayNonce}\n${browserNonce}`;
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))));
}

export function sameProof(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export function remoteTokenProblem(token: string | undefined): string | undefined {
  if (!token) return 'is not set';
  if (token !== token.trim()) return 'has spaces at the start or end';
  if (token.length < MIN_REMOTE_TOKEN_LENGTH) return `is shorter than ${MIN_REMOTE_TOKEN_LENGTH} characters`;
  if (token.length > MAX_REMOTE_TOKEN_LENGTH) return `is longer than ${MAX_REMOTE_TOKEN_LENGTH} characters`;
  return undefined;
}

export interface RemoteUrls {
  base: string;
  host: string;
  extension: string;
  mcp: string;
}

export const isLocalHost = (hostname: string) => LOCAL_HOSTS.has(hostname);

export function remoteUrls(address: string): RemoteUrls {
  const url = new URL(address.trim());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error('The relay address must start with https://');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('The relay address must not contain a user name, query or fragment');
  const path = url.pathname.replace(/\/+$/, '');
  const base = `${url.protocol}//${url.host}${path}`;
  const socket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${path}`;
  return { base, host: normalizeRelayHost(url.host), extension: `${socket}${REMOTE_EXTENSION_PATH}`, mcp: `${base}${REMOTE_MCP_PATH}` };
}
