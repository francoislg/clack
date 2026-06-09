import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildPrompt } from "./promptBuilder.js";
import type { SessionContext } from "../sessions.js";

/**
 * Build a minimal SessionContext for testing. Only the fields
 * that buildPrompt actually reads are required.
 */
function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    trigger: {
      type: "mentions",
      userId: "U1",
      messageTs: "1.0",
      messageText: "What does this function do?",
    },
    messages: [],
    threadContext: [],
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

  it("annotates thread messages that have image attachments", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Here's the screenshot",
          isBot: false,
          ts: "1234567890.000100",
          imageFiles: [
            {
              id: "F001",
              name: "screenshot.png",
              mimetype: "image/png",
              size: 1024,
              url_private: "https://example.com/img",
            },
          ],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("[attached images: screenshot.png (file_id: F001)]"));
  });

  it("annotates thread messages that have reactions with usernames", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Should we deploy?",
          isBot: false,
          ts: "1234567890.000100",
          reactions: [
            {
              emoji: "thumbsup",
              userIds: ["U1", "U2"],
              usernames: ["Bob", "Charlie"],
            },
            { emoji: "eyes", userIds: ["U3"], usernames: ["Dave"] },
          ],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(
      prompt.includes("[reactions: :thumbsup: by @Bob (U1), @Charlie (U2); :eyes: by @Dave (U3)]"),
    );
  });

  it("falls back to user IDs when reaction usernames are not resolved", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Check this",
          isBot: false,
          ts: "1234567890.000100",
          reactions: [{ emoji: "rocket", userIds: ["U1", "U2"] }],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("[reactions: :rocket: by U1, U2]"));
  });

  it("handles partially resolved reaction usernames", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Partial resolution",
          isBot: false,
          ts: "1234567890.000100",
          reactions: [{ emoji: "thumbsup", userIds: ["U1", "U2"], usernames: ["Bob"] }],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("[reactions: :thumbsup: by @Bob (U1), U2]"));
  });

  it("separates bot reactions from human reactions", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Trivia question",
          isBot: false,
          ts: "1234567890.000100",
          reactions: [
            {
              emoji: "+1",
              userIds: ["UBOT", "U1"],
              usernames: ["Clack", "Bob"],
              isBot: [true, false],
            },
          ],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("[reactions: :+1: by @Bob (U1) (bot: @Clack (UBOT))]"));
  });

  it("shows only bot label when all reactors are bots", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Auto-reacted",
          isBot: false,
          ts: "1234567890.000100",
          reactions: [
            {
              emoji: "white_check_mark",
              userIds: ["UBOT"],
              usernames: ["Clack"],
              isBot: [true],
            },
          ],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("[reactions: :white_check_mark: (bot: @Clack (UBOT))]"));
  });

  it("does not add reactions line when message has no reactions", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "No reactions here",
          isBot: false,
          ts: "1234567890.000100",
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(!prompt.includes("[reactions:"));
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
    assert.ok(prompt.includes("post_to"));
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

  // ---- attention-level guidance ----
  it("includes attention-level guidance with the current level for autoRespond", () => {
    const session = makeSession({ triggerType: "autoRespond", attentionLevel: "high" });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("current attention level"));
    assert.ok(prompt.includes('"high"'));
    assert.ok(prompt.includes('attention_level: "off"'));
    assert.ok(prompt.includes("thanks Clack"));
  });

  it("biases the attention-level guidance toward staying put", () => {
    const session = makeSession({ triggerType: "autoRespond", attentionLevel: "high" });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("Prefer to STAY"));
    assert.ok(prompt.includes("when in doubt, stay put"));
    // A one-shot reply must not be framed as a reason to lower the level.
    assert.ok(!prompt.includes("As a thread winds down, lower the level"));
  });

  it("includes attention-level guidance for threadReply", () => {
    const session = makeSession({ triggerType: "threadReply" });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("current attention level"));
    assert.ok(prompt.includes('attention_level: "off"'));
    assert.ok(prompt.includes("thanks Clack"));
  });

  it("includes attention-level guidance for mentions", () => {
    const session = makeSession({ triggerType: "mentions" });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("current attention level"));
    assert.ok(prompt.includes('attention_level: "off"'));
    assert.ok(prompt.includes("thanks Clack"));
  });

  it("defaults the surfaced level to medium when unset", () => {
    const session = makeSession({ triggerType: "mentions" });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes('current attention level is "medium"'));
  });

  it("omits attention-level guidance for reactions", () => {
    const session = makeSession({ triggerType: "reactions" });
    const prompt = buildPrompt(session);
    assert.ok(!prompt.includes("current attention level"));
    assert.ok(!prompt.includes("thanks Clack"));
  });

  it("omits attention-level guidance for directMessages", () => {
    const session = makeSession({ triggerType: "directMessages" });
    const prompt = buildPrompt(session);
    assert.ok(!prompt.includes("current attention level"));
    assert.ok(!prompt.includes("thanks Clack"));
  });

  it("omits delivery context when triggerType is undefined", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(!prompt.includes("DELIVERY CONTEXT"));
  });

  // ---- channel name ----
  it("includes channel name for non-DM triggers", () => {
    const session = makeSession({
      triggerType: "mentions",
      channelName: "backend-dev",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("Channel: #backend-dev"));
  });

  it("excludes channel name for direct messages", () => {
    const session = makeSession({
      triggerType: "directMessages",
      channelName: "some-dm-channel",
    });
    const prompt = buildPrompt(session);
    assert.ok(!prompt.includes("Channel: #"));
  });

  it("omits channel name line when channelName is undefined", () => {
    const session = makeSession({
      triggerType: "mentions",
    });
    const prompt = buildPrompt(session);
    assert.ok(!prompt.includes("Channel: #"));
  });

  it("uses channel name instead of ID in assistant panel context", () => {
    const session = makeSession({
      triggerType: "mentions",
      assistantOriginChannelId: "C789",
      assistantCurrentChannelId: "C999",
      channelName: "general",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("viewing channel #general"));
    assert.ok(!prompt.includes("viewing channel C999"));
  });

  it("falls back to channel ID in assistant panel when name unavailable", () => {
    const session = makeSession({
      triggerType: "mentions",
      assistantOriginChannelId: "C789",
      assistantCurrentChannelId: "C999",
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("viewing channel C999"));
  });

  // ---- active change ----
  it("includes active change context when present and changes workflow enabled", () => {
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
    const prompt = buildPrompt(session, { changesWorkflowEnabled: true });
    assert.ok(prompt.includes("ACTIVE CHANGE"));
    assert.ok(prompt.includes("feat/new-thing"));
    assert.ok(prompt.includes("my-org/my-repo"));
    assert.ok(prompt.includes("request_update"));
  });

  it("omits request_update/propose_change guidance in active change when changes workflow disabled", () => {
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
    const prompt = buildPrompt(session, { changesWorkflowEnabled: false });
    assert.ok(prompt.includes("ACTIVE CHANGE"));
    assert.ok(prompt.includes("feat/new-thing"));
    assert.ok(!prompt.includes("use `request_update`"));
    assert.ok(!prompt.includes("use `propose_change`"));
    assert.ok(prompt.includes("Changes Workflow is not available"));
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
  it("includes work mode hint with propose_change when no active change and changes workflow enabled", () => {
    const session = makeSession();
    const prompt = buildPrompt(session, { workMode: true, changesWorkflowEnabled: true });
    assert.ok(prompt.includes("WORK MODE"));
    assert.ok(prompt.includes("propose_change"));
  });

  it("includes work mode hint with request_update when active change exists and changes workflow enabled", () => {
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
    const prompt = buildPrompt(session, { workMode: true, changesWorkflowEnabled: true });
    assert.ok(prompt.includes("WORK MODE"));
    assert.ok(prompt.includes("request_update"));
  });

  it("falls back to explanatory work mode hint when changes workflow disabled", () => {
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
    const prompt = buildPrompt(session, { workMode: true, changesWorkflowEnabled: false });
    assert.ok(prompt.includes("WORK MODE"));
    assert.ok(!prompt.includes("use request_update"));
    assert.ok(!prompt.includes("Propose a code change using propose_change"));
    assert.ok(prompt.includes("Changes Workflow is not available"));
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
      trigger: {
        type: "mentions",
        userId: "U1",
        messageTs: "1.0",
        messageText: "What does this function do?",
      },
      messages: [
        { role: "user", source: "reply", text: "Also check the tests", ts: 1 },
        { role: "user", source: "reply", text: "Focus on error handling", ts: 2 },
      ],
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

  // ---- attachment metadata ----
  it("includes ATTACHED FILES section with images when availableImages is provided", () => {
    const availableImages = new Map([
      [
        "F123",
        {
          id: "F123",
          name: "screenshot.png",
          mimetype: "image/png",
          size: 1024,
          url_private: "https://example.com/img",
        },
      ],
    ]);
    const prompt = buildPrompt(makeSession(), { availableImages });
    assert.ok(prompt.includes("ATTACHED FILES:"));
    assert.ok(prompt.includes("[image] screenshot.png (file_id: F123)"));
    assert.ok(prompt.includes("view_slack_image"));
  });

  it("includes ATTACHED FILES section with non-image files", () => {
    const availableFiles = new Map([
      [
        "F456",
        {
          id: "F456",
          name: "report.pdf",
          mimetype: "application/pdf",
          size: 2048,
          url_private: "https://example.com/pdf",
        },
      ],
    ]);
    const prompt = buildPrompt(makeSession(), { availableFiles });
    assert.ok(prompt.includes("ATTACHED FILES:"));
    assert.ok(prompt.includes("[file] report.pdf (file_id: F456, type: application/pdf)"));
    assert.ok(prompt.includes("view_slack_file"));
  });

  it("includes both images and files in unified section", () => {
    const availableImages = new Map([
      [
        "F1",
        {
          id: "F1",
          name: "photo.jpg",
          mimetype: "image/jpeg",
          size: 1024,
          url_private: "https://example.com/img",
        },
      ],
    ]);
    const availableFiles = new Map([
      [
        "F2",
        {
          id: "F2",
          name: "data.csv",
          mimetype: "text/csv",
          size: 512,
          url_private: "https://example.com/csv",
        },
      ],
    ]);
    const prompt = buildPrompt(makeSession(), {
      availableImages,
      availableFiles,
    });
    assert.ok(prompt.includes("ATTACHED FILES:"));
    assert.ok(prompt.includes("[image] photo.jpg"));
    assert.ok(prompt.includes("[file] data.csv"));
  });

  it("omits ATTACHED FILES section when no attachments", () => {
    const prompt = buildPrompt(makeSession());
    assert.ok(!prompt.includes("ATTACHED FILES"));
  });

  it("omits ATTACHED FILES section when both maps are empty", () => {
    const prompt = buildPrompt(makeSession(), {
      availableImages: new Map(),
      availableFiles: new Map(),
    });
    assert.ok(!prompt.includes("ATTACHED FILES"));
  });

  // ---- thread context file annotations ----
  it("annotates thread messages with file attachments", () => {
    const session = makeSession({
      threadContext: [
        {
          userId: "U123",
          username: "alice",
          displayName: "Alice",
          text: "Here's the report",
          isBot: false,
          ts: "1234567890.000100",
          files: [
            {
              id: "F789",
              name: "report.pdf",
              mimetype: "application/pdf",
              size: 2048,
              url_private: "https://example.com/pdf",
            },
          ],
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(
      prompt.includes("[attached files: report.pdf (file_id: F789, type: application/pdf)]"),
    );
  });

  // ---- delta thread context on resume ----
  it("filters thread context to delta when resuming (sdkSessionId + lastSeenThreadTs)", () => {
    const session = makeSession({
      sdkSessionId: "sdk-uuid-123",
      lastSeenThreadTs: "1234567890.000200",
      threadContext: [
        {
          userId: "U1",
          text: "old message",
          isBot: false,
          ts: "1234567890.000100",
        },
        {
          userId: "U2",
          text: "also old",
          isBot: false,
          ts: "1234567890.000200",
        },
        {
          userId: "U3",
          text: "new message from someone",
          isBot: false,
          ts: "1234567890.000300",
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("NEW THREAD MESSAGES"));
    assert.ok(!prompt.includes("THREAD CONTEXT (previous"));
    assert.ok(prompt.includes("new message from someone"));
    assert.ok(!prompt.includes("old message"));
    assert.ok(!prompt.includes("also old"));
  });

  it("uses full thread context when sdkSessionId is set but lastSeenThreadTs is missing", () => {
    const session = makeSession({
      sdkSessionId: "sdk-uuid-123",
      threadContext: [
        {
          userId: "U1",
          text: "first message",
          isBot: false,
          ts: "1234567890.000100",
        },
        {
          userId: "U2",
          text: "second message",
          isBot: false,
          ts: "1234567890.000200",
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(prompt.includes("THREAD CONTEXT (previous"));
    assert.ok(!prompt.includes("NEW THREAD MESSAGES"));
    assert.ok(prompt.includes("first message"));
    assert.ok(prompt.includes("second message"));
  });

  it("omits thread context section when all messages are older than lastSeenThreadTs", () => {
    const session = makeSession({
      sdkSessionId: "sdk-uuid-123",
      lastSeenThreadTs: "1234567890.000999",
      threadContext: [
        { userId: "U1", text: "old", isBot: false, ts: "1234567890.000100" },
        {
          userId: "U2",
          text: "also old",
          isBot: false,
          ts: "1234567890.000200",
        },
      ],
    });
    const prompt = buildPrompt(session);
    assert.ok(!prompt.includes("THREAD CONTEXT"));
    assert.ok(!prompt.includes("NEW THREAD MESSAGES"));
  });

  // ---- skip evaluation section for scheduled runs ----
  describe("skip evaluation section", () => {
    const SAFEGUARD_ACK =
      "I acknowledge that responding to this would serve no purpose, so I am skipping it.";

    it("renders skip evaluation block for scheduled runs with skipConditions", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, {
        skipConditions: "Skip if no PRs were merged in the last 24 hours.",
      });

      assert.ok(prompt.includes("SKIP EVALUATION"));
      assert.ok(prompt.includes("Skip if no PRs were merged in the last 24 hours."));
      assert.ok(prompt.includes("skip_response: true"));
    });

    it("does NOT embed the safeguard acknowledgment string in the prompt", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, { skipConditions: "Skip on weekends." });

      assert.ok(
        !prompt.includes(SAFEGUARD_ACK),
        "the tool schema enforces the ack — it must not appear in the prompt",
      );
    });

    it("omits skip evaluation when skipConditions is absent", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session);

      assert.ok(!prompt.includes("SKIP EVALUATION"));
    });

    it("omits skip evaluation when skipConditions is empty string", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, { skipConditions: "" });

      assert.ok(!prompt.includes("SKIP EVALUATION"));
    });

    it("omits skip evaluation for non-scheduled triggers even when skipConditions is set", () => {
      const session = makeSession({ triggerType: "mentions" });
      const prompt = buildPrompt(session, { skipConditions: "Skip if X" });

      assert.ok(
        !prompt.includes("SKIP EVALUATION"),
        "skipConditions is scheduled-only — other triggers should never see the section",
      );
    });
  });

  // ---- submitResponseMode: "skipped" run-terminator hint ----
  describe("submitResponseMode 'skipped' hint", () => {
    it("renders the run-terminator hint for scheduled runs with mode 'skipped'", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, { submitResponseMode: "skipped" });

      assert.ok(prompt.includes("RUN TERMINATOR"));
      assert.ok(prompt.includes("skip_response: true"));
      assert.ok(prompt.includes("rejects every other field"));
    });

    it("suppresses the SKIP EVALUATION block when mode is 'skipped' (even if skipConditions is set)", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, {
        skipConditions: "Skip if no PRs were merged in the last 24 hours.",
        submitResponseMode: "skipped",
      });

      assert.ok(prompt.includes("RUN TERMINATOR"));
      assert.ok(
        !prompt.includes("SKIP EVALUATION"),
        "the strict-skip semantic forces a skip regardless of conditions — the pre-check would be misleading",
      );
    });

    it("does NOT render the terminator hint for mode 'always'", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, { submitResponseMode: "always" });
      assert.ok(!prompt.includes("RUN TERMINATOR"));
    });

    it("does NOT render the terminator hint for mode 'optional'", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, { submitResponseMode: "optional" });
      assert.ok(!prompt.includes("RUN TERMINATOR"));
    });

    it("does NOT render the terminator hint when mode is unset", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session);
      assert.ok(!prompt.includes("RUN TERMINATOR"));
    });

    it("does NOT render the terminator hint for non-scheduled triggers", () => {
      const session = makeSession({ triggerType: "mentions" });
      const prompt = buildPrompt(session, { submitResponseMode: "skipped" });
      assert.ok(
        !prompt.includes("RUN TERMINATOR"),
        "submitResponseMode lives on cron jobs — only scheduled triggers should see this hint",
      );
    });

    it("'optional' mode still renders SKIP EVALUATION when skipConditions is set", () => {
      const session = makeSession({ triggerType: "scheduled" });
      const prompt = buildPrompt(session, {
        skipConditions: "Skip on weekends.",
        submitResponseMode: "optional",
      });
      assert.ok(prompt.includes("SKIP EVALUATION"));
      assert.ok(!prompt.includes("RUN TERMINATOR"));
    });
  });

  describe("channelless scheduled delivery context", () => {
    it("renders the channelless variant when channelId is a channelless sentinel", () => {
      const session = makeSession({
        triggerType: "scheduled",
        channelId: "channelless:job-cl-1",
      });
      const prompt = buildPrompt(session);

      assert.ok(prompt.includes("Mode: Scheduled message — channelless"));
      assert.ok(prompt.includes("`submit_response({ deliver_to: [...] })`"));
      assert.ok(prompt.includes("explicit `channel`"));
      assert.ok(!prompt.includes("post_to"));
    });

    it("renders the original channel-bound variant when channelId is a real Slack channel", () => {
      const session = makeSession({ triggerType: "scheduled", channelId: "C123" });
      const prompt = buildPrompt(session);

      assert.ok(
        prompt.includes("Mode: Scheduled message (this is an automated cron-triggered execution)"),
      );
      assert.ok(!prompt.includes("Mode: Scheduled message — channelless"));
    });

    it("omits the channel preamble for channelless sessions", () => {
      const session = makeSession({
        triggerType: "scheduled",
        channelId: "channelless:job-cl-1",
      });
      const prompt = buildPrompt(session);

      assert.ok(
        !prompt.includes("channelless:job-cl-1"),
        "the synthetic sentinel must not leak into Claude's prompt",
      );
    });
  });

  describe("user skills catalog", () => {
    it("renders USER SKILLS subsection when userSkills are passed", () => {
      const session = makeSession();
      const prompt = buildPrompt(session, {
        userSkills: [
          {
            slug: "sports-analyst",
            description: "Use when the conversation involves hockey or NHL.",
          },
        ],
      });
      assert.ok(prompt.includes("USER SKILLS"));
      assert.ok(prompt.includes("sports-analyst"));
      assert.ok(prompt.includes("Use when the conversation involves hockey or NHL."));
    });

    it("omits USER SKILLS subsection when userSkills is empty", () => {
      const session = makeSession();
      const prompt = buildPrompt(session, { userSkills: [] });
      assert.ok(!prompt.includes("USER SKILLS"));
    });

    it("renders both lazy packs and USER SKILLS together", () => {
      const session = makeSession();
      const prompt = buildPrompt(session, {
        skillPluginsRegistry: {
          marketingskills: {
            lazyLoad: true,
            description: "Marketing playbooks.",
          },
        },
        userSkills: [{ slug: "sports-analyst", description: "Hockey persona." }],
      });
      assert.ok(prompt.includes("marketingskills"));
      assert.ok(prompt.includes("USER SKILLS"));
      assert.ok(prompt.includes("sports-analyst"));
    });
  });
});
