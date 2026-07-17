import { describe, it, expect } from "vitest";
import { validateTopicNames } from "./topicValidation.js";

describe("validateTopicNames", () => {
  const known = ["response-rendering", "scheduling", "trivia"];

  it("returns null when every name is known", () => {
    expect(validateTopicNames(["trivia", "response-rendering"], known)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(validateTopicNames([], known)).toBeNull();
  });

  it("names the invalid entries and lists the known set", () => {
    const err = validateTopicNames(["trivia", "nope", "wrong"], known);
    expect(err).toContain("Unknown topic name(s): nope, wrong");
    expect(err).toContain("Known topics: response-rendering, scheduling, trivia");
  });

  it("reports '(none)' when no topics are known", () => {
    const err = validateTopicNames(["anything"], []);
    expect(err).toContain("Known topics: (none)");
  });
});
