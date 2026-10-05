import { describe, expect, it } from "vitest";
import { SLACK_FILE_MODES, canvasesZod, listsZod, manifestConfigZod } from "./configSchemas.js";

function issueMessages(raw: unknown): string[] {
  const result = manifestConfigZod.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("manifestConfigZod", () => {
  it("parses a full valid config", () => {
    const result = manifestConfigZod.safeParse({
      slackApp: { name: "Clack", description: "Answers questions", backgroundColor: "#4A154B" },
      slack: { fetchAndStoreUsername: true },
      directMessages: { enabled: true, dmType: "agent" },
      mentions: { enabled: true },
      autoRespond: { enabled: false },
      allowScheduledMessages: true,
      allowPublicSearch: true,
      investigations: { enabled: true, emoji: "eyes" },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      slackApp: { name: "Clack", description: "Answers questions", backgroundColor: "#4A154B" },
      slack: { fetchAndStoreUsername: true },
      directMessages: { enabled: true, dmType: "agent" },
      mentions: { enabled: true },
      autoRespond: { enabled: false },
      allowScheduledMessages: true,
      allowPublicSearch: true,
      investigations: { enabled: true, emoji: "eyes" },
    });
  });

  it("parses an empty object", () => {
    const result = manifestConfigZod.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data?.directMessages).toBeUndefined();
    expect(result.data?.investigations).toBeUndefined();
  });

  it("rejects a string investigations.enabled, naming the key", () => {
    expect(issueMessages({ investigations: { enabled: "true" } })).toEqual([
      "Config 'investigations.enabled' must be a boolean",
    ]);
  });

  it("rejects an unsupported dmType, listing the supported values", () => {
    expect(issueMessages({ directMessages: { enabled: true, dmType: "threads" } })).toEqual([
      "Config 'directMessages.dmType' must be one of: assistant, classic, agent (got \"threads\")",
    ]);
  });

  it("rejects an empty slackApp.name", () => {
    expect(issueMessages({ slackApp: { name: "" } })).toEqual([
      "Config 'slackApp.name' must be a non-empty string",
    ]);
  });

  it("rejects a slackApp.backgroundColor that is not a six-digit hex color", () => {
    expect(issueMessages({ slackApp: { backgroundColor: "purple" } })).toEqual([
      "Config 'slackApp.backgroundColor' must be a hex color (e.g., #4A154B)",
    ]);
  });

  it("rejects a wrong-typed feature flag, naming the key", () => {
    expect(issueMessages({ mentions: { enabled: "yes" } })).toEqual([
      "Config 'mentions.enabled' must be a boolean",
    ]);
  });

  it("reports every invalid value", () => {
    expect(
      issueMessages({
        directMessages: { dmType: "threads" },
        investigations: { enabled: "true" },
      }),
    ).toEqual([
      "Config 'directMessages.dmType' must be one of: assistant, classic, agent (got \"threads\")",
      "Config 'investigations.enabled' must be a boolean",
    ]);
  });

  it("rejects an unknown key under investigations, naming the key", () => {
    expect(issueMessages({ investigations: { enabled: true, channel: "C123" } })).toEqual([
      "Config 'investigations' contains unknown key 'channel'",
    ]);
  });

  it("rejects an unsupported lists.mode, naming the key", () => {
    expect(issueMessages({ lists: { mode: "edit" } })).toEqual([
      "Config 'lists.mode' must be one of: off, read, write",
    ]);
  });

  it("ignores an unknown top-level key", () => {
    const result = manifestConfigZod.safeParse({ mentions: { enabled: true }, somethingElse: 42 });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("somethingElse");
  });

  it("ignores an unknown key inside a nested object", () => {
    const result = manifestConfigZod.safeParse({
      directMessages: { enabled: true, thinking: { type: "emoji" } },
    });

    expect(result.success).toBe(true);
    expect(result.data?.directMessages).toEqual({ enabled: true });
  });

  it("ignores an invalid value under a key the manifest does not read", () => {
    const result = manifestConfigZod.safeParse({
      repositories: "nope",
      mentions: { enabled: true },
    });

    expect(result.success).toBe(true);
    expect(result.data?.mentions).toEqual({ enabled: true });
  });
});

describe.each([
  ["canvases", canvasesZod],
  ["lists", listsZod],
] as const)("%sZod", (key, schema) => {
  const issues = (raw: unknown): string[] =>
    schema.safeParse(raw).error?.issues.map((issue) => issue.message) ?? [];

  it("parses an absent block as undefined", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it.each(SLACK_FILE_MODES)("parses mode %s", (mode) => {
    expect(schema.parse({ mode })).toEqual({ mode });
  });

  it("accepts a writeRole", () => {
    expect(schema.parse({ mode: "write", writeRole: "admin" })).toEqual({
      mode: "write",
      writeRole: "admin",
    });
  });

  it("rejects an unsupported mode, naming the key and listing the values", () => {
    expect(issues({ mode: "edit" })).toEqual([
      `Config '${key}.mode' must be one of: off, read, write`,
    ]);
  });

  it("rejects a missing mode, naming the key", () => {
    expect(issues({})).toEqual([`Config '${key}.mode' must be one of: off, read, write`]);
  });

  it("rejects an unsupported writeRole, naming the key and listing the values", () => {
    expect(issues({ mode: "write", writeRole: "system" })).toEqual([
      `Config '${key}.writeRole' must be one of: member, dev, admin, owner`,
    ]);
  });

  it("rejects an unknown key, naming the key", () => {
    expect(issues({ mode: "read", channel: "C123" })).toEqual([
      `Config '${key}' contains unknown key 'channel'`,
    ]);
  });

  it("rejects a non-object block", () => {
    expect(issues("read")).toEqual([`Config '${key}' must be an object`]);
  });
});
