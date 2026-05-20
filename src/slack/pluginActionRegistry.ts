import type {
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
  ViewSubmitAction,
} from "@slack/bolt";
import { logger } from "../logger.js";

/**
 * Plugin-owned Slack action handler. Receives the unmodified Bolt
 * `SlackActionMiddlewareArgs<BlockAction>` — the SDK does not wrap or strip
 * fields before delegating.
 */
export type PluginActionHandler = (
  args: SlackActionMiddlewareArgs<BlockAction>,
) => Promise<void> | void;

/**
 * Plugin-owned Slack view-submission handler. Receives the unmodified Bolt
 * `SlackViewMiddlewareArgs<ViewSubmitAction>`.
 */
export type PluginViewHandler = (
  args: SlackViewMiddlewareArgs<ViewSubmitAction>,
) => Promise<void> | void;

interface PatternEntry<H> {
  pattern: RegExp;
  handler: H;
  pluginName: string;
}

const actionHandlers = new Map<string, { handler: PluginActionHandler; pluginName: string }>();
const viewHandlers = new Map<string, { handler: PluginViewHandler; pluginName: string }>();
const actionPatterns: PatternEntry<PluginActionHandler>[] = [];
const viewPatterns: PatternEntry<PluginViewHandler>[] = [];

/**
 * Register a literal-string or RegExp action ID. `fullId` is the full prefixed
 * identifier (e.g. `plugin:trivia:answer`) — the SDK prefixes before calling here.
 * `pluginName` is the plain plugin name (no prefix) used for reload-time teardown.
 */
export function registerAction(
  fullId: string | RegExp,
  handler: PluginActionHandler,
  pluginName: string,
): void {
  if (typeof fullId === "string") {
    actionHandlers.set(fullId, { handler, pluginName });
  } else {
    actionPatterns.push({ pattern: fullId, handler, pluginName });
  }
}

export function registerView(
  fullCallbackId: string | RegExp,
  handler: PluginViewHandler,
  pluginName: string,
): void {
  if (typeof fullCallbackId === "string") {
    viewHandlers.set(fullCallbackId, { handler, pluginName });
  } else {
    viewPatterns.push({ pattern: fullCallbackId, handler, pluginName });
  }
}

/**
 * Remove every action and view handler owned by the named plugin. Called by
 * the lifecycle layer before a plugin's init is re-run.
 */
export function unregisterByPluginName(pluginName: string): void {
  for (const [key, entry] of actionHandlers) {
    if (entry.pluginName === pluginName) {
      actionHandlers.delete(key);
    }
  }
  for (const [key, entry] of viewHandlers) {
    if (entry.pluginName === pluginName) {
      viewHandlers.delete(key);
    }
  }
  for (let i = actionPatterns.length - 1; i >= 0; i--) {
    if (actionPatterns[i].pluginName === pluginName) actionPatterns.splice(i, 1);
  }
  for (let i = viewPatterns.length - 1; i >= 0; i--) {
    if (viewPatterns[i].pluginName === pluginName) viewPatterns.splice(i, 1);
  }
}

/**
 * Look up an action handler by full `action_id`. Literal map wins over patterns;
 * patterns are scanned in registration order. Returns `null` when no handler matches.
 *
 * Exposed for the slack/app.ts wildcard dispatcher and for tests asserting on
 * registry resolution semantics.
 */
export function findActionHandler(fullId: string): PluginActionHandler | null {
  const literal = actionHandlers.get(fullId);
  if (literal) return literal.handler;
  for (const entry of actionPatterns) {
    if (entry.pattern.test(fullId)) return entry.handler;
  }
  return null;
}

export function findViewHandler(fullCallbackId: string): PluginViewHandler | null {
  const literal = viewHandlers.get(fullCallbackId);
  if (literal) return literal.handler;
  for (const entry of viewPatterns) {
    if (entry.pattern.test(fullCallbackId)) return entry.handler;
  }
  return null;
}

export interface DispatchResult {
  handled: boolean;
}

/**
 * Invoke the matching action handler with the unmodified Bolt context, or report
 * `handled: false` when no handler matches. Used by the `slack/app.ts` wildcard
 * dispatcher.
 */
export async function dispatchAction(
  fullId: string,
  args: SlackActionMiddlewareArgs<BlockAction>,
): Promise<DispatchResult> {
  const handler = findActionHandler(fullId);
  if (!handler) return { handled: false };
  await handler(args);
  return { handled: true };
}

export async function dispatchView(
  fullCallbackId: string,
  args: SlackViewMiddlewareArgs<ViewSubmitAction>,
): Promise<DispatchResult> {
  const handler = findViewHandler(fullCallbackId);
  if (!handler) return { handled: false };
  await handler(args);
  return { handled: true };
}

/** Test-only: clear the entire registry. */
export function __resetForTests(): void {
  actionHandlers.clear();
  viewHandlers.clear();
  actionPatterns.length = 0;
  viewPatterns.length = 0;
}

/** Test-only: introspect current sizes for assertions. */
export function __sizesForTests(): {
  actionLiterals: number;
  actionPatterns: number;
  viewLiterals: number;
  viewPatterns: number;
} {
  return {
    actionLiterals: actionHandlers.size,
    actionPatterns: actionPatterns.length,
    viewLiterals: viewHandlers.size,
    viewPatterns: viewPatterns.length,
  };
}

/** Log helper for the orphan-warning path on unhandled `plugin:`-prefixed IDs. */
export function logOrphanAction(fullId: string): void {
  logger.warn(`No plugin handler registered for action_id "${fullId}"`);
}

export function logOrphanView(fullCallbackId: string): void {
  logger.warn(`No plugin handler registered for view callback_id "${fullCallbackId}"`);
}
