import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { listEnvKeys } from "./envFile.js";

export function createAdminListEnvTool() {
  return tool(
    "admin_list_env",
    "List the names of configured environment variables in data/auth/.env. Returns key names only — values are never shown.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      const keys = listEnvKeys();
      if (keys.length === 0) {
        return textResult({ keys: [], message: "No environment variables configured." });
      }
      return textResult({ keys });
    },
  );
}
