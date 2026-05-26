import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { migration } from "./015-add-stop-reaction.js";
import type { StaticFileResult } from "./types.js";

const PATH = "data/config.json";

type StaticOutput = { [path: string]: StaticFileResult };

function runStatic(input: string | null): StaticOutput {
  return migration.static!({ [PATH]: input });
}

function writtenText(out: StaticOutput): string | null {
  const written = out[PATH];
  if (written === undefined) return null;
  if (typeof written !== "string") return null;
  return written;
}

describe("migration 015: add stop reaction", () => {
  it("adds 'stop: octagonal_sign' to configs without the field", () => {
    const input = JSON.stringify({
      reactions: { trigger: "robot_face" },
      repositories: [],
    });
    const text = writtenText(runStatic(input));
    assert.ok(text);
    const parsed = JSON.parse(text);
    assert.equal(parsed.reactions.stop, "octagonal_sign");
  });

  it("leaves configs that already have 'stop' set to a custom emoji unchanged", () => {
    const input = JSON.stringify({
      reactions: { trigger: "robot_face", stop: "clack-stop" },
      repositories: [],
    });
    assert.equal(writtenText(runStatic(input)), null);
  });

  it("leaves configs that already have 'stop: null' unchanged", () => {
    const input = JSON.stringify({
      reactions: { trigger: "robot_face", stop: null },
      repositories: [],
    });
    assert.equal(writtenText(runStatic(input)), null);
  });

  it("preserves other reactions fields when adding the stop field", () => {
    const input = JSON.stringify({
      reactions: {
        trigger: "robot_face",
        thinking: { type: "emoji", emoji: "thinking" },
        changesWorkflow: { enabled: true, trigger: "hammer" },
      },
      repositories: [{ name: "r", url: "u", description: "d" }],
    });
    const text = writtenText(runStatic(input));
    assert.ok(text);
    const parsed = JSON.parse(text);
    assert.equal(parsed.reactions.trigger, "robot_face");
    assert.equal(parsed.reactions.stop, "octagonal_sign");
    assert.equal(parsed.reactions.thinking.type, "emoji");
    assert.equal(parsed.reactions.changesWorkflow.enabled, true);
  });

  it("is a no-op when there is no reactions section", () => {
    const input = JSON.stringify({ repositories: [] });
    assert.equal(writtenText(runStatic(input)), null);
  });

  it("is a no-op when the file is missing (null content)", () => {
    assert.equal(writtenText(runStatic(null)), null);
  });

  it("metadata matches expectations", () => {
    assert.equal(migration.version, 15);
    assert.equal(migration.priority, "blocking");
    assert.deepEqual(migration.files, [PATH]);
  });
});
