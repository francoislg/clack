/**
 * Local re-implementation of the core's `textResult` / `errorResult` — plugin code may not
 * import from `src/tools/helpers.js` (see `src/plugins/CLAUDE.md`). Return types are inferred
 * to satisfy the Anthropic SDK's structural `tool()` handler signature.
 */

export function textResult(payload: unknown) {
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
