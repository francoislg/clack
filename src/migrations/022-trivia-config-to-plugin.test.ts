import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { relocateTriviaConfig } from "./022-trivia-config-to-plugin.js";

const CONFIG_PATH = "data/config.json";
const PLUGIN_CONFIG_PATH = "data/plugins/trivia/config.json";

describe("022 relocateTriviaConfig", () => {
  it("no-op when main config is absent", () => {
    const result = relocateTriviaConfig({ [CONFIG_PATH]: null, [PLUGIN_CONFIG_PATH]: null });
    assert.deepEqual(result, {});
  });

  it("no-op when main config has no trivia field", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ slack: { token: "x" } }),
      [PLUGIN_CONFIG_PATH]: null,
    });
    assert.deepEqual(result, {});
  });

  it("standard relocation: writes plugin file + drops trivia from main config", () => {
    const triviaBlock = {
      seasons: { enabled: true, prompt: "Monthly" },
      answersFormat: { boolean: 1, choice: 2 },
      games: [
        {
          name: "main",
          channel: "C1",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
        },
      ],
    };
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ slack: { token: "x" }, trivia: triviaBlock }),
      [PLUGIN_CONFIG_PATH]: null,
    });

    assert.ok(result[PLUGIN_CONFIG_PATH], "plugin file should be staged");
    assert.ok(result[CONFIG_PATH], "main config should be rewritten");

    const pluginWritten = result[PLUGIN_CONFIG_PATH];
    if (typeof pluginWritten !== "string") throw new Error("expected string write");
    assert.deepEqual(JSON.parse(pluginWritten), triviaBlock);

    const mainWritten = result[CONFIG_PATH];
    if (typeof mainWritten !== "string") throw new Error("expected string write");
    const mainParsed = JSON.parse(mainWritten);
    assert.ok(!("trivia" in mainParsed), "trivia field should be removed");
    assert.deepEqual(mainParsed, { slack: { token: "x" } });
  });

  it("idempotency: no-op on a second run (trivia field already removed)", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ slack: { token: "x" } }),
      [PLUGIN_CONFIG_PATH]: JSON.stringify({ games: [] }),
    });
    assert.deepEqual(result, {});
  });

  it("conflict: refuses when plugin file already has content AND main config still has trivia", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ trivia: { answersFormat: { boolean: 1 } } }),
      [PLUGIN_CONFIG_PATH]: JSON.stringify({ games: [{ name: "preexisting" }] }),
    });
    // Conflict: returns {} (no writes) — logs error inside.
    assert.deepEqual(result, {});
  });

  it("empty trivia object still relocates (so the field disappears from main config)", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ slack: { token: "x" }, trivia: {} }),
      [PLUGIN_CONFIG_PATH]: null,
    });
    assert.ok(result[PLUGIN_CONFIG_PATH]);
    assert.ok(result[CONFIG_PATH]);
    const pluginWritten = result[PLUGIN_CONFIG_PATH];
    if (typeof pluginWritten !== "string") throw new Error("expected string write");
    assert.deepEqual(JSON.parse(pluginWritten), {});
    const mainWritten = result[CONFIG_PATH];
    if (typeof mainWritten !== "string") throw new Error("expected string write");
    assert.ok(!("trivia" in JSON.parse(mainWritten)));
  });

  it("plugin file is empty object — treated as 'no conflict' and relocates normally", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ trivia: { answersFormat: { boolean: 1 } } }),
      [PLUGIN_CONFIG_PATH]: JSON.stringify({}),
    });
    assert.ok(result[PLUGIN_CONFIG_PATH]);
    assert.ok(result[CONFIG_PATH]);
  });

  it("preserves other fields in main config", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({
        slack: { token: "x" },
        repositories: [{ name: "r", url: "u", description: "d" }],
        trivia: { games: [] },
        plugins: ["trivia"],
      }),
      [PLUGIN_CONFIG_PATH]: null,
    });
    const mainWritten = result[CONFIG_PATH];
    if (typeof mainWritten !== "string") throw new Error("expected string write");
    const parsed = JSON.parse(mainWritten);
    assert.deepEqual(parsed.slack, { token: "x" });
    assert.deepEqual(parsed.repositories, [{ name: "r", url: "u", description: "d" }]);
    assert.deepEqual(parsed.plugins, ["trivia"]);
    assert.ok(!("trivia" in parsed));
  });

  it("malformed main config JSON is a no-op (logged but doesn't write)", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: "{ not valid json",
      [PLUGIN_CONFIG_PATH]: null,
    });
    assert.deepEqual(result, {});
  });

  it("malformed plugin file is a no-op (refuses to overwrite)", () => {
    const result = relocateTriviaConfig({
      [CONFIG_PATH]: JSON.stringify({ trivia: { answersFormat: { boolean: 1 } } }),
      [PLUGIN_CONFIG_PATH]: "{ not valid json",
    });
    assert.deepEqual(result, {});
  });
});
