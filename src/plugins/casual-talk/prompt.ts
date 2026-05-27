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
    `Read recent activity in each candidate channel via \`fetch_channel_messages\` with \`include_threads: true\` (channel, limit ~30). The response includes \`reply_count\` on every top-level message AND the actual thread replies under \`thread_replies\` — that's how you spot active conversations to chip in on.`,
    ``,
    `Signals that a thread is worth joining:`,
    `- \`reply_count >= 3\` means real back-and-forth, not just a single ack.`,
    `- The most recent reply is within the last ~2 hours (a stale thread isn't "active" anymore).`,
    `- The conversation is substantive — debate, planning, jokes-with-legs — not just greetings or one-word reactions.`,
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
    `Pick the most natural destination:`,
    `- **Reply in an active thread** — if a candidate channel has a thread that matches the "worth joining" signals above, set \`post_to.thread_ts\` to that thread's parent message \`ts\` and drop a short follow-up that fits the conversation. This is the preferred mode when there's a real thread happening.`,
    `- **Join an active channel-level conversation** — if recent top-level messages (last ~2 hours) show real engagement but no thread, post top-level (omit \`thread_ts\`) with a natural follow-up.`,
    `- **Fresh small-talk opener** — if nothing is active, post top-level (omit \`thread_ts\`) using a topic from the list above. Vary phrasing every time, keep it 1-2 sentences.`,
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
