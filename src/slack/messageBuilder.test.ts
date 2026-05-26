import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveReactionUsernames, threadMessageToToolOutput } from "./messageBuilder.js";
import type { MessageReaction, ThreadMessage } from "../sessions.js";
import type { UserInfo } from "./userCache.js";

function makeUserInfo(overrides: Partial<UserInfo> & { userId: string }): UserInfo {
  return { ...overrides };
}

function makeReaction(
  overrides: Partial<MessageReaction> & { emoji: string; userIds: string[] },
): MessageReaction {
  return { ...overrides };
}

function makeThreadMessage(overrides: Partial<ThreadMessage>): ThreadMessage {
  return {
    text: "test message",
    userId: "U000",
    isBot: false,
    ts: "1234567890.000100",
    ...overrides,
  };
}

describe("resolveReactionUsernames", () => {
  it("populates usernames from UserInfo", () => {
    const reactions = [makeReaction({ emoji: "+1", userIds: ["U1", "U2"] })];
    const userInfoMap = new Map<string, UserInfo>([
      ["U1", makeUserInfo({ userId: "U1", displayName: "Alice" })],
      ["U2", makeUserInfo({ userId: "U2", username: "bob" })],
    ]);

    resolveReactionUsernames(reactions, userInfoMap);

    assert.deepEqual(reactions[0].usernames, ["Alice", "bob"]);
  });

  it("falls back to userId when user not in map", () => {
    const reactions = [makeReaction({ emoji: "+1", userIds: ["U1", "UMISSING"] })];
    const userInfoMap = new Map<string, UserInfo>([
      ["U1", makeUserInfo({ userId: "U1", displayName: "Alice" })],
    ]);

    resolveReactionUsernames(reactions, userInfoMap);

    assert.deepEqual(reactions[0].usernames, ["Alice", "UMISSING"]);
  });

  it("populates isBot from UserInfo", () => {
    const reactions = [makeReaction({ emoji: "robot_face", userIds: ["U1", "UBOT"] })];
    const userInfoMap = new Map<string, UserInfo>([
      ["U1", makeUserInfo({ userId: "U1", displayName: "Alice", isBot: false })],
      ["UBOT", makeUserInfo({ userId: "UBOT", displayName: "Clack", isBot: true })],
    ]);

    resolveReactionUsernames(reactions, userInfoMap);

    assert.deepEqual(reactions[0].isBot, [false, true]);
  });

  it("defaults isBot to false when user not in map", () => {
    const reactions = [makeReaction({ emoji: "+1", userIds: ["UMISSING"] })];
    const userInfoMap = new Map<string, UserInfo>();

    resolveReactionUsernames(reactions, userInfoMap);

    assert.deepEqual(reactions[0].isBot, [false]);
  });
});

describe("threadMessageToToolOutput reactions", () => {
  it("separates human and bot users in reaction output", () => {
    const msg = makeThreadMessage({
      reactions: [
        makeReaction({
          emoji: "+1",
          userIds: ["U1", "UBOT"],
          usernames: ["Alice", "Clack"],
          isBot: [false, true],
        }),
      ],
    });

    const output = threadMessageToToolOutput(msg);

    assert.ok(output.reactions);
    assert.equal(output.reactions.length, 1);
    assert.deepEqual(output.reactions[0].users, ["Alice (U1)"]);
    assert.deepEqual(output.reactions[0].bot_users, ["Clack (UBOT)"]);
  });

  it("omits bot_users when all reactors are human", () => {
    const msg = makeThreadMessage({
      reactions: [
        makeReaction({
          emoji: "eyes",
          userIds: ["U1", "U2"],
          usernames: ["Alice", "Bob"],
          isBot: [false, false],
        }),
      ],
    });

    const output = threadMessageToToolOutput(msg);

    assert.ok(output.reactions);
    assert.deepEqual(output.reactions[0].users, ["Alice (U1)", "Bob (U2)"]);
    assert.equal(output.reactions[0].bot_users, undefined);
  });

  it("handles reactions with no isBot data (all treated as human)", () => {
    const msg = makeThreadMessage({
      reactions: [
        makeReaction({
          emoji: "rocket",
          userIds: ["U1"],
          usernames: ["Alice"],
        }),
      ],
    });

    const output = threadMessageToToolOutput(msg);

    assert.ok(output.reactions);
    assert.deepEqual(output.reactions[0].users, ["Alice (U1)"]);
    assert.equal(output.reactions[0].bot_users, undefined);
  });

  it("falls back to userId when username not resolved", () => {
    const msg = makeThreadMessage({
      reactions: [
        makeReaction({
          emoji: "+1",
          userIds: ["U1", "U2"],
          isBot: [false, true],
        }),
      ],
    });

    const output = threadMessageToToolOutput(msg);

    assert.ok(output.reactions);
    assert.deepEqual(output.reactions[0].users, ["U1"]);
    assert.deepEqual(output.reactions[0].bot_users, ["U2"]);
  });
});
