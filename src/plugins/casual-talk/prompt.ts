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

  const hasTopics = smallTalkTopics.length > 0;
  const topicsBlock = hasTopics
    ? smallTalkTopics.map((t) => `- ${t}`).join("\n")
    : "(no fallback topics configured)";

  // A hit means "post this tick." When fallback topics exist, a quiet day is no excuse to
  // skip — open fresh small talk instead. Skipping is reserved for genuine impossibility.
  // With NO topics, the plugin is chip-in-only, so a quiet day legitimately ends in a skip.
  const step4 = hasTopics
    ? [
        `## Step 4 — Skipping a hit is RARE`,
        ``,
        `You rolled a 1, so this tick posts. Reading the channels decides WHERE and WHAT, never WHETHER. "Nothing is active right now" is NOT a reason to skip — that is exactly when you post a fresh small-talk opener (Step 3). A quiet day is the normal case, not an error.`,
        ``,
        `Only skip — \`submit_response({ skip_response: true })\` with no \`post_to\` — when posting is genuinely impossible: every candidate channel errored or was inaccessible when you tried to read it. A channel being full of OTHER bots' posts (trivia, digests, notices) is NOT impossibility — a fresh opener is a new conversation, so post it. Do NOT use the skip as a default escape hatch; if you have at least one readable channel, you post.`,
      ]
    : [
        `## Step 4 — When to skip`,
        ``,
        `No fallback small-talk topics are configured, so this run can only chip into already-active conversations — it never opens fresh small talk. If no candidate channel has a conversation worth joining, end with \`submit_response({ skip_response: true })\` and no \`post_to\`. On a quiet day that is the expected outcome in this configuration.`,
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
    `If the roll is NOT exactly 1, immediately call \`submit_response({ skip_response: true })\` and end the run. Do NOT post anywhere. (~${Math.round(((die - 1) / die) * 100)}% of fires end here — this is the expected behavior.)`,
    ``,
    `## Step 2 — On a hit (roll === 1)`,
    ``,
    `A hit means this tick posts. Reading the channels below decides WHERE and WHAT to post — not WHETHER. Expect to call \`post_to\` exactly once this run; the only outs are in Step 4.`,
    ``,
    `Read recent activity in each candidate channel via \`fetch_channel_messages\` with \`include_threads: true\` (channel, limit ~30). The response includes \`reply_count\` on every top-level message AND the actual thread replies under \`thread_replies\` (each reply carries its own \`ts\` and an \`is_bot\` flag) — that's how you spot active conversations to chip in on.`,
    ``,
    `**Judge freshness by the LAST message, not the parent.** A thread's recency is the timestamp of its most recent reply (or the parent's \`ts\` if it has none), NOT when the parent was posted — a 3-hour-old parent with a reply from 5 minutes ago is fresh and active. Slack returns channel history ordered by parent \`ts\` and does NOT bump a thread when a new reply lands, so scan the \`thread_replies\` timestamps yourself; the freshest activity often sits under an older-looking parent. Rank candidate threads by this last-activity timestamp, newest first.`,
    ``,
    `Signals that something is worth joining — two shapes both count:`,
    `- An active multi-reply thread (\`reply_count >= 3\`, real back-and-forth) whose last reply is a human — chip in.`,
    `- A recent human top-level message with few or NO replies that's relevant — reply to it directly. You'd be the first/early responder, which is a natural way to engage, NOT spam. Don't require 3 replies before answering a fresh human message.`,
    `- The last activity (most recent message by its \`ts\` — the last reply, or the top-level message itself if it has none) is within the last ~2 hours; older than that is stale, however new or old the parent looks.`,
    `- The conversation is substantive — debate, planning, jokes-with-legs — not just greetings or one-word reactions.`,
    `- A thread whose parent is a **bot** message (a trivia question, a changelog post, an automated notice) is just as joinable as a human-started one, AS LONG AS humans are actively replying to it — engagement is what matters, not who opened it. Don't skip a lively thread just because a bot kicked it off. (Replies that are only from bots, with no human voices, are NOT a real conversation — skip those.)`,
    `- **A thread is joinable only if its LATEST message is from a human.** Evaluate each of the fetched top-level messages by its LEAF (the most recent message in that thread): if the thread has replies, look at the LAST reply — if it's a bot (\`is_bot: true\`, which includes your own earlier posts), skip that thread. If a top-level message has NO replies, judge the message itself — if it's a bot post, skip it. Walk all ~30 this way and keep only the threads whose leaf is a human; those are your join candidates. This no-pile-on guard applies ONLY to joining — a fresh top-level opener (Step 3) is a brand-new conversation, not a reply to anyone, so other bots' posts never block it.`,
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
    `- **Reply to a fresh human message** — a recent human top-level message with no replies yet that's relevant: respond to it by setting \`post_to.thread_ts\` to that message's \`ts\` (starting the thread). Being the first reply is fine — that's engaging, not spam.`,
    `- **Join an active channel-level conversation** — if recent top-level messages (last ~2 hours) show real engagement but no thread, post top-level (omit \`thread_ts\`) with a natural follow-up.`,
    `- **Fresh small-talk opener** — this is the DEFAULT when no channel has an active conversation (the common case). Don't skip — pick the channel whose character best fits a light opener, post top-level (omit \`thread_ts\`) using a topic from the list above. Vary phrasing every time, keep it 1-2 sentences. Other bots' recent posts (trivia, digests, notices) do NOT block a fresh opener — it's a new conversation, not a reply to them. The ONLY time to hold off: YOUR OWN last casual opener is the most recent thing in the channel and nobody engaged — then pick a different channel rather than stacking another opener.`,
    ``,
    `If a channel entry has a \`hint:\` annotation above, tailor the post to that hint (e.g. memes-only channels get a meme-tier one-liner).`,
    ``,
    `After \`post_to\`, end with \`submit_response({ skip_response: true })\` to terminate the run.`,
    ``,
    ...step4,
    ``,
    `## Persona constraints`,
    ``,
    `- NEVER reveal that this run was triggered by a roll, a schedule, or any automation. Just drop in as if you're naturally joining the chat.`,
    `- Match the channel's character — read its recent messages and the optional hint to calibrate tone.`,
    `- Vary your openers. Don't repeat the same phrasing run-to-run.`,
    `- Keep posts brief — 1 to 2 sentences. If integrations are available that would enrich the post (gifs, polls, etc.), feel free to use them, but plain text is often the right call.`,
  ].join("\n");
}
