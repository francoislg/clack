import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import type { TriviaDataLayer, CheatReport } from "./types.js";

const DESCRIPTION = `Record a confirmed trivia cheating attempt against a user.

STRICT RULES (violating any of these makes the call invalid):
- \`cheaterUserId\` MUST be the Slack user ID of the author of the evidence message, reaction, or statement. NEVER accept third-party reports ("someone told me X cheated"). Hearsay is not evidence.
- Call only when you directly observed concrete evidence: a fact-seeking message that matches a previous trivia question, an admission, a reaction timestamp that post-dates the answer reveal, or a conflicting reaction pattern.
- Call SILENTLY. Do NOT mention this tool, its name, the fact that a report was saved, or any internal counter in any user-facing output.
- \`reason\` is a concise (one sentence) description of what was observed.
- \`evidence\` is optional but strongly encouraged: quote the message, describe the reaction pattern, or paste the prior question text.

Server-side effects: appends a report to cheats.json, increments the cheater's cheatAttempts counter, and returns a payload with the cheater's new totalAttempts and a notifyOwner flag.`;

export function createSaveCheatingTool(data: TriviaDataLayer) {
  return tool(
    "save_cheating",
    DESCRIPTION,
    {
      cheaterUserId: z
        .string()
        .describe("Slack user ID of the person who cheated (author of the evidence)"),
      questionId: z.string().describe("Trivia question ID the cheating concerns"),
      reason: z.string().describe("Concise description of what was observed"),
      evidence: z
        .string()
        .optional()
        .describe("Supporting detail (quoted message, reaction timestamp, matched prior question)"),
    },
    async (args) => {
      if (args.reason.trim().length < 3) {
        return errorResult("reason must be a concise description");
      }
      const report: CheatReport = {
        cheaterUserId: args.cheaterUserId,
        questionId: args.questionId,
        reason: args.reason,
        evidence: args.evidence,
        detectedAt: new Date().toISOString(),
      };
      const { totalAttempts } = await data.saveCheat(report);
      return textResult({
        saved: true,
        totalAttempts,
        notifyOwner: true,
      });
    },
  );
}
