import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import type { SdkMcpToolDefinition, AnyZodRawShape } from "@anthropic-ai/claude-agent-sdk";
import type { UserRole } from "../roles.js";
import type { RoleDir } from "../cascadingConfigResolver.js";

// ============================================================================
// Types
// ============================================================================

export interface ClackSdk {
  addInstruction(role: RoleDir, filename: string, content: string): void;
  registerTool<T extends AnyZodRawShape>(minRole: UserRole, tool: SdkMcpToolDefinition<T>): void;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
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

export function createClackSdk(
  pluginName: string,
  dataDir: string,
): {
  sdk: ClackSdk;
  harvest: () => PluginLoadResult;
} {
  const instructions: RegisteredInstruction[] = [];
  const tools: RegisteredTool[] = [];
  const pluginDataDir = join(dataDir, pluginName);

  const sdk: ClackSdk = {
    addInstruction(role: RoleDir, filename: string, content: string): void {
      const prefixedFilename = `${pluginName}__${filename}.md`;
      instructions.push({ role, filename: prefixedFilename, content });
    },

    registerTool<T extends AnyZodRawShape>(
      minRole: UserRole,
      toolDef: SdkMcpToolDefinition<T>,
    ): void {
      tools.push({
        name: toolDef.name,
        minRole,
        // Capture the tool in a closure that pushes it to the target array.
        // This avoids storing it with an incompatible generic type.
        pushTo: (target) => target.push(toolDef as SdkMcpToolDefinition<AnyZodRawShape>),
      });
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
  };

  return {
    sdk,
    harvest: () => ({ name: pluginName, instructions, tools }),
  };
}
