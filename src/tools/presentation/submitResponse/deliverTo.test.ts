import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { IntentStore } from "../../server.js";
import type { Action, DeliverToEntry, StagedIntent } from "../../types.js";
import type { Block } from "../../../slack/blockSchema.js";
import {
  persistDeliverToIntents,
  validateDeliverToEntries,
  type ValidateDeliverToDeps,
} from "./deliverTo.js";

const block: Block = { type: "section", text: { type: "mrkdwn", text: "hi" } };
const postToAction: Action = {
  type: "post_to",
  channel: "C2",
  creation_context: "why",
  blocks: [block],
};

function makeDeps(overrides: Partial<ValidateDeliverToDeps> = {}): ValidateDeliverToDeps {
  const intentStore: IntentStore = {
    stage: () => "ref-1",
    resolve: () => undefined,
    getAll: () => new Map(),
  };
  return {
    intentStore,
    sessionId: "sess-1",
    validateBlocks: () => [],
    validateTable: () => [],
    validateActionButtonLabels: () => [],
    getResponseActionBlocks: () => [],
    ...overrides,
  };
}

function entry(response: Partial<DeliverToEntry["response"]> = {}): DeliverToEntry {
  return {
    channel: "C1",
    creation_context: "why",
    response: { blocks: [block], ...response },
  };
}

describe("validateDeliverToEntries", () => {
  it("returns no errors for a well-formed entry", () => {
    const errors = validateDeliverToEntries([entry()], makeDeps());
    assert.deepEqual(errors, []);
  });

  it("rejects a post_to action inside an entry's actions", () => {
    const errors = validateDeliverToEntries([entry({ actions: [postToAction] })], makeDeps());
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("post_to is not allowed"));
    assert.ok(errors[0].includes("deliver_to[0].response.actions"));
  });

  it("rejects a post_to nested in a thread_reply's actions", () => {
    const reply = { blocks: [block], actions: [postToAction] };
    const errors = validateDeliverToEntries([entry({ thread_replies: [reply] })], makeDeps());
    assert.ok(errors.some((e) => e.includes("thread_replies[0].actions")));
  });

  it("surfaces an unknown ref action error", () => {
    const refAction: Action = { type: "change", ref: "missing" };
    const errors = validateDeliverToEntries([entry({ actions: [refAction] })], makeDeps());
    assert.ok(errors.some((e) => e.includes("unknown ref")));
  });

  it("path-prefixes block validation errors per entry", () => {
    const deps = makeDeps({
      validateBlocks: () => [
        { field: "blocks[0]", message: "bad block", currentLength: 1, limit: 0 },
      ],
    });
    const errors = validateDeliverToEntries([entry(), entry()], deps);
    assert.ok(errors.some((e) => e.startsWith("deliver_to[0].response")));
    assert.ok(errors.some((e) => e.startsWith("deliver_to[1].response")));
  });
});

describe("persistDeliverToIntents", () => {
  it("persists intents referenced by entry actions", async () => {
    const intent: StagedIntent = { type: "change", branch: "b", description: "d", repo: "r" };
    const intentStore: IntentStore = {
      stage: () => "ref-1",
      resolve: (ref) => (ref === "ref-1" ? intent : undefined),
      getAll: () => new Map([["ref-1", intent]]),
    };
    const refAction: Action = { type: "change", ref: "ref-1" };
    const persisted: Record<string, StagedIntent>[] = [];
    await persistDeliverToIntents(
      [entry({ actions: [refAction] })],
      intentStore,
      "sess-1",
      async (_id, intents) => {
        persisted.push(intents);
      },
    );
    assert.equal(persisted.length, 1);
    assert.ok("ref-1" in persisted[0]);
  });

  it("persists intents referenced by a thread_reply's actions", async () => {
    const intent: StagedIntent = { type: "change", branch: "b", description: "d", repo: "r" };
    const intentStore: IntentStore = {
      stage: () => "ref-2",
      resolve: (ref) => (ref === "ref-2" ? intent : undefined),
      getAll: () => new Map([["ref-2", intent]]),
    };
    const refAction: Action = { type: "change", ref: "ref-2" };
    const reply = { blocks: [block], actions: [refAction] };
    const persisted: Record<string, StagedIntent>[] = [];
    await persistDeliverToIntents(
      [entry({ thread_replies: [reply] })],
      intentStore,
      "sess-1",
      async (_id, intents) => {
        persisted.push(intents);
      },
    );
    assert.equal(persisted.length, 1);
    assert.ok("ref-2" in persisted[0]);
  });

  it("is a no-op when no actions reference intents", async () => {
    let called = false;
    await persistDeliverToIntents([entry()], makeDeps().intentStore, "sess-1", async () => {
      called = true;
    });
    assert.equal(called, false);
  });
});
