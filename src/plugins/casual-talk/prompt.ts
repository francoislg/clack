import type { CasualTalkChannel } from "./types.js";
import { normalizeChannel } from "./types.js";

interface BuildPromptArgs {
  die: number;
  rateLabel: string;
  channels: CasualTalkChannel[];
  smallTalkTopics: string[];
}

/**
 * Assemble the cron job's prompt embedding the die, candidate channels, and small-talk
 * topics. Claude reads this fresh on every fire — the prompt is static across fires
 * (built at reconcile time); only the die-roll outcome and live channel state vary.
 *
 * The prompt structure is contractual: Claude must roll first, only proceed on a hit,
 * fetch channel context, decide a destination, deliver via `post_to`, then end with
 * `submit_response({ skip_response: true })`. The "skipped" submit_response schema is
 * mechanically enforced (see channelless-cron-jobs); the prompt restates the contract
 * so Claude understands the dance.
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

  const topicsBlock =
    smallTalkTopics.length === 0
      ? "(no fallback topics configured)"
      : smallTalkTopics.map((t) => `- ${t}`).join("\n");

  return [
    `# Casual-talk run`,
    ``,
    `You are about to roll for a casual chatter post. Rate: ${rateLabel}.`,
    ``,
    `## Step 1 — Roll`,
    ``,
    `Call \`random_roll\` with \`min: 1, max: ${die}, count: 1\`.`,
    ``,
    `If the roll is NOT exactly 1, immediately call \`submit_response({ skip_response: true })\` and end the run. Do NOT post anywhere. (~${Math.round(((die - 1) / die) * 100)}% of fires end here — this is the expected behavior.)`,
    ``,
    `## Step 2 — On a hit (roll === 1)`,
    ``,
    `Read recent activity in each candidate channel via \`fetch_channel_messages\` (channel, limit ~30). Decide which channel would feel most natural to drop into right now.`,
    ``,
    `### Candidate channels`,
    channelBlock,
    ``,
    `### Fallback small-talk topics (use if no channel has active conversation)`,
    topicsBlock,
    ``,
    `## Step 3 — Deliver`,
    ``,
    `Delivery is EXCLUSIVELY via \`post_to\` with an explicit \`channel\` argument. \`submit_response\` is a run terminator only — its schema for this run is \`{ skip_response: true }\` and rejects everything else. You CANNOT deliver text via \`submit_response\`.`,
    ``,
    `Pick the most natural channel:`,
    `- If a channel has an active recent conversation (last ~2 hours, real engagement, not just greetings), drop a short follow-up that joins naturally.`,
    `- Otherwise, post a fresh small-talk opener — pick a topic from the list above, vary your phrasing every time, keep it 1-2 sentences.`,
    ``,
    `If a channel entry has a \`hint:\` annotation above, tailor the post to that hint (e.g. memes-only channels get a meme-tier one-liner).`,
    ``,
    `After \`post_to\`, end with \`submit_response({ skip_response: true })\` to terminate the run.`,
    ``,
    `## Step 4 — When no channel fits`,
    ``,
    `If no channel feels right (all dead, none match the available topics, nothing fits), end with \`submit_response({ skip_response: true })\` without any \`post_to\`. That's a legitimate "decided not to post" outcome — not an error.`,
    ``,
    `## Persona constraints`,
    ``,
    `- NEVER reveal that this run was triggered by a roll, a schedule, or any automation. Just drop in as if you're naturally joining the chat.`,
    `- Match the channel's character — read its recent messages and the optional hint to calibrate tone.`,
    `- Vary your openers. Don't repeat the same phrasing run-to-run.`,
    `- Keep posts brief — 1 to 2 sentences. If integrations are available that would enrich the post (gifs, polls, etc.), feel free to use them, but plain text is often the right call.`,
  ].join("\n");
}
