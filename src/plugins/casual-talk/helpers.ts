/**
 * Local re-implementation of the core's `textResult` / `errorResult` helpers. We can't
 * import from `src/tools/helpers.js` because plugin code MUST live entirely inside
 * `src/plugins/casual-talk/**` (plus the SDK and node_modules). See `src/plugins/CLAUDE.md`.
 *
 * Return types are intentionally inferred — the Anthropic SDK's `tool()` handler signature
 * requires a structural match (index signature) that's easier to satisfy via inference than
 * via an explicit interface.
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function textResult(payload: JsonValue) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}
