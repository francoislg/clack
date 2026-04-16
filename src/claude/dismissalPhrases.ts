/**
 * Canonical user-dismissal phrases Claude should treat as "conversation ending" —
 * used by both the `submit_response` tool schema's `disengage` field description and
 * the delivery-context prompt for autoRespond/threadReply/mentions triggers.
 *
 * When adding phrases, keep them short and recognizably casual — the point is to
 * catch low-effort sign-offs that users don't want Clack to follow up on.
 */
export const DISMISSAL_PHRASES: readonly string[] = [
  "ok ty",
  "ok thanks",
  "thanks Clack",
  "thx",
  "cool",
  "cool thanks",
  "got it, thanks",
  "you're done",
  "that's all",
  "👍",
  "🙏",
];

/** Comma-joined, quoted list for embedding in prompt/description strings. */
export const DISMISSAL_PHRASES_INLINE: string = DISMISSAL_PHRASES.map((p) => `"${p}"`).join(", ");
