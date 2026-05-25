import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { loadMcpServer as defaultLoadMcpServer } from "../../mcp.js";
import {
  buildRoleChain,
  resolveTopicFiles as defaultResolveTopicFiles,
} from "../../cascadingConfigResolver.js";
import { updateSession as defaultUpdateSession } from "../../sessions.js";
import type { SessionContext } from "../../sessions.js";
import { logger } from "../../logger.js";
import { buildVirtualDefaults as defaultBuildVirtualDefaults } from "../../instructions.js";
import { getToolsGatedByIntegration as defaultGetToolsGatedByIntegration } from "../../plugins/state.js";

type McpAttachHistoryEntry = NonNullable<SessionContext["mcpAttachHistory"]>[number];

/**
 * Append a single entry to `session.mcpAttachHistory` and persist. Swallows errors
 * — logging history is best-effort; a failure must not block the tool result.
 */
async function appendAttachHistory(
  session: SessionContext,
  updateSession: typeof defaultUpdateSession,
  entry: McpAttachHistoryEntry,
): Promise<void> {
  try {
    await updateSession(session.sessionId, {
      mcpAttachHistory: [...(session.mcpAttachHistory ?? []), entry],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to append mcpAttachHistory for '${entry.name}': ${message}`);
  }
}

export interface AttachIntegrationDeps {
  loadMcpServer: typeof defaultLoadMcpServer;
  resolveTopicFiles: typeof defaultResolveTopicFiles;
  updateSession: typeof defaultUpdateSession;
  buildVirtualDefaults: typeof defaultBuildVirtualDefaults;
  getToolsGatedByIntegration: typeof defaultGetToolsGatedByIntegration;
}

export const defaultAttachIntegrationDeps: AttachIntegrationDeps = {
  loadMcpServer: defaultLoadMcpServer,
  resolveTopicFiles: defaultResolveTopicFiles,
  updateSession: defaultUpdateSession,
  buildVirtualDefaults: defaultBuildVirtualDefaults,
  getToolsGatedByIntegration: defaultGetToolsGatedByIntegration,
};

/**
 * Dynamic MCP attach tool. Claude calls `attach_integration({ name })` when a
 * question matches one of the non-always-on integrations listed in the catalog
 * (see `src/claude/integrationsCatalog.ts`). The tool:
 *   1. Validates the name against the effective registry (via the manager)
 *   2. Short-circuits on duplicate attach (idempotent) — returns a brief success
 *   3. Loads the server config (`loadMcpServer`) for MCP-backed topics
 *   4. Delegates to `mcpManager.attach(...)` which handles the SDK call and the
 *      session-start merge invariant
 *   5. Resolves the topic's instructions via the cascade resolver
 *   6. Persists the attach on the session so resume can replay it
 *   7. Returns the topic instructions as the tool's text result so they land
 *      in conversation history
 */
export function createAttachIntegrationTool(
  ctx: QueryToolContext,
  deps: AttachIntegrationDeps = defaultAttachIntegrationDeps,
) {
  return tool(
    "attach_integration",
    "Attach an external integration (MCP server + topic instructions) mid-session. Call this when the user's question matches one of the entries in the AVAILABLE INTEGRATIONS catalog. The integration's tools and instructions become available on your next turn.",
    {
      name: z.string().describe("The integration name from the AVAILABLE INTEGRATIONS catalog."),
    },
    async (args) => {
      const sessionId = ctx.session.sessionId;
      const manager = ctx.mcpManager;
      if (!manager) {
        return errorResult(
          "attach_integration is not available in this session. This is a bug — contact the operator.",
        );
      }

      if (!manager.knowsServer(args.name)) {
        const available = manager.knownNames().join(", ");
        logger.info(`mcp.attach sessionId=${sessionId} name=${args.name} outcome=unknown`);
        return errorResult(
          `Unknown integration: ${args.name}. Available integrations: ${available || "(none)"}.`,
        );
      }

      // Idempotent duplicate attach — no SDK call, no re-injection of instructions.
      if (manager.isAttached(args.name)) {
        logger.info(`mcp.attach sessionId=${sessionId} name=${args.name} outcome=duplicate`);
        await appendAttachHistory(ctx.session, deps.updateSession, {
          name: args.name,
          outcome: "duplicate",
          timestamp: Date.now(),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Integration already attached: ${args.name}. No additional action taken.`,
            },
          ],
        };
      }

      // Always-on baseline short-circuit. The integration was registered at
      // session start, so re-running `setMcpServers` would tear down and rebuild
      // every connection just to re-add a server that's already live — and that
      // re-registration is what trips the SDK's 30s connect timeout in practice.
      // Verify the server is actually `connected` before short-circuiting; if
      // it's not (startup failure, pending, etc.), fall through to a real attach
      // as graceful recovery.
      if (manager.isInSessionStart(args.name)) {
        const live = await manager.isLiveInBaseline(args.name);
        if (live) {
          logger.info(`mcp.attach sessionId=${sessionId} name=${args.name} outcome=baseline_live`);
          await appendAttachHistory(ctx.session, deps.updateSession, {
            name: args.name,
            outcome: "duplicate",
            timestamp: Date.now(),
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Integration ${args.name} is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly.`,
              },
            ],
          };
        }
        logger.warn(
          `mcp.attach sessionId=${sessionId} name=${args.name} outcome=baseline_not_live — attempting recovery attach`,
        );
      }

      // Resolve ONLY the topic-specific instructions from the cascade
      // (`{role}/topics/<name>/*.md`). Do NOT include baseline files — they are
      // already in the system prompt. Re-injecting them inflates the tool result
      // by ~30KB and starves the context window (autocompact thrash).
      const roleChain = buildRoleChain(ctx.role, ctx.changesWorkflowEnabled);
      // Plugin-registered topic instructions live in the in-memory virtual-defaults map,
      // not on disk. Pass it through so `sdk.addTopicInstruction(...)` content actually
      // resolves — without it, only on-disk overrides at `{role}/topics/<name>/*.md` are seen.
      const instructions = deps.resolveTopicFiles(
        roleChain,
        args.name,
        deps.buildVirtualDefaults(),
      );

      // Two paths: MCP-backed (load + setMcpServers) and instructions-only (no server).
      const serverConfig = await deps.loadMcpServer(args.name);

      if (serverConfig) {
        const result = await manager.attach(args.name, serverConfig);
        if (!result.ok) {
          logger.warn(
            `mcp.attach sessionId=${sessionId} name=${args.name} outcome=failed error="${result.error}"`,
          );
          await appendAttachHistory(ctx.session, deps.updateSession, {
            name: args.name,
            outcome: "failed",
            error: result.error,
            timestamp: Date.now(),
          });
          return errorResult(`Failed to attach ${args.name}: ${result.error}`);
        }
        logger.info(`mcp.attach sessionId=${sessionId} name=${args.name} outcome=ok`);
      } else {
        logger.info(
          `mcp.attach sessionId=${sessionId} name=${args.name} outcome=instructions_only`,
        );
      }

      // Persist the attach on the session so resume can replay it. Don't fail the
      // tool call if persistence errors — the attach itself succeeded.
      const currentList = ctx.session.attachedIntegrations ?? [];
      const nextList = currentList.includes(args.name) ? currentList : [...currentList, args.name];
      const outcome: "ok" | "instructions_only" = serverConfig ? "ok" : "instructions_only";
      try {
        await deps.updateSession(ctx.session.sessionId, {
          attachedIntegrations: nextList,
          mcpAttachHistory: [
            ...(ctx.session.mcpAttachHistory ?? []),
            { name: args.name, outcome, timestamp: Date.now() },
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to persist attach state for '${args.name}': ${message}`);
      }

      // Three signals decide whether to advertise "new tools": (1) an MCP server got
      // attached, (2) plugin tools are registered with `{ integration: args.name }` (the
      // gate in `src/tools/server.ts` reveals them next turn now that the integration is
      // in `attachedIntegrations`), (3) plugin topic instructions resolved. Any of the
      // three means the next turn brings new capability.
      const hasTopicInstructions = instructions.trim().length > 0;
      const gatedToolNames = deps.getToolsGatedByIntegration(args.name);
      const willHaveNewTools = !!serverConfig || gatedToolNames.length > 0;
      const kindNote = willHaveNewTools
        ? `New tools may now be available on the next turn.`
        : hasTopicInstructions
          ? `Instructions loaded. This integration has no callable tools — proceed using the integration's instructions.`
          : `This integration has no MCP server, no gated tools, and no topic instructions — nothing arrives.`;

      const body = hasTopicInstructions
        ? instructions
        : gatedToolNames.length > 0
          ? `(No topic instructions were resolved — gated tools available on the next turn: ${gatedToolNames.join(", ")})`
          : "(No topic instructions were resolved.)";

      return {
        content: [
          {
            type: "text" as const,
            text: `Attached integration: ${args.name}. ${kindNote}\n\n${body}`,
          },
        ],
      };
    },
  );
}
