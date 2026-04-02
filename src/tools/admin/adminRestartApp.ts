import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { restartAll } from "../../lifecycle.js";

export function createAdminRestartAppTool() {
  return tool(
    "admin_restart_app",
    "Perform a soft application restart: reload config, reset all caches, restart schedulers, re-sync repositories. The Slack connection stays up throughout.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      try {
        const summary = await restartAll();

        return textResult({
          success: true,
          repoCount: summary.repoCount,
          warnings: summary.warnings.length > 0 ? summary.warnings : undefined,
          message:
            summary.warnings.length > 0
              ? "Restart completed with warnings."
              : "Restart completed successfully.",
        });
      } catch (error) {
        return textResult({
          success: false,
          error: `Restart failed: ${error instanceof Error ? error.message : String(error)}`,
          message: "The app continues running with its previous configuration.",
        });
      }
    },
  );
}
