/**
 * Refuses probe payloads: a deliverable message whose ENTIRE content is a test/placeholder
 * token ("test", "testing 123", "hello world", …).
 *
 * `submit_response` is one-shot — the first call that validates is what the user sees, and it
 * can never be replaced or followed up. A probe therefore doesn't cost a retry, it costs the
 * whole answer: the exchange ends with the word "test" sitting in the user's channel. The tool
 * description and `ONE_SHOT_REMINDER` both tell Claude not to probe; this is the enforcement.
 */

/** Stable code carried in the error string, so callers can tell a probe from a formatting failure. */
export const PROBE_REFUSAL_CODE = "probe_payload_refused";

/** Collapses non-alphanumerics to single spaces, so `*Test.*`, `"test"` and `test!!!` all
 *  reduce to `test`. Unicode-aware, so accented and non-Latin text survives intact. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whole-text probe shapes, matched against the normalized text. Every pattern is anchored: a
 * real answer that merely mentions a test ("tests pass", "the test suite is green") never
 * matches — only a message with nothing in it but the probe does.
 */
const PROBE_PATTERNS: readonly RegExp[] = [
  /^(?:this is (?:a|another) |just a |a )?test(?:ing)?(?: message| response| again| test)?(?: \d+)*$/u,
  /^hello world$/u,
  /^(?:foo|bar|foo bar|baz|qux|asdf|blah|lorem ipsum|placeholder|dummy(?: text)?|sample(?: text)?)$/u,
];

function isProbeText(normalized: string): boolean {
  return PROBE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns a path-prefixed refusal when `displayText` is nothing but a probe, otherwise
 * `undefined`. `pathPrefix` follows the batch-error convention — `""` for the primary message.
 */
export function findProbeRefusal(displayText: string, pathPrefix: string): string | undefined {
  const normalized = normalize(displayText);
  if (!normalized || !isProbeText(normalized)) return undefined;
  const where = pathPrefix || "primary";
  return (
    `${where}: ${PROBE_REFUSAL_CODE} — this call is well-formed and WOULD have delivered: ` +
    `the test worked, nothing is wrong with the arguments. It is refused because its entire ` +
    `content is a probe ("${displayText.trim()}") rather than an answer, and delivering it ` +
    `would spend the one response this exchange gets and end the discussion with a meaningless ` +
    `message. Resend this same call with your real, complete answer. If the user genuinely ` +
    `asked for that literal text, write it into a sentence so it reads as an answer.`
  );
}

/** True when a collected error string is a probe refusal rather than a formatting failure. */
export function isProbeRefusal(error: string): boolean {
  return error.includes(PROBE_REFUSAL_CODE);
}
