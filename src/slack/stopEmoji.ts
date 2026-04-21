const MAX_INLINE_LENGTH = 60;

/**
 * Mapping from Slack emoji shortcode to Unicode codepoint for the standard
 * emoji most likely to be configured as the stop reaction. Custom workspace
 * emojis (e.g., `:clack-stop:`) have no Unicode form; we return `undefined`
 * for those and rely on colon-form matching alone.
 */
const SHORTCODE_TO_UNICODE: { [name: string]: string } = {
  octagonal_sign: "\u{1F6D1}", // 🛑
  stop_sign: "\u{1F6D1}", // 🛑 (alias)
  no_entry: "\u{26D4}", // ⛔
  no_entry_sign: "\u{1F6AB}", // 🚫
  hand: "\u{270B}", // ✋
  raised_hand: "\u{270B}", // ✋
  x: "\u{274C}", // ❌
  heavy_multiplication_x: "\u{2716}", // ✖
};

export function slackEmojiToUnicode(name: string): string | undefined {
  return SHORTCODE_TO_UNICODE[name];
}

/**
 * Returns true when the message text should be interpreted as an inline stop
 * signal for the configured stop emoji.
 *
 * Rule B: trimmed text ≤ 60 chars AND contains either `:<stopEmoji>:` or the
 * emoji's Unicode form. If `stopEmoji` is null, undefined, or empty, the
 * feature is disabled and this always returns `false`.
 */
export function matchesInlineStopEmoji(
  text: string | undefined,
  stopEmoji: string | null | undefined,
): boolean {
  if (!stopEmoji || stopEmoji.length === 0) return false;
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_INLINE_LENGTH) return false;
  if (trimmed.includes(`:${stopEmoji}:`)) return true;
  const unicode = slackEmojiToUnicode(stopEmoji);
  if (unicode && trimmed.includes(unicode)) return true;
  return false;
}
