import { z } from 'zod';

/** Extension → server, sent once after the socket opens. */
export const helloMessage = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int(),
  extensionVersion: z.string(),
  userAgent: z.string(),
});

/** Server → extension: call a bridge method. */
export const requestMessage = z.object({
  type: z.literal('request'),
  id: z.string(),
  method: z.string(),
  params: z.unknown(),
});

/** Extension → server: result of a request. */
export const responseMessage = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(false), error: z.string() }),
]);

/** Extension → server keepalive; WebSocket traffic keeps an MV3 service worker alive. */
export const agentInfo = z.object({
  serverVersion: z.string(),
  client: z.object({ name: z.string(), version: z.string() }).nullable(),
});

export const welcomeMessage = agentInfo.extend({ type: z.literal('welcome') });

export const pingMessage = z.object({ type: z.literal('ping') });
export const pongMessage = z.object({ type: z.literal('pong') });

export const extensionToServer = z.union([helloMessage, responseMessage, pingMessage]);
export const serverToExtension = z.union([requestMessage, pongMessage, welcomeMessage]);

export type HelloMessage = z.infer<typeof helloMessage>;
export type RequestMessage = z.infer<typeof requestMessage>;
export type AgentInfo = z.infer<typeof agentInfo>;
export type WelcomeMessage = z.infer<typeof welcomeMessage>;
export type ResponseMessage = z.infer<typeof responseMessage>;
export type ExtensionToServer = z.infer<typeof extensionToServer>;
export type ServerToExtension = z.infer<typeof serverToExtension>;
