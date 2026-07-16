import { describe, it, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  buildRosterBlock,
  editRosterIntoCard,
  groupRosterAnswers,
  type RosterEditClient,
} from "./roster.js";
import { getAnswerTypeHandler } from "../answerTypes/registry.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import { setTriviaT, _resetTriviaT } from "../i18n/t.js";
import { fr as triviaFr } from "../i18n/strings.js";
import type { KnownBlock } from "@slack/types";
import type { ChatUpdateResponse } from "@slack/web-api";
import type { SubmittedAnswer, TriviaQuestion } from "../core/types.js";

/** Default roster name renderer mirroring tagPlayers=true (pinging mention). */
const tagRef = (id: string): string => `<@${id}>`;

function freeformRow(userId: string, timestamp: number, text: string): SubmittedAnswer {
  return {
    userId,
    questionId: "q-1",
    answerText: text,
    timestamp,
  };
}

function booleanRow(userId: string, timestamp: number, answer: boolean): SubmittedAnswer {
  return {
    userId,
    questionId: "q-1",
    answer,
    correct: answer,
    timestamp,
  };
}

function choiceRow(userId: string, timestamp: number, answerIndex: number): SubmittedAnswer {
  return {
    userId,
    questionId: "q-1",
    answerIndex,
    correct: answerIndex === 0,
    timestamp,
  };
}

function freeformQuestion(): TriviaQuestion {
  return {
    id: "q-1",
    category: "C",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    emojis: ["🇫🇷"],
    createdAt: 0,
    liveAnswersVisible: true,
  };
}

function booleanQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "q-1",
    category: "C",
    statement: "Is this true?",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["⚡"],
    createdAt: 0,
    liveAnswersVisible: true,
    ...overrides,
  };
}

function choiceQuestion(): TriviaQuestion {
  return {
    id: "q-1",
    category: "C",
    statement: "Pick one",
    answersFormat: "choice",
    questionType: "fact",
    choices: ["The Beatles", "Led Zeppelin", "Cream", "The Who"],
    correctIndex: 0,
    emojis: ["🎸"],
    createdAt: 0,
    liveAnswersVisible: true,
  };
}

describe("groupRosterAnswers", () => {
  it("groups boolean answers by true/false", () => {
    const rows = [
      booleanRow("U_A", 100, true),
      booleanRow("U_B", 200, false),
      booleanRow("U_C", 150, true),
    ];
    const groups = groupRosterAnswers(rows, getAnswerTypeHandler("boolean"));
    assert.equal(groups.length, 2);
    const trueGroup = groups.find((g) => g.groupKey === "true");
    const falseGroup = groups.find((g) => g.groupKey === "false");
    assert.deepEqual(trueGroup?.recentUserIds, ["U_C", "U_A"]);
    assert.deepEqual(falseGroup?.recentUserIds, ["U_B"]);
  });

  it("groups choice answers by answerIndex", () => {
    const rows = [choiceRow("U_A", 100, 0), choiceRow("U_B", 200, 1), choiceRow("U_C", 300, 0)];
    const groups = groupRosterAnswers(rows, getAnswerTypeHandler("choice"));
    const group0 = groups.find((g) => g.groupKey === "0");
    assert.equal(group0?.recentUserIds.length, 2);
    assert.equal(group0?.recentUserIds[0], "U_C");
  });

  it("groups freeform answers case-insensitively by trimmed text", () => {
    const rows = [
      freeformRow("U_A", 100, "Paris"),
      freeformRow("U_B", 200, "paris"),
      freeformRow("U_C", 300, " PARIS "),
    ];
    const groups = groupRosterAnswers(rows, getAnswerTypeHandler("freeform"));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].groupKey, "paris");
    assert.equal(groups[0].recentUserIds.length, 3);
  });

  it("caps each group at 5 with an accurate overflow count", () => {
    const rows = Array.from({ length: 8 }, (_, i) => booleanRow(`U${i}`, i * 100, true));
    const groups = groupRosterAnswers(rows, getAnswerTypeHandler("boolean"));
    const trueGroup = groups[0];
    assert.equal(trueGroup.recentUserIds.length, 5);
    assert.equal(trueGroup.overflowCount, 3);
  });

  it("dedupes the same user (newest wins) within a group", () => {
    const rows = [
      booleanRow("U_A", 100, true),
      booleanRow("U_A", 300, true), // edit
      booleanRow("U_B", 200, true),
    ];
    const groups = groupRosterAnswers(rows, getAnswerTypeHandler("boolean"));
    assert.equal(groups[0].rows.length, 2);
    assert.equal(groups[0].recentUserIds[0], "U_A");
  });
});

describe("buildRosterBlock", () => {
  it("renders the empty-state sentinel for no answers", () => {
    const q = booleanQuestion();
    const block = buildRosterBlock([], q, getAnswerTypeHandler(q.answersFormat), tagRef, "grouped");
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /no answers yet/i);
    }
  });

  it("renders compact single-line layout under the char limit", () => {
    const rows = [booleanRow("U_A", 100, true), booleanRow("U_B", 200, false)];
    const q = booleanQuestion();
    const block = buildRosterBlock(
      rows,
      q,
      getAnswerTypeHandler(q.answersFormat),
      tagRef,
      "grouped",
    );
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /^📝 \*Answered:\*/);
      assert.match(el.text, /👍 \(1\) <@U_A>/);
      assert.match(el.text, /👎 \(1\) <@U_B>/);
      assert.equal(el.text.includes("\n"), false);
    }
  });

  it("falls back to multiline layout past the char limit", () => {
    // Many groups + many users → long compact line forces fallback.
    const rows: SubmittedAnswer[] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) {
        rows.push(choiceRow(`U_${i}_${j}`, i * 1000 + j, i));
      }
    }
    const q = choiceQuestion();
    const block = buildRosterBlock(
      rows,
      q,
      getAnswerTypeHandler(q.answersFormat),
      tagRef,
      "grouped",
    );
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /^📝 \*Answered:\*\n/);
    }
  });

  it("hides per-pick info in flat mode", () => {
    const rows = [booleanRow("U_A", 100, true), booleanRow("U_B", 200, false)];
    const q = booleanQuestion();
    const block = buildRosterBlock(rows, q, getAnswerTypeHandler(q.answersFormat), tagRef, "flat");
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /^📝 \*Answered:\* <@/);
      assert.equal(el.text.includes("👍"), false);
      assert.equal(el.text.includes("👎"), false);
    }
  });

  it("respects the 5-cap in flat mode with overflow", () => {
    const rows = Array.from({ length: 8 }, (_, i) => booleanRow(`U${i}`, i * 100, true));
    const q = booleanQuestion();
    const block = buildRosterBlock(rows, q, getAnswerTypeHandler(q.answersFormat), tagRef, "flat");
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /\+3$/);
    }
  });

  it("renders freeform answer text (truncated) as the group label", () => {
    const rows = [freeformRow("U_A", 100, "Paris")];
    const q = freeformQuestion();
    const block = buildRosterBlock(
      rows,
      q,
      getAnswerTypeHandler(q.answersFormat),
      tagRef,
      "grouped",
    );
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /"Paris"/);
    }
  });

  describe("localization", () => {
    afterEach(() => _resetTriviaT());

    it("renders the FR label and empty-state body when the plugin t() resolves FR", () => {
      const frLabel = triviaFr["roster.answered_label"]!;
      const frEmpty = triviaFr["roster.no_answers_yet"]!;
      setTriviaT((key) => {
        if (key === "roster.answered_label") return frLabel;
        if (key === "roster.no_answers_yet") return frEmpty;
        throw new Error(`unexpected key ${key}`);
      });
      const q = booleanQuestion();
      const block = buildRosterBlock(
        [],
        q,
        getAnswerTypeHandler(q.answersFormat),
        tagRef,
        "grouped",
      );
      const el = block.elements[0];
      if (el.type === "mrkdwn") {
        assert.ok(
          el.text.startsWith(frLabel),
          `expected text to start with FR label, got: ${el.text}`,
        );
        assert.ok(el.text.includes(frEmpty), `expected FR empty-state body in: ${el.text}`);
        assert.ok(!el.text.includes("Answered"), "EN label must not leak into FR output");
      }
    });
  });
});

describe("editRosterIntoCard", () => {
  interface BlockShape {
    type: string;
    text?: { type?: string; text?: string };
    elements?: Array<{ type?: string; text?: string }>;
  }

  interface CapturedCall {
    channel: string | undefined;
    ts: string | undefined;
    blocks: BlockShape[];
  }

  // The mock satisfies `RosterEditClient.chat.update` (the narrow `Pick` exposed
  // by roster.ts) — args use Slack's `ChatUpdateArguments` discriminated union,
  // but we only inspect the three fields editRosterIntoCard sets. `calls` is a
  // projection of the mock's call history, not a separate capture.
  type UpdateFn = (
    args: Parameters<RosterEditClient["chat"]["update"]>[0],
  ) => Promise<ChatUpdateResponse>;

  function fakeClient(): {
    chat: RosterEditClient["chat"];
    calls: CapturedCall[];
  } {
    const update = vi.fn<UpdateFn>(async () => ({ ok: true }));
    return {
      chat: { update },
      get calls(): CapturedCall[] {
        return update.mock.calls.map(([args]) => {
          // Slack's ChatUpdateArguments is a discriminated union; the variant
          // editRosterIntoCard uses is ChannelAndBlocks. Narrow via field probe.
          const blocks =
            "blocks" in args && Array.isArray(args.blocks) ? (args.blocks as BlockShape[]) : [];
          return { channel: args.channel, ts: args.ts, blocks };
        });
      },
    };
  }

  function postedQuestion(): TriviaQuestion {
    const blocks: KnownBlock[] = [
      { type: "header", text: { type: "plain_text", text: "🎯 TRIVIA TIME!" } },
      { type: "section", text: { type: "mrkdwn", text: "Statement" } },
      { type: "actions", elements: [] },
    ];
    return {
      id: "q-1", // matches booleanRow/freeformRow/choiceRow helpers above
      category: "C",
      statement: "Is this true?",
      answersFormat: "boolean",
      questionType: "fact",
      isTrue: true,
      emojis: ["⚡"],
      createdAt: 0,
      postedAt: 1000,
      messageLink: "https://example.slack.com/archives/C100000000/p1700000000000000",
      postedBlocks: blocks,
      liveAnswersVisible: true,
      revealResponses: "yes",
    };
  }

  /**
   * Pull text content out of the LAST block of a chat.update payload — that's
   * where editRosterIntoCard places the rebuilt roster footer.
   */
  function rosterText(call: CapturedCall): string {
    if (call.blocks.length === 0) return "";
    const last = call.blocks[call.blocks.length - 1];
    if (last.type === "context" && last.elements && last.elements.length > 0) {
      const el = last.elements[0];
      if (typeof el.text === "string") return el.text;
    }
    if (last.type === "section" && last.text && typeof last.text.text === "string") {
      return last.text.text;
    }
    return "";
  }

  it("re-click that flips TRUE → FALSE moves the user between groups in the rebuilt footer", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const question = postedQuestion();
    await scoped.saveQuestion(question);
    const handler = getAnswerTypeHandler(question.answersFormat);

    // First click: U_ALICE votes TRUE.
    await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
    await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 1000 });

    const client = fakeClient();
    await editRosterIntoCard({ client, scoped, data, question, handler });
    assert.equal(client.calls.length, 1, "first edit triggers one chat.update");
    const firstRoster = rosterText(client.calls[0]);
    // Slack roster uses `<@USERID>` mentions, not display names — assert on userId.
    assert.match(firstRoster, /<@U_ALICE>/, "Alice appears in the first footer");
    assert.equal(
      (firstRoster.match(/<@U_ALICE>/g) ?? []).length,
      1,
      "Alice listed exactly once after first click",
    );

    // Re-click: U_ALICE flips to FALSE. Update the existing row, bump timestamp.
    await scoped.updateAnswer("U_ALICE", question.id, {
      answer: false,
      correct: false,
      timestamp: 2000,
    });
    await editRosterIntoCard({ client, scoped, data, question, handler });
    assert.equal(client.calls.length, 2, "re-click edit triggers a second chat.update");

    // The rebuilt footer is sourced from current answers — Alice's row is still ONE row (not
    // two); the answer flipped from TRUE → FALSE so her label-group flips. Assert she appears
    // exactly once and the rebuilt block came from postedBlocks (not the previous edit's
    // blocks), which is the dedupe invariant the function guarantees.
    const secondRoster = rosterText(client.calls[1]);
    assert.equal(
      (secondRoster.match(/<@U_ALICE>/g) ?? []).length,
      1,
      "Alice listed exactly once after re-click (no duplicated stale row)",
    );
    // postedBlocks (3) + divider + roster = 5. Repeated edits never accumulate roster blocks.
    assert.equal(
      client.calls[1].blocks?.length,
      5,
      "rebuilt blocks length stays bounded — does not accumulate",
    );
  });

  it("strips flagged cheaters from the rebuilt footer before grouping", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const question = postedQuestion();
    await scoped.saveQuestion(question);
    await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
    await scoped.saveAnswer(booleanRow("U_CHEAT", 1100, true));
    await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });
    await data.saveUser({ userId: "U_CHEAT", displayName: "Cheater", joinedAt: 0 });
    await scoped.saveCheat({
      cheaterUserId: "U_CHEAT",
      questionId: question.id,
      reason: "leaked answer",
      detectedAt: new Date(1200).toISOString(),
    });

    const client = fakeClient();
    await editRosterIntoCard({
      client,
      scoped,
      data,
      question,
      handler: getAnswerTypeHandler(question.answersFormat),
    });

    const text = rosterText(client.calls[0]);
    assert.match(text, /<@U_ALICE>/);
    assert.doesNotMatch(text, /<@U_CHEAT>/, "cheater must not surface in the footer");
  });

  it("renders plain @displayName (no ping) when the question stamped tagPlayers=false", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const question = { ...postedQuestion(), tagPlayers: false };
    await scoped.saveQuestion(question);
    await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
    await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });

    const client = fakeClient();
    await editRosterIntoCard({
      client,
      scoped,
      data,
      question,
      handler: getAnswerTypeHandler(question.answersFormat),
    });

    const text = rosterText(client.calls[0]);
    assert.match(text, /@Alice/, "uses the display name");
    assert.doesNotMatch(text, /<@U_ALICE>/, "no pinging mention when tagPlayers=false");
  });

  describe("answerLocked branch", () => {
    function lockableQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
      const blocks: KnownBlock[] = [
        { type: "header", text: { type: "plain_text", text: "🎯 TRIVIA TIME!" } },
        { type: "section", text: { type: "mrkdwn", text: "Statement" } },
        { type: "actions", block_id: "vote-actions:q-1", elements: [] },
      ];
      return { ...postedQuestion(), postedBlocks: blocks, ...overrides };
    }

    function blockIds(call: CapturedCall): string[] {
      return call.blocks.map((b) => (b as { block_id?: string }).block_id ?? "");
    }

    it("strips the buttons and shows the lock notice alone when revealResponses is 'no'", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion({ answerLocked: true, revealResponses: "no" });
      await scoped.saveQuestion(question);
      await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
      await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });

      const client = fakeClient();
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question,
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      const ids = blockIds(client.calls[0]);
      assert.ok(!ids.includes("vote-actions:q-1"), "answer buttons stripped");
      assert.ok(
        !ids.some((id) => id.startsWith("freeform-answered-roster:")),
        "no roster footer when revealResponses is 'no'",
      );
      assert.equal(ids[ids.length - 1], "locked-notice:q-1", "lock notice is the last block");
      assert.match(rosterText(client.calls[0]), /Locked in/i);
    });

    it("shows the full grouped distribution while locked when revealResponses is 'yes'", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion({ answerLocked: true, revealResponses: "yes" });
      await scoped.saveQuestion(question);
      await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
      await scoped.saveAnswer(booleanRow("U_BOB", 1100, false));
      await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });
      await data.saveUser({ userId: "U_BOB", displayName: "Bob", joinedAt: 0 });

      const client = fakeClient();
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question,
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      const ids = blockIds(client.calls[0]);
      assert.ok(!ids.includes("vote-actions:q-1"), "answer buttons stripped");
      assert.ok(ids.includes("locked-notice:q-1"), "lock notice present");
      assert.ok(
        ids.some((id) => id.startsWith("freeform-answered-roster:")),
        "roster footer present below the notice",
      );
      const text = rosterText(client.calls[0]);
      assert.match(text, /<@U_ALICE>/, "names answerers");
      assert.match(text, /👍 \(1\) <@U_ALICE>/, "discloses picks (grouped)");
      assert.match(text, /👎 \(1\) <@U_BOB>/);
    });

    for (const mode of ["just-correctness", "just-winners"] as const) {
      it(`shows participation only (no picks) while locked when revealResponses is '${mode}'`, async () => {
        const data = createInMemoryDataLayer();
        const scoped = data.forGame(FIXTURE_GAME_NAME);
        const question = lockableQuestion({ answerLocked: true, revealResponses: mode });
        await scoped.saveQuestion(question);
        await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
        await scoped.saveAnswer(booleanRow("U_BOB", 1100, false));
        await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });
        await data.saveUser({ userId: "U_BOB", displayName: "Bob", joinedAt: 0 });

        const client = fakeClient();
        await editRosterIntoCard({
          client,
          scoped,
          data,
          question,
          handler: getAnswerTypeHandler(question.answersFormat),
        });

        const ids = blockIds(client.calls[0]);
        assert.ok(
          ids.some((id) => id.startsWith("freeform-answered-roster:")),
          "participation roster present",
        );
        const text = rosterText(client.calls[0]);
        assert.match(text, /<@U_ALICE>/, "names who answered");
        assert.match(text, /<@U_BOB>/);
        assert.equal(text.includes("👍"), false, "no picks disclosed");
        assert.equal(text.includes("👎"), false, "no picks disclosed");
      });
    }

    it("treats an absent revealResponses on a locked question as 'yes' (grouped)", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion({ answerLocked: true, revealResponses: undefined });
      await scoped.saveQuestion(question);
      await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
      await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });

      const client = fakeClient();
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question,
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      assert.match(rosterText(client.calls[0]), /👍 \(1\) <@U_ALICE>/, "grouped distribution");
    });

    it("ignores liveAnswersVisible while locked — 'yes' stays grouped even when it is false", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion({
        answerLocked: true,
        revealResponses: "yes",
        liveAnswersVisible: false,
      });
      await scoped.saveQuestion(question);
      await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
      await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });

      const client = fakeClient();
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question,
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      assert.match(
        rosterText(client.calls[0]),
        /👍 \(1\) <@U_ALICE>/,
        "grouped despite liveAnswersVisible:false",
      );
    });

    it("excludes flagged cheaters from the locked roster", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion({ answerLocked: true, revealResponses: "yes" });
      await scoped.saveQuestion(question);
      await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
      await scoped.saveAnswer(booleanRow("U_CHEAT", 1100, true));
      await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });
      await data.saveUser({ userId: "U_CHEAT", displayName: "Cheater", joinedAt: 0 });
      await scoped.saveCheat({
        cheaterUserId: "U_CHEAT",
        questionId: question.id,
        reason: "leaked answer",
        detectedAt: new Date(1200).toISOString(),
      });

      const client = fakeClient();
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question,
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      const text = rosterText(client.calls[0]);
      assert.match(text, /<@U_ALICE>/);
      assert.doesNotMatch(text, /<@U_CHEAT>/, "cheater must not surface on a locked card");
    });

    it("keeps the buttons and appends the roster when not locked", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion(); // answerLocked absent
      await scoped.saveQuestion(question);
      await scoped.saveAnswer(booleanRow("U_ALICE", 1000, true));
      await data.saveUser({ userId: "U_ALICE", displayName: "Alice", joinedAt: 0 });

      const client = fakeClient();
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question,
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      const ids = blockIds(client.calls[0]);
      assert.ok(ids.includes("vote-actions:q-1"), "answer buttons retained");
      assert.ok(!ids.includes("locked-notice:q-1"), "no lock notice when unlocked");
      assert.match(rosterText(client.calls[0]), /<@U_ALICE>/, "roster footer present");
    });

    it("restores the buttons when a previously-locked question is unlocked", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      const question = lockableQuestion();
      await scoped.saveQuestion(question);

      const client = fakeClient();
      // Lock, then unlock — both rebuild from the same postedBlocks.
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question: { ...question, answerLocked: true },
        handler: getAnswerTypeHandler(question.answersFormat),
      });
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question: { ...question, answerLocked: false },
        handler: getAnswerTypeHandler(question.answersFormat),
      });

      const lockedIds = blockIds(client.calls[0]);
      const unlockedIds = blockIds(client.calls[1]);
      assert.ok(!lockedIds.includes("vote-actions:q-1"), "buttons gone while locked");
      assert.ok(unlockedIds.includes("vote-actions:q-1"), "buttons back after unlock");
      assert.ok(!unlockedIds.includes("locked-notice:q-1"), "notice gone after unlock");
    });
  });
});
