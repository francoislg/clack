/**
 * Char budget kept under the Agent SDK's ~25K-token tool-result cap. Above the
 * cap the SDK dumps the result to a `tool-results/*.txt` file as one escaped JSON
 * line that Claude cannot search, so tools refuse (or stay lean) past this.
 */
export const MAX_TOOL_OUTPUT_CHARS = 40_000;

/** MCP tool response envelope for successful results. */
export function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** MCP tool response envelope for error results. */
export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}
