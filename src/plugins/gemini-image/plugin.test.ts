import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import { geminiImagePlugin } from "./index.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

describe("gemini-image plugin load", () => {
  it("registers one usage instruction and the member-gated generate_image tool", async () => {
    const { sdk, harvest } = createClackSdk("gemini-image", "/tmp/gemini-image-plugin-test", {
      getSlackClient: () => null,
      loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
      openDmChannel: async () => null,
      clackQuery: emptyClackQuery,
    });

    await geminiImagePlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "gemini-image");
    assert.equal(result.instructions.length, 1);
    assert.equal(result.instructions[0].role, "user");
    assert.equal(result.instructions[0].filename, "gemini-image__usage.md");

    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "generate_image");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("generate_image");
    assert.equal(mapping, "Generating an image — {prompt}");
  });
});
