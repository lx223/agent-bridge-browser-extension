import { z } from 'zod';

/** Extension → server, sent once after the socket opens. */
export const helloMessage = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int(),
  extensionVersion: z.string(),
  userAgent: z.string(),
  browser: z.string().default('chrome'),
  instanceId: z.string().optional(),
  label: z.string().optional(),
  name: z.string().optional(),
});

export const agentProject = z.object({ name: z.string(), path: z.string() });

export const agentInfo = z.object({
  serverVersion: z.string(),
  client: z.object({ name: z.string(), version: z.string() }).nullable(),
  sessionId: z.string().optional(),
  startedAt: z.number().optional(),
  project: agentProject.optional(),
});

export const agentInstanceUse = z.object({
  browser: z.string(),
  instanceId: z.string().optional(),
  label: z.string().optional(),
  name: z.string().optional(),
});

export const agentActivity = z.object({
  lastUsedAt: z.number(),
  lastTool: z.string(),
  calls: z.number().int(),
  instances: z.array(agentInstanceUse),
});

export const agentSession = agentInfo.extend({ activity: agentActivity.optional() });

/** Server → extension: call a bridge method. */
export const requestMessage = z.object({
  type: z.literal('request'),
  id: z.string(),
  method: z.string(),
  params: z.unknown(),
  browser: z.string().optional(),
  instance: z.string().optional(),
  agent: agentInfo.optional(),
});

/** Extension → server: result of a request. */
export const responseMessage = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(false), error: z.string() }),
]);

/** Extension → server keepalive; WebSocket traffic keeps an MV3 service worker alive. */
export const pingMessage = z.object({ type: z.literal('ping') });
export const pongMessage = z.object({ type: z.literal('pong') });

/** Server → extension: every agent session sharing the bridge, resent whenever it changes. */
export const agentsMessage = z.object({ type: z.literal('agents'), agents: z.array(agentSession) });

export const extensionToServer = z.union([helloMessage, responseMessage, pingMessage]);
export const serverToExtension = z.union([requestMessage, pongMessage, agentsMessage]);

export type HelloMessage = z.infer<typeof helloMessage>;
export type RequestMessage = z.infer<typeof requestMessage>;
export type AgentInfo = z.infer<typeof agentInfo>;
export type AgentProject = z.infer<typeof agentProject>;
export type AgentActivity = z.infer<typeof agentActivity>;
export type AgentInstanceUse = z.infer<typeof agentInstanceUse>;
export type AgentSession = z.infer<typeof agentSession>;
export type AgentsMessage = z.infer<typeof agentsMessage>;
export type ResponseMessage = z.infer<typeof responseMessage>;
export type ExtensionToServer = z.infer<typeof extensionToServer>;
export type ServerToExtension = z.infer<typeof serverToExtension>;

export const relayStatusMessage = z.object({
  type: z.literal('status'),
  extension: helloMessage.nullable(),
  extensions: z.array(helloMessage).optional(),
});

/** Relay → host: the relaying agent session, sent on joining and whenever it changes. */
export const relayAgentMessage = z.object({ type: z.literal('agent'), agent: agentInfo });

export const relayHandoverMessage = z.object({ type: z.literal('handover') });

export const relayToHost = z.union([requestMessage, relayAgentMessage]);
export const hostToRelay = z.union([responseMessage, relayStatusMessage, relayHandoverMessage]);

export type RelayStatusMessage = z.infer<typeof relayStatusMessage>;
export type HostToRelay = z.infer<typeof hostToRelay>;
export type RelayToHost = z.infer<typeof relayToHost>;
