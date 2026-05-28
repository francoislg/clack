/**
 * Slack action handler for the "💡 Get Hint!" button (button-mode hints).
 * Registered against `^plugin:trivia:hint:[questionId]$`. On click:
 *
 *   1. Ack.
 *   2. Parse `questionId` from the action_id.
 *   3. Locate the owning game by scanning each known game's questions.json.
 *   4. Post an ephemeral message in the question's thread (visible only to the
 *      clicker) — hint text when present, "no hint available" fallback when
 *      the record carries no `hint` field (stale message, manual edit).
 *   5. If the question record has `hint.mode === "button"`, atomically add the
 *      clicker's user id to `hint.clickedBy` (deduped — Set semantics).
 *
 * Click tracking is BUTTON-MODE ONLY. The handler never updates `clickedBy`
 * for `inline`-mode records (defensive — inline never produces a click) and
 * never surfaces `clickedBy` data anywhere user-facing.
 */

import type { ChatPostEphemeralResponse } from "@slack/web-api";
import type { ClackSdk } from "../../sdk.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import type { TriviaDataLayer, TriviaQuestion } from "../core/types.js";

/**
 * Regex passed to `sdk.registerAction` — SDK auto-prefixes with `plugin:trivia:`,
 * so this matches the suffix only.
 */
const HINT_ACTION_RE = /^hint:[^:]+$/;
/**
 * Prefix on the FULL action_id Slack delivers at click time (after the SDK
 * has prepended its plugin scope). Used by the parser to extract the
 * questionId from the dispatched action_id.
 */
const HINT_ACTION_PREFIX = "plugin:trivia:hint:";

/**
 * Narrow shape of the Slack `WebClient` the handler actually needs — only
 * `chat.postEphemeral`. Typing `getSlackClient` against this subset keeps
 * tests simple (they don't need to satisfy 60+ unused `WebClient` properties).
 */
interface PostEphemeralArgs {
  channel: string;
  user: string;
  text: string;
  thread_ts?: string;
}
interface HintSlackClient {
  chat: { postEphemeral: (args: PostEphemeralArgs) => Promise<ChatPostEphemeralResponse> };
}

interface HintInstallDeps {
  data: TriviaDataLayer;
  getGameNames: () => string[];
}

export function installHintButtonHandler(
  sdk: Pick<ClackSdk, "registerAction" | "t"> & {
    getSlackClient: () => HintSlackClient | null;
  },
  deps: HintInstallDeps,
): void {
  const { data, getGameNames } = deps;
  sdk.registerAction(HINT_ACTION_RE, async ({ ack, body, action }) => {
    await ack();

    const actionId =
      "action_id" in action && typeof action.action_id === "string" ? action.action_id : "";
    const questionId = extractQuestionIdFromActionId(actionId);
    if (questionId === null) {
      logger.warn(`[trivia:hint] unparseable action_id: ${actionId}`);
      return;
    }

    if (!("user" in body) || typeof body.user !== "object" || body.user === null) {
      logger.warn("[trivia:hint] action body missing user; skipping");
      return;
    }
    const userObj = body.user;
    const userId =
      "id" in userObj && typeof (userObj as { id: unknown }).id === "string"
        ? (userObj as { id: string }).id
        : null;
    if (userId === null) {
      logger.warn("[trivia:hint] action body user object missing id");
      return;
    }

    const channelId =
      "channel" in body &&
      typeof body.channel === "object" &&
      body.channel !== null &&
      "id" in body.channel &&
      typeof (body.channel as { id: unknown }).id === "string"
        ? (body.channel as { id: string }).id
        : null;
    if (channelId === null) {
      logger.warn("[trivia:hint] action body missing channel.id");
      return;
    }

    const threadTs =
      "message" in body &&
      typeof body.message === "object" &&
      body.message !== null &&
      "ts" in body.message &&
      typeof (body.message as { ts: unknown }).ts === "string"
        ? (body.message as { ts: string }).ts
        : undefined;

    const game = await findGameForQuestion(data, getGameNames(), questionId);
    const scoped = game !== null ? data.forGame(game) : null;
    const question =
      scoped !== null ? (await scoped.loadQuestions()).find((q) => q.id === questionId) : undefined;

    const text =
      question?.hint !== undefined ? formatHintEphemeral(question, sdk.t) : sdk.t("hint.missing");

    const client = sdk.getSlackClient();
    if (client !== null) {
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        });
      } catch (err) {
        logger.warn(`[trivia:hint] postEphemeral failed: ${err}`);
      }
    }

    if (question?.hint?.mode === "button" && scoped !== null) {
      const existing = new Set(question.hint.clickedBy ?? []);
      if (!existing.has(userId)) {
        existing.add(userId);
        await scoped.updateQuestion(questionId, {
          hint: { ...question.hint, clickedBy: [...existing] },
        });
      }
    }
  });
}

export function extractQuestionIdFromActionId(actionId: string): string | null {
  if (!actionId.startsWith(HINT_ACTION_PREFIX)) return null;
  const id = actionId.slice(HINT_ACTION_PREFIX.length);
  if (id.length === 0 || id.includes(":")) return null;
  return id;
}

function formatHintEphemeral(question: TriviaQuestion, t: ClackSdk["t"]): string {
  if (question.hint === undefined) return t("hint.missing");
  const prefix = t("hint.ephemeral_prefix", { text: question.hint.text });
  return `${question.statement}\n${prefix}`;
}

async function findGameForQuestion(
  data: TriviaDataLayer,
  gameNames: readonly string[],
  questionId: string,
): Promise<string | null> {
  for (const name of gameNames) {
    const scoped = data.forGame(name);
    const questions = await scoped.loadQuestions();
    if (questions.some((q) => q.id === questionId)) return name;
  }
  return null;
}
