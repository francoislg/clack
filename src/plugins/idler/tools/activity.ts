import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { textResult } from "../../../plugins-sdk/sdk.js";
import {
  appendActivity,
  clearActivity,
  loadActivity,
  type IdlerActivityEntry,
} from "../activity.js";
import { recordProductive } from "../breaker.js";

const ACTIVITY_KINDS = [
  "pr_opened",
  "comments_addressed",
  "review",
  "approval",
  "parked",
  "failure",
] as const;

export function createRecordActivityTool(sdk: ClackSdk) {
  return tool(
    "record_activity",
    "Append one entry to the idler activity log for the current off-hours window. Call this after every autonomous action (PR opened, comments addressed, review/approval posted, unit parked, failure) so the morning summary can report it.",
    {
      kind: z.enum(ACTIVITY_KINDS).describe("Action category"),
      unitKey: z.string().optional().describe("Related work-unit key, if any"),
      detail: z
        .string()
        .describe(
          "One-line human-readable detail for the digest. MUST include the canonical link to the artifact this action touched — the PR URL, the Slack thread permalink (for internal-conversation sources), or the external surface URL (Sentry/Asana/…). You hold this link right now from the surface you just acted on; capture it here, because the summary cannot recover it later. Also note the reason (parked) or error (failure) when applicable.",
        ),
    },
    async (args) => {
      const entry: IdlerActivityEntry = {
        at: new Date().toISOString(),
        kind: args.kind,
        unitKey: args.unitKey,
        detail: args.detail,
      };
      await appendActivity(sdk, entry);
      // Any productive activity except parking resets the empty-fire counter. Parking records
      // the disposal of a stale unit — the fire found nothing fresh, so it must not reset.
      if (args.kind !== "parked") {
        await recordProductive(sdk);
      }
      return textResult({ ok: true });
    },
  );
}

export function createReadActivityTool(sdk: ClackSdk) {
  return tool(
    "read_activity",
    "Read all idler activity-log entries for the current window, plus `windowStart` — the epoch-ms time the window began (when the log was last cleared), or null if it has never been cleared. Pass `windowStart` verbatim as find_recent_interactions' `since` to tally spend over the same window. Used by the summary task to build its digest.",
    {},
    async () => {
      const activity = await loadActivity(sdk);
      return textResult({
        count: activity.entries.length,
        entries: activity.entries,
        windowStart: activity.windowStart ?? null,
      });
    },
  );
}

export function createClearActivityTool(sdk: ClackSdk) {
  return tool(
    "clear_activity",
    "Clear the idler activity log and start the next window (stamps its start time, returned as `windowStart` by read_activity). The summary task calls this AFTER posting its digest so the next window starts fresh.",
    {},
    async () => {
      await clearActivity(sdk);
      return textResult({ ok: true });
    },
  );
}
