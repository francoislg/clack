import type { CasualTalkChannel } from "./types.js";
import { normalizeChannel } from "./types.js";

interface BuildPromptArgs {
  die: number;
  rateLabel: string;
  channels: CasualTalkChannel[];
  smallTalkTopics: string[];
}

/**
 * Assemble the LEAN triggering prompt for the chatter cron: the roll step plus the
 * config-derived context (die, candidate channels, fallback topics, skip-strictness
 * variant). ~90% of fires are misses that never need more, so the engagement mechanics
 * (channel triage, reacting, posting/termination) live in the attachable
 * `casual-talk:engagement` topic instead — the hit directive right under the roll tells
 * Claude to attach it (plus `response-rendering`) before engaging. Built at reconcile
 * time; config edits hot-reload by rebuilding this prompt, never the topic.
 */
export function buildPrompt(args: BuildPromptArgs): string {
  const { die, rateLabel, channels, smallTalkTopics } = args;

  const channelBlock =
    channels.length === 0
      ? "(no channels configured)"
      : channels
          .map((entry) => {
            const { id, promptSuggestion } = normalizeChannel(entry);
            const suggestion = promptSuggestion ? ` — hint: ${promptSuggestion}` : "";
            return `- ${id}${suggestion}`;
          })
          .join("\n");

  const hasTopics = smallTalkTopics.length > 0;
  const topicsBlock = hasTopics
    ? smallTalkTopics.map((t) => `- ${t}`).join("\n")
    : "(no fallback topics configured)";

  // A hit means "post this tick." When fallback topics exist, a quiet day is no excuse to
  // skip — open fresh small talk instead. Skipping is reserved for genuine impossibility.
  // With NO topics, the plugin is chip-in-only, so a quiet day legitimately ends in a skip.
  const skipRules = hasTopics
    ? [
        `## Skip rules — skipping a hit is RARE`,
        ``,
        `On a hit, this tick engages. Reading the channels decides WHERE and HOW, never WHETHER. "Nothing is active right now" is NOT a reason to skip — that is exactly when you post a fresh small-talk opener, or react to a recent message. A quiet day is the normal case, not an error.`,
        ``,
        `Only skip — \`submit_response({ skip_response: true })\` with no \`deliver_to\` AND no reactions — when engaging is genuinely impossible: every candidate channel errored or was inaccessible when you tried to read it. A channel being full of OTHER bots' posts (trivia, digests, notices) is NOT impossibility — a fresh opener is a new conversation, so post it. Do NOT use the skip as a default escape hatch; if you have at least one readable channel, you engage.`,
      ]
    : [
        `## Skip rules — chip-in-only mode`,
        ``,
        `No fallback small-talk topics are configured, so a hit never opens fresh small talk — it can only chip into already-active conversations or react to a recent message. If no candidate channel has a conversation worth joining AND nothing is worth reacting to, end with \`submit_response({ skip_response: true })\` and no \`deliver_to\`. On a quiet day that is the expected outcome in this configuration.`,
      ];

  return [
    `# Casual-talk run`,
    ``,
    `You are about to roll for a casual chatter post. Rate: ${rateLabel}.`,
    ``,
    `## Step 1 — Roll`,
    ``,
    `Call \`random_roll\` with \`min: 1, max: ${die}, count: 1\`.`,
    ``,
    `If the roll is NOT exactly 1, immediately call \`submit_response({ skip_response: true })\` and end the run. Do NOT post anywhere and do NOT attach anything. (~${Math.round(((die - 1) / die) * 100)}% of fires end here — this is the expected behavior.)`,
    ``,
    `If the roll IS exactly 1: BEFORE anything else, call \`attach_integration("casual-talk:engagement")\` and \`attach_integration("response-rendering")\` — the first loads the engagement instructions (channel triage, reacting, posting, termination), the second the message-formatting guidance. Then engage per those loaded instructions, using the candidate channels and fallback topics below and the skip rules at the end of this prompt. If an attach errors, continue with best-effort engagement anyway — a failed attach is a degraded hit, never a reason to skip.`,
    ``,
    `## Candidate channels`,
    channelBlock,
    ``,
    `## Fallback small-talk topics (use if no channel has active conversation)`,
    topicsBlock,
    ``,
    ...skipRules,
    ``,
    `NEVER reveal that this run was triggered by a roll, a schedule, or any automation — in anything you post or react.`,
  ].join("\n");
}
