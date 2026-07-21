import { triviaLogger as logger } from "../../core/pluginLogger.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";
import { editRosterIntoCard, type RosterEditClient } from "../../freeform/roster.js";
import type { ScopedTriviaDataLayer, TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

export interface LockTransitionResult {
  changed: string[];
  errors: Array<{ questionId: string; error: string }>;
}

/**
 * Stamp `answerLocked` onto each target question and repaint its card through the
 * live-card rebuild (which honors the flag — buttons + roster when unlocking, lock
 * notice when locking). The persisted flag is the source of truth (it gates clicks
 * and the reveal, which strips buttons regardless); the card repaint is best-effort —
 * `editRosterIntoCard` logs and swallows its own `chat.update` failures, so a question
 * whose card edit failed is still reported in `changed`. Only a persist failure lands
 * in `errors`. Per-card isolated either way: one question's failure never aborts the
 * loop. Shared by `lock_questions` and `unlock_questions` — they differ only in the
 * target predicate and the flag value.
 */
export async function transitionLock(params: {
  scoped: ScopedTriviaDataLayer;
  data: Pick<TriviaDataLayer, "loadUsers" | "recordJoin" | "refreshIdentities">;
  client: RosterEditClient;
  targets: TriviaQuestion[];
  answerLocked: boolean;
}): Promise<LockTransitionResult> {
  const { scoped, data, client, targets, answerLocked } = params;
  const changed: string[] = [];
  const errors: Array<{ questionId: string; error: string }> = [];

  for (const question of targets) {
    try {
      await scoped.updateQuestion(question.id, { answerLocked });
      const handler = getAnswerTypeHandler(question.answersFormat);
      await editRosterIntoCard({
        client,
        scoped,
        data,
        question: { ...question, answerLocked },
        handler,
      });
      changed.push(question.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[trivia:lock] question ${question.id} failed: ${message}`);
      errors.push({ questionId: question.id, error: message });
    }
  }

  return { changed, errors };
}
