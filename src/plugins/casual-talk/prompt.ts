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

  // A hit is a LICENCE to engage, not an obligation. When fallback topics exist, a fresh
  // opener on a quiet day and joining a lively human thread are both welcome — but injecting
  // an unwanted take into a focused work discussion is not, so declining is a legitimate
  // judgment. With NO topics, the plugin is chip-in-only, so a quiet day legitimately skips.
  const skipRules = hasTopics
    ? [
        `## Skip rules — engaging is a judgment call`,
        ``,
        `On a hit you MAY engage, but YOU decide WHETHER, not just where. Weigh whether your input is actually wanted here:`,
        `- A fresh small-talk opener on a quiet day is welcome — that is the plugin working as intended, not butting in.`,
        `- Reacting to a recent human message, or joining a genuinely lively human thread, is welcome.`,
        `- Injecting an opinion into a focused work discussion that does not need a bot's take is NOT — that reads as interrupting. Honor each channel's \`hint:\` (e.g. a channel that says "only reply to what's already being discussed" means don't force a take).`,
        ``,
        `When nothing warrants engagement — the only active threads are functional conversations you'd merely be interrupting, and no channel is a natural fit for a light opener — decline. That is a legitimate "decided not to weigh in" outcome, NOT an error. Don't force a post or a reaction just because you rolled a hit.`,
        ``,
        `To decline, call \`submit_response\` with exactly \`{ skip_response: true }\` — the literal \`true\`, with no \`deliver_to\`, no reactions, and no other fields (\`blocks\`, \`message\`, etc. are rejected):`,
        ``,
        "```",
        `submit_response({ skip_response: true })`,
        "```",
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
