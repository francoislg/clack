import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "./promptBuilder.js";
import type { SessionContext } from "../sessions.js";

/**
 * Build a minimal SessionContext for testing. Only the fields
 * that buildPrompt actually reads are required.
 */
function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    originalQuestion: "What does this function do?",
    threadContext: [],
    refinements: [],
    triggerType: undefined,
    dmChannel: undefined,
    originChannel: undefined,
    channelPostTs: undefined,
    assistantOriginChannelId: undefined,
    assistantCurrentChannelId: undefined,
    activeChange: undefined,
    ...overrides,
  } as SessionContext;
}

describe("buildPrompt", () => {
  // ---- basic question ----
  it("includes the original question", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(prompt.includes("QUESTION: What does this function do?"));
  });

  // ---- thread context ----
  it("includes thread context when present", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Can you check this?",
          isBot: false,
          ts: "1234567890.000100",
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("THREAD CONTEXT"));
    assert.ok(prompt.includes("Can you check this?"));
    assert.ok(prompt.includes("Alice"));
  });

  it("omits thread context section when empty", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(!prompt.includes("THREAD CONTEXT"));
  });

  it("formats multiple thread messages", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U1",
          username: "alice",
          displayName: "Alice",
          text: "First message",
          isBot: false,
          ts: "1234567890.000100",
        },
        {
          userId: "U2",
          username: "bob",
          displayName: "Bob",
          text: "Second message",
          isBot: false,
          ts: "1234567890.000200",
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("First message"));
    assert.ok(prompt.includes("Second message"));
  });

  // ---- delivery context ----
  it("includes DM-first delivery context", () => {
    const session = makeSession({
      triggerType: "reactions",
      dmChannel: "D123",
      originChannel: "C456",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("DELIVERY CONTEXT"));
    assert.ok(prompt.includes("DM-first"));
    assert.ok(prompt.includes("send_to_thread"));
  });

  it("notes when an answer was already shared in DM-first mode", () => {
    const session = makeSession({
      triggerType: "reactions",
      dmChannel: "D123",
      originChannel: "C456",
      channelPostTs: "1234567890.123456",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("already shared"));
  });

  it("includes assistant side-panel delivery context", () => {
    const session = makeSession({
      triggerType: "mentions",
      assistantOriginChannelId: "C789",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("DELIVERY CONTEXT"));
    assert.ok(prompt.includes("Assistant side-panel"));
  });

  it("includes current channel hint in assistant side-panel", () => {
    const session = makeSession({
      triggerType: "mentions",
      assistantOriginChannelId: "C789",
      assistantCurrentChannelId: "C999",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("C999"));
    assert.ok(prompt.includes("fetch_channel_messages"));
  });

  it("includes reaction thread mode for non-DM reactions", () => {
    const session = makeSession({
      triggerType: "reactions",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("Thread (reaction triggered"));
  });

  it("includes direct message mode", () => {
    const session = makeSession({
      triggerType: "directMessages",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("Direct message"));
  });

  it("includes mention mode", () => {
    const session = makeSession({
      triggerType: "mentions",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("Channel mention"));
  });

  it("omits delivery context when triggerType is undefined", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(!prompt.includes("DELIVERY CONTEXT"));
  });

  // ---- active change ----
  it("includes active change context when present", () => {
    const session = makeSession({
      activeChange: {
        branch: "feat/new-thing",
        repo: "my-org/my-repo",
        status: "executing" as const,
        description: "Add new feature",
        startedAt: new Date(),
        lastActivityAt: new Date(),
        prUrl: undefined,
      },
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("ACTIVE CHANGE"));
    assert.ok(prompt.includes("feat/new-thing"));
    assert.ok(prompt.includes("my-org/my-repo"));
    assert.ok(prompt.includes("request_update"));
  });

  it("includes PR URL in active change when present", () => {
    const session = makeSession({
      activeChange: {
        branch: "feat/pr-exists",
        repo: "my-org/my-repo",
        status: "pr_created" as const,
        description: "PR exists test",
        startedAt: new Date(),
        lastActivityAt: new Date(),
        prUrl: "https://github.com/my-org/my-repo/pull/42",
      },
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("https://github.com/my-org/my-repo/pull/42"));
  });

  // ---- work mode ----
  it("includes work mode hint with propose_change when no active change", () => {
    const session = makeSession();
    const prompt = buildPrompt(session, { workMode: true });
    assert.ok(prompt.includes("WORK MODE"));
    assert.ok(prompt.includes("propose_change"));
  });

  it("includes work mode hint with request_update when active change exists", () => {
    const session = makeSession({
      activeChange: {
        branch: "feat/x",
        repo: "org/repo",
        status: "executing" as const,
        description: "Work mode test",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    const prompt = buildPrompt(session, { workMode: true });
    assert.ok(prompt.includes("WORK MODE"));
    assert.ok(prompt.includes("request_update"));
  });

  it("does not include work mode hint when workMode is false", () => {
    const prompt = buildPrompt(makeSession(), { workMode: false });
    assert.ok(!prompt.includes("WORK MODE"));
  });

  // ---- GitHub access ----
  it("always includes GitHub access hint", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(prompt.includes("GITHUB ACCESS"));
  });

  // ---- refinements ----
  it("includes refinements when present", () => {
    const session = makeSession({
      refinements: ["Also check the tests", "Focus on error handling"],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("ADDITIONAL INSTRUCTIONS FROM USER"));
    assert.ok(prompt.includes("Also check the tests"));
    assert.ok(prompt.includes("Focus on error handling"));
  });

  it("omits refinements section when empty", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(!prompt.includes("ADDITIONAL INSTRUCTIONS"));
  });

  // ---- image metadata ----
  it("includes ATTACHED IMAGES section when availableImages is provided", () => {
    const availableImages = new Map([
      ["F123", { id: "F123", name: "screenshot.png", mimetype: "image/png", size: 1024, url_private: "https://example.com/img" }],
    ]);
    const prompt = buildPrompt(makeSession(), { availableImages });
    assert.ok(prompt.includes("ATTACHED IMAGES:"));
    assert.ok(prompt.includes("screenshot.png (file_id: F123)"));
    assert.ok(prompt.includes("view_slack_image"));
  });

  it("omits ATTACHED IMAGES section when no images", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(!prompt.includes("ATTACHED IMAGES"));
  });

  it("omits ATTACHED IMAGES section when availableImages is empty", () => {
    const prompt = buildPrompt(makeSession(), { availableImages: new Map() });
    assert.ok(!prompt.includes("ATTACHED IMAGES"));
  });
});
