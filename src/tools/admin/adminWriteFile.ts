import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { isAllowedPath, getAllowedPaths, validateContent, writeDataFile } from "./allowlist.js";

export function createAdminWriteFileTool() {
  return tool(
    "admin_write_file",
    "Write to a core configuration file with validation. Validates content before writing (JSON parse, config schema, dotenv syntax). Allowed files: config.json, mcp.json, auth/.env, configuration/tool_mapping/*.json.",
    {
      path: z.string().describe("File path relative to data/ (e.g., 'config.json', 'mcp.json')"),
      content: z.string().describe("Full file content to write"),
    },
    async ({ path, content }) => {
      if (!isAllowedPath(path) || path.endsWith("/")) {
        return textResult({
          error: `Path '${path}' is not allowed for writing.`,
          allowed: getAllowedPaths(),
        });
      }

      const validation = validateContent(path, content);
      if (!validation.valid) {
        return textResult({
          error: "Validation failed — file was NOT written.",
          detail: validation.error,
          path,
        });
      }

      writeDataFile(path, content);

      return textResult({
        success: true,
        path,
        message: `File written successfully. Run admin_restart_app to apply changes.`,
      });
    },
  );
}
