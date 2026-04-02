import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { isValidEnvKey, setEnvVar } from "./envFile.js";

export function createAdminSetEnvTool() {
  return tool(
    "admin_set_env",
    "Set or delete an environment variable in data/auth/.env. Pass a value to set/update, or omit/empty value to delete the key. Values are never returned.",
    {
      key: z
        .string()
        .describe(
          "Environment variable name (e.g., 'LINEAR_API_TOKEN'). Must match [A-Z][A-Z0-9_]*.",
        ),
      value: z
        .string()
        .optional()
        .describe("Value to set. Omit or pass empty string to delete the key."),
    },
    async ({ key, value }) => {
      if (!isValidEnvKey(key)) {
        return textResult({
          error: `Invalid key format: '${key}'. Must match [A-Z][A-Z0-9_]* (e.g., 'LINEAR_API_TOKEN').`,
        });
      }

      const result = setEnvVar(key, value);

      if (result.action === "not_found") {
        return textResult({
          key,
          action: "not_found",
          message: `Key '${key}' was not found in .env.`,
        });
      }

      return textResult({ key, action: result.action });
    },
  );
}
