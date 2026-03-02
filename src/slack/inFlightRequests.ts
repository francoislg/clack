import { logger } from "../logger.js";

export interface ThinkingState {
  messageTs?: string;
  usedEmoji: boolean;
  emoji?: string;
}

export interface InFlightRequest {
  abortController: AbortController;
  sessionId: string;
  triggerType: "directMessages" | "mentions";
  thinkingState: ThinkingState;
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
  logger.debug(`Registered in-flight request: ${key} (session: ${request.sessionId})`);
}

export function deregisterInFlightRequest(channelId: string, messageTs: string): void {
  const key = makeKey(channelId, messageTs);
  if (registry.delete(key)) {
    logger.debug(`Deregistered in-flight request: ${key}`);
  }
}

export function getInFlightRequest(channelId: string, messageTs: string): InFlightRequest | undefined {
  return registry.get(makeKey(channelId, messageTs));
}
