/**
 * Builds the investigation delivery-context block injected into `session.additionalSystemPrompt`
 * so Claude knows it is writing to an investigation surface, which followed threads are
 * read-only inputs (with their modes and pending counts), and which lifecycle tools it has.
 */

import type { FollowedThread, InvestigationSurface } from "./types.js";

export interface InvestigationContextArgs {
  surface: InvestigationSurface;
  followedThreads: FollowedThread[];
  /** Optional short subject/topic for the investigation. */
  subject?: string;
}

export function buildInvestigationDeliveryContext(args: InvestigationContextArgs): string {
  const { surface, followedThreads, subject } = args;
  const parts: string[] = ["INVESTIGATION SURFACE"];
  if (subject) parts.push(`Subject: ${subject}`);

  parts.push(
    surface === "dm"
      ? "You are writing in a direct-message investigation thread. Everything you post is delivered here; this is the only surface you write to."
      : "You are writing in a dedicated investigation channel thread. Post your findings here; this is the only surface you write to.",
  );

  if (followedThreads.length > 0) {
    const rows = followedThreads.map((t) => {
      const pending =
        t.mode === "follow" && t.pendingCount > 0
          ? ` — ${t.pendingCount} new message(s) available to read`
          : "";
      return `  - thread in <#${t.channel}> [${t.mode}]${pending}`;
    });
    parts.push(
      "You are FOLLOWING these threads as read-only sources — NEVER post to them; their content arrives injected into your context:\n" +
        rows.join("\n"),
    );
  }

  parts.push(
    "Manage this investigation with the tools: `follow_thread` (add a source thread), " +
      "`unfollow_thread`, `list_followed_threads`, and `close_investigation` when the work is done.",
  );

  return parts.join("\n\n");
}
