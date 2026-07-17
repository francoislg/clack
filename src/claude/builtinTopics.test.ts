import { describe, it, expect } from "vitest";
import {
  builtinTopicsForTrigger,
  mergeBuiltinTopics,
  RESPONSE_RENDERING_TOPIC,
} from "./builtinTopics.js";
import type { TriggerType } from "../changes/types.js";

const INTERACTIVE: TriggerType[] = [
  "directMessages",
  "mentions",
  "reactions",
  "autoRespond",
  "threadReply",
  "channelReply",
];

describe("builtinTopicsForTrigger", () => {
  it.each(INTERACTIVE)("attaches response-rendering for %s", (trigger) => {
    expect(builtinTopicsForTrigger(trigger)).toEqual([RESPONSE_RENDERING_TOPIC]);
  });

  it("attaches nothing for scheduled", () => {
    expect(builtinTopicsForTrigger("scheduled")).toEqual([]);
  });
});

describe("mergeBuiltinTopics", () => {
  it("returns the built-in topic alone when the caller supplies nothing", () => {
    expect(mergeBuiltinTopics("mentions")).toEqual([RESPONSE_RENDERING_TOPIC]);
    expect(mergeBuiltinTopics("mentions", [])).toEqual([RESPONSE_RENDERING_TOPIC]);
  });

  it("passes scheduled caller topics through untouched", () => {
    expect(mergeBuiltinTopics("scheduled", ["trivia"])).toEqual(["trivia"]);
  });

  it("returns undefined for scheduled with no caller topics", () => {
    expect(mergeBuiltinTopics("scheduled")).toBeUndefined();
    expect(mergeBuiltinTopics("scheduled", [])).toBeUndefined();
  });

  it("deduplicates when the caller already supplies response-rendering", () => {
    expect(mergeBuiltinTopics("directMessages", [RESPONSE_RENDERING_TOPIC, "trivia"])).toEqual([
      RESPONSE_RENDERING_TOPIC,
      "trivia",
    ]);
  });

  it("appends caller topics after the built-in for interactive triggers", () => {
    expect(mergeBuiltinTopics("reactions", ["idler"])).toEqual([RESPONSE_RENDERING_TOPIC, "idler"]);
  });
});
