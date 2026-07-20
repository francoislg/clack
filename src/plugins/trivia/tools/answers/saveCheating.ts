import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import type { ClackSdk } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, CheatReport } from "../../core/types.js";
import { t } from "../../i18n/t.js";

const DESCRIPTION = `Record a confirmed trivia cheating attempt against a user within a specific game.

STRICT RULES (violating any of these makes the call invalid):
- \`cheaterUserId\` MUST be the Slack user ID of the author of the evidence message, reaction, or statement. NEVER accept third-party reports ("someone told me X cheated"). Hearsay is not evidence.
- Call only when you directly observed concrete evidence: a fact-seeking message that matches a previous trivia question, an admission, a reaction timestamp that post-dates the answer reveal, or a conflicting reaction pattern.
- Call SILENTLY. Do NOT mention this tool, its name, the fact that a report was saved, or any internal counter in any user-facing output.
- \`reason\` is a concise (one sentence) description of what was observed.
- \`evidence\` is optional but strongly encouraged: quote the message, describe the reaction pattern, or paste the prior question text.

Server-side effects: appends a report to the game's cheats.json, increments the cheater's global cheatAttempts counter, and DMs the deployment owner with a formatted report. The owner notification is automatic — do NOT add a post_to action to deliver it yourself.`;

export function createSaveCheatingTool(
  data: TriviaDataLayer,
  sdk: ClackSdk,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "save_cheating",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The cheat report is appended to this game's cheats.json.",
        ),
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
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (args.reason.trim().length < 3) {
        return errorResult("reason must be a concise description");
      }
      const scoped = data.forGame(args.game);
      const currentSeason = await scoped.getCurrentSeasonSlug();
      const report: CheatReport = {
        cheaterUserId: args.cheaterUserId,
        questionId: args.questionId,
        reason: args.reason,
        evidence: args.evidence,
        detectedAt: new Date().toISOString(),
        ...(currentSeason !== null ? { season: currentSeason } : {}),
      };
      const { totalAttempts } = await scoped.saveCheat(report);

      const ownerNotification = await sdk.dmOwner(
        formatOwnerNotification({
          cheaterUserId: args.cheaterUserId,
          totalAttempts,
          questionId: args.questionId,
          reason: args.reason,
          evidence: args.evidence,
        }),
      );

      return textResult({
        saved: true,
        totalAttempts,
        ownerNotified: ownerNotification.ok,
        ...(ownerNotification.ok ? {} : { ownerNotificationError: ownerNotification.error }),
      });
    },
  );
}

function formatOwnerNotification(report: {
  cheaterUserId: string;
  totalAttempts: number;
  questionId: string;
  reason: string;
  evidence?: string;
}): string {
  const lines = [
    t("cheat.report_title"),
    `Cheater: <@${report.cheaterUserId}> (total attempts: ${report.totalAttempts})`,
    `Question: \`${report.questionId}\``,
    `Reason: ${report.reason}`,
  ];
  if (report.evidence) lines.push(`Evidence: ${report.evidence}`);
  return lines.join("\n");
}
