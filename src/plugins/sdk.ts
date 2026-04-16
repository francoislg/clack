import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import {
  createSdkMcpServer,
  type SdkMcpToolDefinition,
  type AnyZodRawShape,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import { loadRoles, type UserRole } from "../roles.js";
import type { RoleDir } from "../cascadingConfigResolver.js";
import type { ToolEntryObject } from "../streaming/toolMappingLoader.js";
import { openDmChannel } from "../slack/channelResolver.js";
import { getSlackClient as defaultGetSlackClient } from "../slack/app.js";
import { logger } from "../logger.js";

// ============================================================================
// Types
// ============================================================================

/** Tool mapping entry — same format as tool_mapping JSON config entries. */
export type ToolMapping = string | ToolEntryObject;

export interface ClackSdk {
  addInstruction(role: RoleDir, filename: string, content: string): void;
  /**
   * Register an MCP tool with a minimum role requirement and a Slack task card mapping.
   * @param mapping — Display label for Slack task cards. Either a template string with `{argName}` interpolation,
   *   or an object with `label`, optional `group`, and optional `itemDetail`.
   */
  registerTool<T extends AnyZodRawShape>(
    minRole: UserRole,
    tool: SdkMcpToolDefinition<T>,
    mapping: ToolMapping,
  ): void;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Send a DM to the deployment owner (the user with the `owner` role).
   *
   * Resolved server-side: the owner ID is read from roles, the DM channel is opened
   * via `conversations.open`, and the message is posted via `chat.postMessage`. The
   * recipient is decided here (not by Claude) — this is the safe path for plugins
   * that need to notify the owner without exposing user-targeted DMing as a tool
   * surface to Claude.
   */
  dmOwner(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type ClackPlugin = (sdk: ClackSdk) => Promise<void>;

export interface RegisteredInstruction {
  role: RoleDir;
  filename: string;
  content: string;
}

/**
 * A registered tool with its minimum role requirement.
 * The `name` field is extracted for duplicate detection.
 * `pushTo` appends the tool to a heterogeneous array (handles the generic cast internally).
 */
export interface RegisteredTool {
  name: string;
  minRole: UserRole;
  pushTo: (target: SdkMcpToolDefinition<AnyZodRawShape>[]) => void;
}

export interface PluginLoadResult {
  name: string;
  instructions: RegisteredInstruction[];
  tools: RegisteredTool[];
  /** Tool name → mapping entry for Slack task cards. */
  toolMappings: Map<string, ToolMapping>;
  /** Dedicated MCP server hosting this plugin's tools, namespaced under the plugin's name. */
  mcpServer: McpSdkServerConfigWithInstance;
}

// ============================================================================
// Path validation
// ============================================================================

function validateRelativePath(path: string): void {
  if (isAbsolute(path)) {
    throw new Error(`Absolute paths are not allowed: ${path}`);
  }
  const normalized = normalize(path);
  if (normalized.startsWith("..")) {
    throw new Error(`Path traversal is not allowed: ${path}`);
  }
}

// ============================================================================
// SDK Factory
// ============================================================================

export interface ClackSdkDeps {
  /** Lazy getter — plugins load before the Slack client is connected, so this is called at tool-invocation time. */
  getSlackClient: () => App["client"] | null;
  loadRoles: typeof loadRoles;
  openDmChannel: typeof openDmChannel;
}

export const defaultClackSdkDeps: ClackSdkDeps = {
  getSlackClient: defaultGetSlackClient,
  loadRoles,
  openDmChannel,
};

export function createClackSdk(
  pluginName: string,
  dataDir: string,
  deps: ClackSdkDeps = defaultClackSdkDeps,
): {
  sdk: ClackSdk;
  harvest: () => PluginLoadResult;
} {
  const instructions: RegisteredInstruction[] = [];
  const tools: RegisteredTool[] = [];
  const toolMappings = new Map<string, ToolMapping>();
  const pluginDataDir = join(dataDir, pluginName);

  const sdk: ClackSdk = {
    addInstruction(role: RoleDir, filename: string, content: string): void {
      const prefixedFilename = `${pluginName}__${filename}.md`;
      instructions.push({ role, filename: prefixedFilename, content });
    },

    registerTool<T extends AnyZodRawShape>(
      minRole: UserRole,
      toolDef: SdkMcpToolDefinition<T>,
      mapping: ToolMapping,
    ): void {
      tools.push({
        name: toolDef.name,
        minRole,
        // Capture the tool in a closure that pushes it to the target array.
        // This avoids storing it with an incompatible generic type.
        pushTo: (target) => target.push(toolDef as SdkMcpToolDefinition<AnyZodRawShape>),
      });
      toolMappings.set(toolDef.name, mapping);
    },

    async readFile(path: string): Promise<string | null> {
      validateRelativePath(path);
      const fullPath = join(pluginDataDir, path);
      try {
        return await readFile(fullPath, "utf-8");
      } catch {
        return null;
      }
    },

    async writeFile(path: string, content: string): Promise<void> {
      validateRelativePath(path);
      const fullPath = join(pluginDataDir, path);
      const parentDir = join(fullPath, "..");
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }
      await writeFile(fullPath, content, "utf-8");
    },

    async dmOwner(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const client = deps.getSlackClient();
      if (!client) {
        const error = "Slack client is not connected";
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      const roles = await deps.loadRoles();
      if (!roles.owner) {
        const error = "No owner is configured (set one via the Home Tab)";
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      const dmChannelId = await deps.openDmChannel(client, roles.owner);
      if (!dmChannelId) {
        const error = `Could not open a DM with the owner (${roles.owner})`;
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      try {
        await client.chat.postMessage({ channel: dmChannelId, text });
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`[plugin:${pluginName}] dmOwner postMessage failed: ${error}`);
        return { ok: false, error };
      }
    },
  };

  return {
    sdk,
    harvest: () => {
      // Materialize the plugin tool definitions into a heterogeneous array for the MCP server.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolDefs: SdkMcpToolDefinition<any>[] = [];
      for (const registered of tools) {
        registered.pushTo(toolDefs);
      }
      const mcpServer = createSdkMcpServer({
        name: pluginName,
        version: "1.0.0",
        tools: toolDefs,
      });
      return {
        name: pluginName,
        instructions,
        tools,
        toolMappings,
        mcpServer,
      };
    },
  };
}
