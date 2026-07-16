import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../sdk.js";
import { tmdbImageSearchPlugin } from "./index.js";
import { createFindMovieTool } from "./findMovie.js";
import { createFindTvTool } from "./findTv.js";
import { createFindPersonTool } from "./findPerson.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

describe("tmdb-image-search plugin load", () => {
  // The plugin never reads TMDB_READ_TOKEN at load time — tools resolve it per call — so
  // registration succeeding here is also the "loads without a token" guarantee.
  it("registers the three tools on the always-on default server", async () => {
    const { sdk, harvest } = createClackSdk(
      "tmdb-image-search",
      "/tmp/tmdb-image-search-plugin-test",
      {
        getSlackClient: () => null,
        loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
        openDmChannel: async () => null,
        clackQuery: emptyClackQuery,
      },
    );

    await tmdbImageSearchPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "tmdb-image-search");
    assert.deepEqual(
      result.tools.map((t) => t.name),
      ["find_movie", "find_tv", "find_person"],
    );
    for (const registered of result.tools) {
      assert.equal(registered.minRole, "member");
    }

    assert.equal(result.toolMappings.get("find_movie"), "Searching TMDB movies — {query}");
    assert.equal(result.toolMappings.get("find_tv"), "Searching TMDB TV series — {query}");
    assert.equal(result.toolMappings.get("find_person"), "Searching TMDB people — {query}");
  });

  // Trivia routes by DESCRIPTION, not tool name — the category fit must be stated there.
  it("tool descriptions state their category fit", () => {
    assert.match(createFindMovieTool().description, /Movies category/);
    assert.match(createFindTvTool().description, /TV Series category/);
    assert.match(createFindPersonTool().description, /Actors category/);
  });
});
