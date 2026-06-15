import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { textResult } from "../helpers.js";
import { FETCH_INSTRUCTIONS_PATH, loadFetchInstructions } from "../fetchInstructions.js";

export function createReadFetchInstructionsTool(sdk: ClackSdk) {
  return tool(
    "read_idler_fetch_instructions",
    "Read the idler's admin-editable sourcing guidance (`fetch-instructions.md`) — WHICH work to look " +
      "for and HOW to read/comment on each source. Returns the current content (the shipped default " +
      "if the file has never been edited). This is separate from the shipped safety/behavior contract, " +
      "which is not editable here.",
    {},
    async () => {
      const content = await loadFetchInstructions(sdk);
      return textResult({ content });
    },
  );
}

export function createUpdateFetchInstructionsTool(sdk: ClackSdk) {
  return tool(
    "update_idler_fetch_instructions",
    "Replace the idler's sourcing guidance (`fetch-instructions.md`) with new content. The whole file " +
      "is overwritten — pass the full intended content, not a patch. Hot-reloads on the next sync/work " +
      "fire. Only governs WHAT the idler fetches; it cannot alter the shipped safety/behavior contract.",
    {
      content: z
        .string()
        .min(1)
        .describe("Full markdown content for fetch-instructions.md (replaces the file)"),
    },
    async (args) => {
      await sdk.writeFile(FETCH_INSTRUCTIONS_PATH, args.content);
      return textResult({ ok: true, message: "Idler fetch instructions updated." });
    },
  );
}
