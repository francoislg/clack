/** Test-only helpers for asserting on MCP tool results.
 *
 * The Agent SDK types tool-result `content` as a union (text | image | audio |
 * resource_link | embedded_resource). Clack's tools only ever return text, but
 * the tests need to narrow that union explicitly to access `.text`.
 */

interface ToolResult {
  content: readonly { type: string }[];
  isError?: boolean;
}

/** Return the first content block's text, asserting it is a text block. */
export function toolResultText(result: ToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error(`expected text content, got ${first?.type ?? "none"}`);
  }
  return (first as unknown as { text: string }).text;
}

/** Parse the first content block as JSON. */
export function parseToolResult(result: ToolResult): any {
  return JSON.parse(toolResultText(result));
}
