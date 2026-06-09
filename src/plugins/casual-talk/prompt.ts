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
 * fetch channel context, decide a destination, then deliver in a SINGLE `submit_response`
 * call carrying one `deliver_to` entry (no `skip_response`). On a miss (or genuine
 * impossibility) it calls `submit_response({ skip_response: true })` with no `deliver_to`. The
 * channelless cron uses the `optional-post-to` submit_response schema (skip OR deliver_to);
 * the prompt restates the contract so Claude understands the dance.
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
        `Only skip — \`submit_response({ skip_response: true })\` with no \`deliver_to\` — when posting is genuinely impossible: every candidate channel errored or was inaccessible when you tried to read it. A channel being full of OTHER bots' posts (trivia, digests, notices) is NOT impossibility — a fresh opener is a new conversation, so post it. Do NOT use the skip as a default escape hatch; if you have at least one readable channel, you post.`,
      ]
    : [
        `## Step 4 — When to skip`,
        ``,
        `No fallback small-talk topics are configured, so this run can only chip into already-active conversations — it never opens fresh small talk. If no candidate channel has a conversation worth joining, end with \`submit_response({ skip_response: true })\` and no \`deliver_to\`. On a quiet day that is the expected outcome in this configuration.`,
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
    `A hit means this tick posts. Reading the channels below decides WHERE and WHAT to post — not WHETHER. Expect to deliver exactly one \`deliver_to\` entry this run; the only outs are in Step 4.`,
    ``,
    `Read recent activity in each candidate channel via \`fetch_channel_messages\` with \`include_threads: true\` (channel, limit ~30). This returns an OVERVIEW, not full threads: each top-level message carries \`reply_count\` (total replies), \`last_reply\` (ONLY the single newest reply, with its own \`ts\` and \`is_bot\` flag), and \`url\` (a permalink). The \`last_reply\` is your cheap triage signal — it tells you how fresh the thread is and whether a human spoke last. To actually READ a thread before joining it, call \`fetch_slack_message\` on that message's \`url\`. Long message text is truncated; read the full text the same way.`,
    ``,
    `**Judge freshness by the LAST message, not the parent.** A thread's recency is the timestamp of its \`last_reply\` (or the parent's \`ts\` if it has none), NOT when the parent was posted — a 3-hour-old parent with a \`last_reply\` from 5 minutes ago is fresh and active. Slack returns channel history ordered by parent \`ts\` and does NOT bump a thread when a new reply lands, so rank candidate threads by \`last_reply.ts\` (newest first); the freshest activity often sits under an older-looking parent.`,
    ``,
    `Signals that something is worth joining — two shapes both count:`,
    `- An active multi-reply thread (\`reply_count >= 3\`, real back-and-forth) whose last reply is a human — chip in.`,
    `- A recent human top-level message with few or NO replies that's relevant — reply to it directly. You'd be the first/early responder, which is a natural way to engage, NOT spam. Don't require 3 replies before answering a fresh human message.`,
    `- The last activity (the \`last_reply\`'s \`ts\`, or the top-level message's \`ts\` if it has none) is within ~2 hours of the response's \`fetched_at\` — compare against \`fetched_at\`, NOT a guessed "now". Older than that is stale, however new or old the parent looks. (\`at_iso\` is the human-readable form of each \`ts\` if you prefer comparing those.)`,
    `- The conversation is substantive — debate, planning, jokes-with-legs — not just greetings or one-word reactions.`,
    `- A thread whose parent is a **bot** message (a trivia question, a changelog post, an automated notice) is just as joinable as a human-started one, AS LONG AS humans are actively replying to it — engagement is what matters, not who opened it. Don't skip a lively thread just because a bot kicked it off. (Replies that are only from bots, with no human voices, are NOT a real conversation — skip those.)`,
    `- **A thread is joinable only if its LATEST message is from a human.** Evaluate each fetched top-level message by its LEAF: if it has replies, check \`last_reply.is_bot\` — if true (which includes your own earlier posts), skip that thread. If it has NO replies, judge the message itself — if it's a bot post, skip it. Walk all ~30 this way and keep only the threads whose leaf is a human; those are your join candidates. This no-pile-on guard applies ONLY to joining — a fresh top-level opener (Step 3) is a brand-new conversation, not a reply to anyone, so other bots' posts never block it.`,
    ``,
    `Once you've ranked the human-leaf candidates by \`last_reply.ts\`, READ the top one or two before composing: call \`fetch_slack_message\` on the candidate's \`url\` to see the actual back-and-forth, then write a reply that genuinely fits the conversation. Don't join off the \`last_reply\` snippet alone.`,
    ``,
    `### Candidate channels`,
    channelBlock,
    ``,
    `### Fallback small-talk topics (use if no channel has active conversation)`,
    topicsBlock,
    ``,
    `## Step 3 — Deliver`,
    ``,
    `Deliver by calling \`submit_response\` with a \`deliver_to\` array holding exactly ONE entry — \`{ channel, [thread_ts], attention_level: "high", response: { blocks } }\` — where \`channel\` is the explicit destination and \`response.blocks\` is your message. That single call both delivers and terminates the run. Do NOT also set \`skip_response\` when you are delivering: \`skip_response: true\` is ONLY for the no-post cases (a roll that wasn't 1, or the genuine-impossibility skip below). Setting both at once is ignored — the post still goes — but don't do it.`,
    ``,
    `\`attention_level: "high"\` is MANDATORY on the entry — set it on EVERY delivery with NO exceptions, whether you are opening a fresh top-level thread, replying to a human, or joining an existing thread. This run is an INVISIBLE scheduled tick: you won't get another chance to engage this thread until the next random roll happens to land on it, which may be far in the future or never. High attention is the ONLY thing that lets you answer a reply to your post in real time instead of going silent — omitting it (or setting it lower) leaves the thread fire-and-forget, which is always wrong for casual chatter. When in doubt, it is "high".`,
    ``,
    `Pick the most natural destination:`,
    `- **Reply in an active thread** — if a candidate channel has a thread that matches the "worth joining" signals above, set the entry's \`thread_ts\` to that thread's parent message \`ts\` and drop a short follow-up that fits the conversation. This is the preferred mode when there's a real thread happening.`,
    `- **Reply to a fresh human message** — a recent human top-level message with no replies yet that's relevant: respond to it by setting the entry's \`thread_ts\` to that message's \`ts\` (starting the thread). Being the first reply is fine — that's engaging, not spam.`,
    `- **Join an active channel-level conversation** — if recent top-level messages (last ~2 hours) show real engagement but no thread, post top-level (omit \`thread_ts\`) with a natural follow-up.`,
    `- **Fresh small-talk opener** — this is the DEFAULT when no channel has an active conversation (the common case). Don't skip — pick the channel whose character best fits a light opener, post top-level (omit \`thread_ts\`) using a topic from the list above. Vary phrasing every time, keep it 1-2 sentences. Other bots' recent posts (trivia, digests, notices) do NOT block a fresh opener — it's a new conversation, not a reply to them. The ONLY time to hold off: YOUR OWN last casual opener is the most recent thing in the channel and nobody engaged — then pick a different channel rather than stacking another opener.`,
    ``,
    `If a channel entry has a \`hint:\` annotation above, tailor the post to that hint (e.g. memes-only channels get a meme-tier one-liner).`,
    ``,
    `The single \`submit_response\` call carrying the \`deliver_to\` entry terminates the run — nothing else is needed, and you must NOT add \`skip_response\` to it.`,
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
