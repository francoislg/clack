import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { installClickableVoteHandler } from "./clickHandlerInstaller.js";
import { booleanAnswerHandler } from "./boolean.js";
import { choiceAnswerHandler } from "./choice.js";
import { createTriviaDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";
import type { PluginActionHandler } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

/**
 * Integration-style tests for the shared `vote:` action handler installed by
 * `installClickableVoteHandler`. Covers the click-handler contract that runs
 * BETWEEN Slack action dispatch and the per-handler `resolveClick`/`toAnswerPatch`:
 * first click vs re-click, lockout after `processedAt`, cheater filter, invalid
 * value, and roster refresh wiring.
 *
 * The Bolt-shaped middleware args are large; the click handler only reads four
 * fields (`ack`, `body`, `action`, `respond`), so this test invokes the captured
 * registration via a narrowed alias type so we can stub just those four.
 */

interface CapturedRegistration {
  pattern: string | RegExp;
  handler: PluginActionHandler;
}

interface MinimalActionArgs {
  ack: () => Promise<void>;
  body: { user: { id: string; name: string } };
  action: { action_id: string };
  respond: (msg: { response_type?: string; text?: string }) => Promise<void>;
}

type MinimalActionHandler = (args: MinimalActionArgs) => Promise<void> | void;

interface RespondLog {
  calls: Array<{ response_type?: string; text?: string }>;
  ackCalled: boolean;
}

async function invokeAction(
  reg: CapturedRegistration,
  opts: { actionId: string; userId: string; displayName?: string },
): Promise<RespondLog> {
  const log: RespondLog = { calls: [], ackCalled: false };
  const minimal: MinimalActionArgs = {
    ack: async () => {
      log.ackCalled = true;
    },
    body: { user: { id: opts.userId, name: opts.displayName ?? opts.userId } },
    action: { action_id: opts.actionId },
    respond: async (msg) => {
      log.calls.push(msg);
    },
  };
  const narrowed = reg.handler as MinimalActionHandler;
  await narrowed(minimal);
  return log;
}

function makeBooleanQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "QB1",
    category: "Science",
    statement: "Water boils at 100C at sea level.",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["💧"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
    revealResponses: "yes",
    ...overrides,
  };
}

function makeChoiceQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "QC1",
    category: "Geography",
    statement: "Which is the smallest planet?",
    answersFormat: "choice",
    questionType: "fact",
    choices: ["Mercury", "Venus", "Earth", "Mars"],
    correctIndex: 0,
    emojis: ["🪐"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
    revealResponses: "yes",
    ...overrides,
  };
}

function setupBoolean() {
  const { sdk } = createFakeSdk();
  primeTriviaConfig(sdk);
  const { dataLayer: data } = createTriviaDataLayer(sdk);
  installClickableVoteHandler(
    sdk,
    booleanAnswerHandler,
    { data, getGameNames: () => [FIXTURE_GAME_NAME] },
    /^plugin:trivia:vote:[^:]+:(true|false)$/,
  );
  const [pattern, handler] = sdk.registerAction.mock.calls[0];
  return { sdk, data, installed: { pattern, handler } };
}

function setupChoice() {
  const { sdk } = createFakeSdk();
  primeTriviaConfig(sdk);
  const { dataLayer: data } = createTriviaDataLayer(sdk);
  installClickableVoteHandler(
    sdk,
    choiceAnswerHandler,
    { data, getGameNames: () => [FIXTURE_GAME_NAME] },
    /^plugin:trivia:vote:[^:]+:[0-9]+$/,
  );
  const [pattern, handler] = sdk.registerAction.mock.calls[0];
  return { sdk, data, installed: { pattern, handler } };
}

describe("installClickableVoteHandler — vote click flow", () => {
  it("first click persists a SubmittedAnswer row with correct=true for the right value", async () => {
    const { sdk, data, installed } = setupBoolean();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeBooleanQuestion());

    await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:true",
      userId: "U_ALICE",
    });

    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 1);
    assert.equal(answers[0].userId, "U_ALICE");
    assert.equal(answers[0].questionId, "QB1");
    assert.equal(answers[0].correct, true);
    assert.equal(answers[0].answer, true);

    // Records the user's join time in trivia's registry namespace.
    const joined = await sdk.users
      .data(z.object({ joinedAt: z.number().optional() }))
      .get("U_ALICE");
    assert.equal(joined?.joinedAt !== undefined, true);
  });

  it("re-click overwrites the same user's existing answer instead of inserting a duplicate row", async () => {
    const { data, installed } = setupBoolean();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeBooleanQuestion());

    // First click: TRUE (correct)
    await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:true",
      userId: "U_ALICE",
    });
    // Re-click: FALSE (now incorrect)
    await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:false",
      userId: "U_ALICE",
    });

    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 1, "re-click must overwrite, not append");
    assert.equal(answers[0].answer, false);
    assert.equal(answers[0].correct, false);
  });

  it("late click after processedAt acks silently and sends an ephemeral 'answers are closed' message", async () => {
    const { data, installed } = setupBoolean();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeBooleanQuestion({ processedAt: 9999 }));

    const respondLog = await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:true",
      userId: "U_LATE",
    });

    // Click was acked but no answer was persisted.
    assert.equal(respondLog.ackCalled, true);
    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 0, "post-reveal click must not write");

    // Ephemeral was sent.
    assert.equal(respondLog.calls.length, 1);
    assert.equal(respondLog.calls[0].response_type, "ephemeral");
    assert.match(respondLog.calls[0].text ?? "", /Answers are closed/);
  });

  it("click on a locked question acks silently and sends an ephemeral 'answers are locked' message", async () => {
    const { data, installed } = setupBoolean();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeBooleanQuestion({ answerLocked: true }));

    const respondLog = await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:true",
      userId: "U_LATE",
    });

    assert.equal(respondLog.ackCalled, true);
    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 0, "locked click must not write");
    assert.equal(respondLog.calls.length, 1);
    assert.equal(respondLog.calls[0].response_type, "ephemeral");
    assert.match(respondLog.calls[0].text ?? "", /locked/i);
  });

  it("flagged cheater click is silently dropped (no answer, no ephemeral)", async () => {
    const { data, installed } = setupBoolean();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeBooleanQuestion());
    await scoped.saveCheat({
      cheaterUserId: "U_CHEAT",
      questionId: "QB1",
      reason: "leaked answer",
      detectedAt: new Date(500).toISOString(),
    });

    const respondLog = await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:true",
      userId: "U_CHEAT",
    });

    // Acked silently, no write, no ephemeral.
    assert.equal(respondLog.ackCalled, true);
    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 0);
    assert.equal(respondLog.calls.length, 0);
  });

  it("invalid value (out-of-range choice index) is silently dropped without persistence", async () => {
    const { data, installed } = setupChoice();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeChoiceQuestion());

    // The choice question has 4 options (indices 0-3). Voting "9" must be rejected.
    const respondLog = await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QC1:9",
      userId: "U_BAD",
    });

    assert.equal(respondLog.ackCalled, true);
    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 0, "out-of-range click must not write");
    // No ephemeral; the click silently drops on the floor server-side.
    assert.equal(respondLog.calls.length, 0);
  });

  it("unparseable action_id is silently dropped", async () => {
    const { data, installed } = setupBoolean();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeBooleanQuestion());

    await invokeAction(installed, {
      actionId: "plugin:trivia:vote:malformed_no_colon",
      userId: "U_ALICE",
    });

    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 0);
  });

  it("click on a questionId no game owns is silently dropped", async () => {
    const { data, installed } = setupBoolean();
    // No question saved → no game owns "QB1".
    const scoped = data.forGame(FIXTURE_GAME_NAME);

    await invokeAction(installed, {
      actionId: "plugin:trivia:vote:QB1:true",
      userId: "U_ALICE",
    });

    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 0);
  });

  it("re-click bumps the timestamp so the roster sorts the editor to the top of their new group", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_700_000_000_000));
      const { data, installed } = setupBoolean();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      await scoped.saveQuestion(makeBooleanQuestion());

      await invokeAction(installed, {
        actionId: "plugin:trivia:vote:QB1:true",
        userId: "U_ALICE",
      });
      const firstAnswers = await scoped.loadAnswers();
      const firstTs = firstAnswers[0].timestamp;

      // Advance the clock so Date.now() returns a strictly later value on re-click.
      vi.setSystemTime(new Date(1_700_000_005_000));

      await invokeAction(installed, {
        actionId: "plugin:trivia:vote:QB1:false",
        userId: "U_ALICE",
      });
      const secondAnswers = await scoped.loadAnswers();
      assert.ok(secondAnswers[0].timestamp > firstTs, "re-click timestamp must be bumped");
    } finally {
      vi.useRealTimers();
    }
  });
});
