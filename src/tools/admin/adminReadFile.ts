import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { isAllowedPath, getAllowedPaths, readDataFile, getFormatHint } from "./allowlist.js";

export function createAdminReadFileTool() {
  return tool(
    "admin_read_file",
    "Read a core configuration file. Allowed files: config.json, mcp.json, auth/.env, configuration/tool_mapping/*.json. Pass 'configuration/tool_mapping/' to list available tool mapping files.",
    {
      path: z
        .string()
        .describe(
          "File path relative to data/ (e.g., 'config.json', 'mcp.json', 'auth/.env', 'configuration/tool_mapping/clack.json')",
        ),
    },
    async ({ path }) => {
      if (!isAllowedPath(path)) {
        return textResult({
          error: `Path '${path}' is not allowed.`,
          allowed: getAllowedPaths(),
        });
      }

      const { content, isDirectory } = readDataFile(path);

      if (isDirectory) {
        return textResult({ path, listing: content });
      }

      if (content === null) {
        return textResult({
          path,
          exists: false,
          hint: getFormatHint(path),
        });
      }

      return textResult({ path, content });
    },
  );
}
