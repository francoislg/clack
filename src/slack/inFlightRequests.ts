import { logger } from "../logger.js";

export interface InFlightRequest {
  abortController: AbortController;
  sessionId: string;
  triggerType: "directMessages" | "mentions" | "reactions";
  /** The thread this request belongs to. For top-level (non-threaded) triggering messages, equals the message's own ts. */
  threadTs: string;
}

const registry = new Map<string, InFlightRequest>();

function makeKey(channelId: string, messageTs: string): string {
  return `${channelId}:${messageTs}`;
}

export function registerInFlightRequest(
  channelId: string,
  messageTs: string,
  request: InFlightRequest,
): void {
  const key = makeKey(channelId, messageTs);
  registry.set(key, request);
  logger.debug(
    `Registered in-flight request: ${key} (session: ${request.sessionId}, thread: ${request.threadTs})`,
  );
}

export function deregisterInFlightRequest(channelId: string, messageTs: string): void {
  const key = makeKey(channelId, messageTs);
  if (registry.delete(key)) {
    logger.debug(`Deregistered in-flight request: ${key}`);
  }
}

export function getInFlightRequest(
  channelId: string,
  messageTs: string,
): InFlightRequest | undefined {
  return registry.get(makeKey(channelId, messageTs));
}

/** Returns all in-flight requests whose channel and thread match. */
export function findInFlightByThread(
  channelId: string,
  threadTs: string,
): { key: string; request: InFlightRequest }[] {
  const matches: { key: string; request: InFlightRequest }[] = [];
  for (const [key, request] of registry.entries()) {
    if (request.threadTs === threadTs && key.startsWith(`${channelId}:`)) {
      matches.push({ key, request });
    }
  }
  return matches;
}
