import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { buildSubmitResponseSchema } from "./submitResponse.js";

// Drives the real Agent SDK MCP server end to end: the JSON Schema Claude reads is produced by
// the converter bundled inside the SDK, not by our zod copy, so only a served `tools/list` proves
// the shared schemas' ids are honored. An SDK whose converter ignores them inlines every copy
// and roughly doubles the schema.

type SchemaDeps = Parameters<typeof buildSubmitResponseSchema>[0];

async function servedSchemaJson(deps: SchemaDeps): Promise<string> {
  const server = createSdkMcpServer({
    name: "clack",
    version: "1.0.0",
    tools: [
      tool("submit_response", "", buildSubmitResponseSchema(deps), async () => ({ content: [] })),
    ],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: "served-schema-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return JSON.stringify(tools[0].inputSchema);
  } finally {
    await client.close();
  }
}

// Strips everything but the fields under test (description etc.), so the comparison is exact.
const SkipResponseProperty = z.object({
  properties: z.object({
    skip_response: z.object({ type: z.string(), const: z.boolean().optional() }),
  }),
});

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const VARIANTS: Array<{ name: string; deps: SchemaDeps }> = [
  {
    name: "scheduled with skip + multi-message",
    deps: {
      submitResponseMode: "optional",
      allowSkip: true,
      allowMultiMessage: true,
      maxAdditionalMessages: 5,
    },
  },
  { name: "interactive", deps: { allowAttentionLevel: true, allowPostTopLevel: true } },
  { name: "auto-respond", deps: { allowSkip: true, allowAttentionLevel: true } },
  { name: "channelless deliver_to", deps: { submitResponseMode: "optional-post-to" } },
];

describe("submit_response served input schema", () => {
  it.each(VARIANTS)("emits each shared schema once — $name", async ({ deps }) => {
    const json = await servedSchemaJson(deps);

    for (const id of ["SlackBlock", "SlackTableBlock", "SlackChartBlock", "SubmitResponseAction"]) {
      assert.ok(json.includes(`"$ref":"#/definitions/${id}"`), `expected a $ref to ${id}`);
    }
    // One distinctive member of each shared union, counted in the whole document: exactly one
    // occurrence means the schema was emitted once and referenced everywhere else.
    assert.equal(occurrences(json, '"const":"carousel"'), 1);
    assert.equal(occurrences(json, '"enum":["table","data_table"]'), 1);
    assert.equal(occurrences(json, '"const":"skill_delete"'), 1);
  });

  it.each([
    { name: "skip-only", deps: { allowSkip: true }, expected: { type: "boolean" } },
    {
      name: "skipped terminator",
      deps: { submitResponseMode: "skipped" as const },
      expected: { type: "boolean", const: true },
    },
    {
      name: "channelless deliver_to",
      deps: { submitResponseMode: "optional-post-to" as const },
      expected: { type: "boolean" },
    },
  ])(
    "advertises skip_response as a boolean despite the string coercion — $name",
    async ({ deps, expected }) => {
      const served = SkipResponseProperty.parse(JSON.parse(await servedSchemaJson(deps)));

      assert.deepEqual(served.properties.skip_response, expected);
    },
  );

  it("references the follow-up message payload instead of inlining it", async () => {
    const json = await servedSchemaJson({ allowMultiMessage: true });

    assert.ok(json.includes('"$ref":"#/definitions/SubmitResponseMessage"'));
  });
});
