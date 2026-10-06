import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { errorMessage } from "../../errors.js";
import { loadMcpServer as defaultLoadMcpServer } from "../../mcp.js";
import {
  buildRoleChain,
  resolveTopicFiles as defaultResolveTopicFiles,
} from "../../cascadingConfigResolver.js";
import { recordMcpAttach as defaultRecordMcpAttach } from "../../sessions.js";
import type { McpAttachHistoryEntry } from "../../sessions.js";
import type { AttachResult, McpServerManager } from "../../claude/mcpServerManager.js";
import { logger } from "../../logger.js";
import { buildVirtualDefaults as defaultBuildVirtualDefaults } from "../../instructions.js";

/**
 * Append a single entry to the session's `mcpAttachHistory` and persist. Swallows errors
 * — logging history is best-effort; a failure must not block the tool result.
 */
async function appendAttachHistory(
  sessionId: string,
  recordMcpAttach: typeof defaultRecordMcpAttach,
  entry: McpAttachHistoryEntry,
): Promise<void> {
  try {
    await recordMcpAttach(sessionId, entry);
  } catch (error) {
    logger.warn(`Failed to append mcpAttachHistory for '${entry.name}': ${errorMessage(error)}`);
  }
}

export interface AttachIntegrationDeps {
  loadMcpServer: typeof defaultLoadMcpServer;
  resolveTopicFiles: typeof defaultResolveTopicFiles;
  recordMcpAttach: typeof defaultRecordMcpAttach;
  buildVirtualDefaults: typeof defaultBuildVirtualDefaults;
}

export const defaultAttachIntegrationDeps: AttachIntegrationDeps = {
  loadMcpServer: defaultLoadMcpServer,
  resolveTopicFiles: defaultResolveTopicFiles,
  recordMcpAttach: defaultRecordMcpAttach,
  buildVirtualDefaults: defaultBuildVirtualDefaults,
};

const TOOLS_NOTE = [
  "Its tools are now registered.",
  "Call ToolSearch to surface them and use them to continue your work in THIS turn —",
  'do not end your turn waiting for a "next turn".',
].join(" ");

const RETRY_MAY_HELP = "Retrying attach_integration may help.";
const RETRY_WILL_NOT_HELP =
  "Retrying will not help — stop using this integration and tell the user it is unavailable right now.";

function plainTextResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

type ToolResult = ReturnType<typeof plainTextResult> | ReturnType<typeof errorResult>;

/** The per-call pieces every attach path shares, bound to one tool call. */
function createAttachRun(
  ctx: QueryToolContext,
  deps: AttachIntegrationDeps,
  manager: McpServerManager,
  name: string,
) {
  const sessionId = ctx.session.sessionId;

  const reportAttachFailure = async (error: string, retryable: boolean) => {
    logger.warn(`mcp.attach sessionId=${sessionId} name=${name} outcome=failed error="${error}"`);
    await appendAttachHistory(sessionId, deps.recordMcpAttach, {
      name,
      outcome: "failed",
      error,
      timestamp: Date.now(),
    });
    return errorResult(
      `Failed to attach ${name}: ${error} ${retryable ? RETRY_MAY_HELP : RETRY_WILL_NOT_HELP}`,
    );
  };

  // A no-op success: the integration is already in place, nothing is persisted
  // beyond the history entry and no instructions are re-injected.
  const reportNoop = async (text: string, logOutcome: string) => {
    logger.info(`mcp.attach sessionId=${sessionId} name=${name} outcome=${logOutcome}`);
    manager.recordTopicAttached(name);
    await appendAttachHistory(sessionId, deps.recordMcpAttach, {
      name,
      outcome: "duplicate",
      timestamp: Date.now(),
    });
    return plainTextResult(text);
  };

  // Persist the attach on the session so resume can replay it. Don't fail the
  // tool call if persistence errors — the attach itself succeeded.
  const recordAttach = async (outcome: "ok" | "instructions_only") => {
    logger.info(`mcp.attach sessionId=${sessionId} name=${name} outcome=${outcome}`);
    manager.recordTopicAttached(name);
    try {
      await deps.recordMcpAttach(sessionId, { name, outcome, timestamp: Date.now() }, name);
    } catch (error) {
      logger.warn(`Failed to persist attach state for '${name}': ${errorMessage(error)}`);
    }
  };

  // Resolve ONLY the topic-specific instructions from the cascade
  // (`{role}/topics/<name>/*.md`). Do NOT include baseline files — they are
  // already in the system prompt. Re-injecting them inflates the tool result
  // by ~30KB and starves the context window (autocompact thrash).
  // Plugin-registered topic instructions live in the in-memory virtual-defaults map,
  // not on disk. Pass it through so `sdk.addTopicInstruction(...)` content actually
  // resolves — without it, only on-disk overrides at `{role}/topics/<name>/*.md` are seen.
  const resolveInstructions = () =>
    deps.resolveTopicFiles(
      buildRoleChain(ctx.role, ctx.changesWorkflowEnabled),
      name,
      deps.buildVirtualDefaults(),
    );

  // Text for an attach that did work: the tools note for a server, and the topic
  // instructions unless they are already in the conversation (`instructions` null).
  const attachedText = (hasServer: boolean, instructions: string | null) => {
    if (instructions === null) return `Attached integration: ${name}. ${TOOLS_NOTE}`;
    const hasTopicInstructions = instructions.trim().length > 0;
    const kindNote = hasServer
      ? TOOLS_NOTE
      : hasTopicInstructions
        ? `Instructions loaded. This integration has no callable tools — proceed using the integration's instructions.`
        : `This integration has no MCP server and no topic instructions — nothing arrives.`;
    const body = hasTopicInstructions ? instructions : "(No topic instructions were resolved.)";
    return `Attached integration: ${name}. ${kindNote}\n\n${body}`;
  };

  return {
    deps,
    manager,
    name,
    reportAttachFailure,
    reportNoop,
    recordAttach,
    resolveInstructions,
    attachedText,
  };
}

type AttachRun = ReturnType<typeof createAttachRun>;

interface NoopReply {
  text: string;
  logOutcome: string;
}

/**
 * Turn an attach of an already-registered (or pre-attached) server into a tool result:
 * a failure, a no-op when the server was already live, or a recorded attach whose
 * text carries `instructions()` (null when they are already in the conversation).
 */
async function settleAttach(
  run: AttachRun,
  result: AttachResult,
  noop: NoopReply,
  instructions: () => string | null,
): Promise<ToolResult> {
  if (!result.ok) return run.reportAttachFailure(result.error, result.retryable);
  if (result.alreadyLive) return run.reportNoop(noop.text, noop.logOutcome);
  await run.recordAttach("ok");
  return plainTextResult(run.attachedText(true, instructions()));
}

type ConfigLoad =
  | { ok: true; config: McpServerConfig | undefined }
  | { ok: false; failure: ToolResult };

/**
 * Load a server config, turning a throw into a failed attach. Retrying may help: the
 * github entry mints a token over the network, so a throw can be transient.
 */
async function loadConfig(
  run: AttachRun,
  load: () => Promise<McpServerConfig | undefined>,
): Promise<ConfigLoad> {
  try {
    return { ok: true, config: await load() };
  } catch (error) {
    return { ok: false, failure: await run.reportAttachFailure(errorMessage(error), true) };
  }
}

/**
 * Pre-attached topics loaded their instructions into the system prompt at session
 * start, and a topic naming a server loaded that server with the session. Only an
 * external `mcp.json` server is loaded here: a pre-attached plugin on-demand server is
 * part of the session start under its SDK server name, so `getIntegrationServer`
 * would register it a second time.
 */
async function handlePreAttached(run: AttachRun): Promise<ToolResult> {
  const { manager, name } = run;
  const noop: NoopReply = {
    text: `Integration ${name} was pre-attached at session start — its instructions are already in your system prompt and any tools it provides are already loaded. No additional action taken.`,
    logOutcome: "pre_attached",
  };
  const known = manager.knowsServer(name);
  if (known && manager.isRegistered(name)) {
    return settleAttach(run, await manager.attach(name), noop, () => null);
  }
  if (!known) return run.reportNoop(noop.text, noop.logOutcome);
  const loaded = await loadConfig(run, () => run.deps.loadMcpServer(name));
  if (!loaded.ok) return loaded.failure;
  if (!loaded.config) return run.reportNoop(noop.text, noop.logOutcome);
  return settleAttach(run, await manager.attach(name, loaded.config), noop, () => null);
}

/**
 * A registered server needs no config: the manager holds it. Re-running
 * `setMcpServers` for a live server would tear down and rebuild every connection,
 * so the manager acts only when the SDK reports the server not connected. On a
 * recovery, a session-start server's instructions were never sent; a dynamic
 * server's instructions arrived with its first attach.
 */
async function handleRegistered(run: AttachRun): Promise<ToolResult> {
  const { manager, name } = run;
  const sessionStart = manager.isInSessionStart(name);
  const result = await manager.attach(name);
  const noop: NoopReply = sessionStart
    ? {
        text: `Integration ${name} is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly.`,
        logOutcome: "baseline_live",
      }
    : {
        text: `Integration already attached: ${name}. No additional action taken.`,
        logOutcome: "duplicate",
      };
  return settleAttach(run, result, noop, () => (sessionStart ? run.resolveInstructions() : null));
}

/**
 * Unified resolver: external MCP-backed (data/mcp.json) first, then plugin-registered
 * on-demand servers (built in `buildClackTools` from `sdk.registerMcpServer(...)`).
 * Both produce an McpServerConfig that `manager.attach` handles the same way; no
 * config is an instructions-only attach.
 */
async function handleUnregistered(run: AttachRun): Promise<ToolResult> {
  const { manager, name } = run;
  const instructions = run.resolveInstructions();
  const loaded = await loadConfig(
    run,
    async () => (await run.deps.loadMcpServer(name)) ?? manager.getIntegrationServer(name),
  );
  if (!loaded.ok) return loaded.failure;
  if (!loaded.config) {
    await run.recordAttach("instructions_only");
    return plainTextResult(run.attachedText(false, instructions));
  }
  const result = await manager.attach(name, loaded.config);
  if (!result.ok) return run.reportAttachFailure(result.error, result.retryable);
  await run.recordAttach("ok");
  return plainTextResult(run.attachedText(true, instructions));
}

/**
 * Dynamic MCP attach tool. Claude calls `attach_integration({ name })` when a
 * question matches one of the non-always-on integrations listed in the catalog
 * (see `src/claude/integrationsCatalog.ts`). Liveness is the manager's call:
 * `mcpManager.attach(...)` reports `alreadyLive` when the SDK already had the server
 * `connected`, and fails with an error and a `retryable` flag otherwise. The tool:
 *   1. Handles a pre-attached name, whose instructions are already in the system prompt:
 *      a name with no server behind it, or a server that is live, is a no-op; a
 *      registered server that is not live, or an external server whose pre-load failed,
 *      is recovered through `mcpManager.attach(...)` without re-injecting instructions
 *   2. Validates any other name against the effective registry (via the manager)
 *   3. For a registered server (session start or a previous attach), calls
 *      `mcpManager.attach(name)`: live → always-loaded / already-attached message;
 *      recovered → tools note (plus the topic instructions for a session-start server)
 *   4. For an unregistered name, resolves the topic's instructions via the cascade
 *      resolver and the server config (`loadMcpServer`, then plugin-registered servers);
 *      a config goes through `mcpManager.attach(name, config)`, no config is an
 *      instructions-only attach
 *   5. Records every successful attach on the manager (`recordTopicAttached`) and
 *      persists attaches that did work on the session so resume can replay them
 *   6. Returns a failure naming the error and whether retrying may help (a config load
 *      that throws may be transient, so retrying may help); a failure persists only
 *      its history entry
 */
export function createAttachIntegrationTool(
  ctx: QueryToolContext,
  deps: AttachIntegrationDeps = defaultAttachIntegrationDeps,
) {
  return tool(
    "attach_integration",
    "Attach an external integration (MCP server + topic instructions) mid-session. Call this when the user's question matches one of the entries in the AVAILABLE INTEGRATIONS catalog. The integration's tools and instructions become available immediately — surface the new tools with ToolSearch and keep working in the SAME turn; do not end your turn waiting.",
    {
      name: z.string().describe("The integration name from the AVAILABLE INTEGRATIONS catalog."),
    },
    async (args) => {
      const name = args.name;
      const manager = ctx.mcpManager;
      if (!manager) {
        return errorResult(
          "attach_integration is not available in this session. This is a bug — contact the operator.",
        );
      }
      const run = createAttachRun(ctx, deps, manager, name);

      // Checked BEFORE the registry lookup: pre-attached names (e.g. plugin topics from
      // a cron spec) need not exist in the integrations registry.
      if (ctx.preAttachedTopics?.includes(name)) return handlePreAttached(run);

      if (!manager.knowsServer(name)) {
        const available = manager.knownNames().join(", ");
        logger.info(`mcp.attach sessionId=${ctx.session.sessionId} name=${name} outcome=unknown`);
        return errorResult(
          `Unknown integration: ${name}. Available integrations: ${available || "(none)"}.`,
        );
      }

      if (manager.isRegistered(name)) return handleRegistered(run);
      return handleUnregistered(run);
    },
  );
}
