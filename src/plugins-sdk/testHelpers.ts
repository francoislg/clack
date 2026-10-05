export { createClackSdk } from "./internal/factory.js";
export { createMemorySurface } from "./internal/memory.js";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "./internal/factory.js";

/** Test-only import surface for plugin test files (`*.test.ts` under `src/plugins/<name>/`).
 *
 * The Agent SDK types tool-result `content` as a union (text | image | audio |
 * resource_link | embedded_resource). Clack's tools only ever return text, but
 * the tests need to narrow that union explicitly to access `.text`.
 */

interface ToolResult {
  content: readonly { type: string; text?: unknown }[];
  isError?: boolean;
}

/** Return the first content block's text, asserting it is a text block. */
export function toolResultText(result: ToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error(`expected text content, got ${first?.type ?? "none"}`);
  }
  return first.text;
}

/** Parse the first content block as JSON. */
export function parseToolResult(result: ToolResult): any {
  return JSON.parse(toolResultText(result));
}

/** A `clackQuery` dep that yields no SDK messages. */
export async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

/** Build a `ClackSdk` wired with inert test deps (no Slack client, empty roles, no DM
 * channel, empty `clackQuery`, no-op soft restart). Pass only the deps a test needs to vary. */
export function createTestClackSdk(
  pluginName: string,
  dataDir: string,
  overrides: Partial<NonNullable<Parameters<typeof createClackSdk>[2]>> = {},
): ReturnType<typeof createClackSdk> {
  return createClackSdk(pluginName, dataDir, {
    getSlackClient: () => null,
    loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
    openDmChannel: async () => null,
    clackQuery: emptyClackQuery,
    requestSoftRestart: () => {},
    createFile: async ({ owner, name }) => `/test-downloads/${owner}/${name}`,
    reservePath: async ({ owner, name }) => `/test-downloads/${owner}/${name}`,
    ...overrides,
  });
}
