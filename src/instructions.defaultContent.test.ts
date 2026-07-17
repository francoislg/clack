import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Static-content contract for the shipped instruction defaults after the
// response-rendering topic split: the baseline submit-response stub must keep the
// tool contract every session needs, and the rendering-guidance files must live in
// the topic folder (NOT at their old baseline paths, where they'd load on every fire).

const DEFAULTS = join(process.cwd(), "data", "default_configuration", "user");
const TOPIC = join(DEFAULTS, "topics", "response-rendering");

describe("shipped submit-response baseline stub", () => {
  const stub = readFileSync(join(DEFAULTS, "submit-response.md"), "utf-8");

  it("retains the must-call contract", () => {
    expect(stub).toContain("ends the conversation permanently");
    expect(stub).toContain("submit_response");
  });

  it("retains skip_response semantics", () => {
    expect(stub).toContain("skip_response: true");
  });

  it("retains the multi-message field gating rules", () => {
    expect(stub).toContain("additional_messages");
    expect(stub).toContain("thread_replies");
  });

  it("hints to attach response-rendering before composing rich output", () => {
    expect(stub).toContain('attach_integration("response-rendering")');
  });

  it("no longer carries the rendering guidance moved to the topic", () => {
    expect(stub).not.toContain("Actions by Delivery Context");
    expect(stub).not.toContain("card / carousel guidance");
  });
});

describe("response-rendering topic files", () => {
  const movedFiles = [
    "block-kit-formatting.md",
    "slack-formatting.md",
    "response-style.md",
    "submit-response-rendering.md",
  ];

  it.each(movedFiles)("%s exists in the topic folder", (file) => {
    expect(existsSync(join(TOPIC, file))).toBe(true);
  });

  it.each(["block-kit-formatting.md", "slack-formatting.md", "response-style.md"])(
    "%s is gone from the baseline",
    (file) => {
      expect(existsSync(join(DEFAULTS, file))).toBe(false);
    },
  );

  it("the rendering half of submit-response lives in the topic", () => {
    const rendering = readFileSync(join(TOPIC, "submit-response-rendering.md"), "utf-8");
    expect(rendering).toContain("Actions by Delivery Context");
    expect(rendering).toContain("post_to");
  });
});
