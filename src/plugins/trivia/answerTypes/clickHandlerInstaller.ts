/**
 * Shared `vote:` action_id installer for clickable handlers (boolean / choice).
 * The two formats have nearly-identical click-handling flows: parse the
 * action_id → scope to the owning game → load the question → enforce lockout +
 * cheater filter → call `handler.resolveClick(...)` → `handler.toAnswerPatch(...)`
 * → persist (`saveAnswer` for new rows, `updateAnswer` for re-clicks) → refresh
 * the live roster footer. Centralizing it here keeps each format's handler file
 * focused on the format-specific atoms (the resolver and the patch shape).
 *
 * Freeform's handler installs a different action namespace (`freeform-answer:*`)
 * with a different body (opens a modal), so it does NOT use this installer —
 * it inlines its own registration inside `freeform.ts:registerInteractions`.
 */

import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import type { SubmittedAnswer, TriviaDataLayer } from "../core/types.js";
import { editRosterIntoCard } from "../freeform/roster.js";
import { t } from "../i18n/t.js";
import type { ClickableAnswerHandler, InteractionRegistrationDeps } from "./types.js";

/**
 * Parse a vote action_id of the form `plugin:trivia:vote:<questionId>:<value>`.
 * The last `:` separates the questionId from the value; questionIds are UUIDs
 * (no colons), so a `lastIndexOf(":")` split is unambiguous.
 */
function extractVoteFromActionId(actionId: string): { questionId: string; value: string } | null {
  const prefix = "plugin:trivia:vote:";
  if (!actionId.startsWith(prefix)) return null;
  const rest = actionId.slice(prefix.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0 || idx >= rest.length - 1) return null;
  return { questionId: rest.slice(0, idx), value: rest.slice(idx + 1) };
}

/** Scan every known game's `questions.json` for the owner of a questionId. */
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

/**
 * Register the shared `^vote:<questionId>:<value>$` action handler with the
 * SDK on behalf of a clickable handler. The handler's `resolveClick` does the
 * format-specific parsing; `toAnswerPatch` does the format-specific row patch.
 * Everything else (lookups, lockout, cheater filter, persistence, roster
 * refresh) is shared.
 *
 * NOTE: this installer is idempotent per handler-instance but NOT per SDK —
 * calling it twice for the same handler+SDK would double-register and fire the
 * action body twice. The registry's `registerInteractions` loop calls this
 * once per clickable handler at boot, which is the only intended entry point.
 *
 * Both boolean and choice currently register against the SAME regex
 * (`^vote:[^:]+:[^:]+$`). Slack's action dispatch is regex-based, so two
 * registrations with the same regex would both fire on every click. The
 * boolean and choice handlers' `resolveClick` would each accept its own
 * format's value strings and reject the other's (returning `null`) — but
 * relying on that to deduplicate would still cause two no-op handler bodies
 * to run per click. To avoid that, this installer accepts a per-handler regex
 * scoped to the values the handler can parse:
 *
 *   - boolean → /^vote:[^:]+:(true|false)$/
 *   - choice  → /^vote:[^:]+:[0-9]+$/
 *
 * The handler supplies the regex via `valuePattern`, so future formats can
 * carve out their own value space (e.g. `/^vote:[^:]+:[a-z]+$/`) without
 * clashing with existing formats.
 */
export function installClickableVoteHandler(
  sdk: Pick<ClackSdk, "registerAction" | "getSlackClient">,
  handler: ClickableAnswerHandler,
  deps: InteractionRegistrationDeps,
  valuePattern: RegExp,
): void {
  const { data, getGameNames } = deps;
  sdk.registerAction(valuePattern, async ({ ack, body, action, respond }) => {
    await ack();
    const client = sdk.getSlackClient();
    const actionId =
      "action_id" in action && typeof action.action_id === "string" ? action.action_id : "";
    const parsed = extractVoteFromActionId(actionId);
    if (parsed === null) {
      logger.warn(`[trivia:vote] unparseable action_id: ${actionId}`);
      return;
    }
    const { questionId, value } = parsed;

    if (!("user" in body) || typeof body.user !== "object" || body.user === null) {
      logger.warn("[trivia:vote] action body missing user; skipping");
      return;
    }
    const userObj = body.user;
    const userId =
      "id" in userObj && typeof (userObj as { id: unknown }).id === "string"
        ? (userObj as { id: string }).id
        : null;
    if (userId === null) {
      logger.warn("[trivia:vote] action body user object missing id");
      return;
    }
    const game = await findGameForQuestion(data, getGameNames(), questionId);
    if (game === null) {
      logger.warn(`[trivia:vote] no game owns question ${questionId}`);
      return;
    }

    const scoped = data.forGame(game);
    const questions = await scoped.loadQuestions();
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      logger.warn(`[trivia:vote] question ${questionId} disappeared between resolve and write`);
      return;
    }

    const notifyClosed = async (text: string): Promise<void> => {
      if (typeof respond !== "function") return;
      try {
        await respond({ response_type: "ephemeral", text });
      } catch (err) {
        logger.warn(`[trivia:vote] ephemeral respond failed: ${err}`);
      }
    };

    // Lock-out: post-reveal clicks ack silently and show an ephemeral note.
    if (question.processedAt !== undefined) {
      await notifyClosed(t("error.answers_closed_round"));
      return;
    }

    // Lock-out: a click on a frozen question (buttons removed, but a stale client
    // may still fire) ack's and shows the locked note without writing an answer.
    if (question.answerLocked === true) {
      await notifyClosed(t("error.answers_locked"));
      return;
    }

    // Cheater filter — write is silently dropped to preserve the audit trail
    // on cheats.json while keeping the cheater out of the live + reveal flows.
    const cheats = await scoped.loadCheats();
    const flagged = cheats.some((c) => c.questionId === questionId && c.cheaterUserId === userId);
    if (flagged) {
      logger.info(`[trivia:vote] dropped click from flagged user ${userId} on ${questionId}`);
      return;
    }

    const scored = handler.resolveClick(value, question);
    if (scored === null) {
      logger.warn(`[trivia:vote] invalid value "${value}" for question ${questionId}`);
      return;
    }

    const now = Date.now();
    // The patch's verdict is whatever `resolveClick` computed — `undefined` (pending)
    // when the question has no answer key yet (a deferred prediction), a real verdict
    // otherwise. The handler owns that decision; this installer stays format-agnostic.
    const patch = handler.toAnswerPatch(scored);
    const allAnswers = await scoped.loadAnswers();
    const existing = allAnswers.find((a) => a.userId === userId && a.questionId === questionId);

    if (existing) {
      // Re-click overwrite: apply the handler's patch (which clears the sibling
      // payload field) and bump the timestamp so the roster sorts the editor
      // to the top of their (possibly new) group.
      await scoped.updateAnswer(userId, questionId, { ...patch, timestamp: now });
    } else {
      const seasonTag = question.season !== undefined ? { season: question.season } : {};
      const row: SubmittedAnswer = {
        userId,
        questionId,
        timestamp: now,
        ...patch,
        ...seasonTag,
      };
      await scoped.saveAnswer(row);
      await data.recordJoin(userId);
      await data.refreshIdentities([userId]);
    }

    if (client !== null) {
      await editRosterIntoCard({ client, scoped, data, question, handler });
    }
  });
}
