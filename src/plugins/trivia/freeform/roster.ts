import type { App } from "@slack/bolt";
import type { ContextBlock, DividerBlock, KnownBlock } from "@slack/types";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import { stripAnswerButtons } from "../revealCards/answerActions.js";
import { t } from "../i18n/t.js";
import { renderPlayerRef } from "../domain/tagPlayers.js";
import type { AnswerTypeHandler } from "../answerTypes/types.js";
import type {
  ScopedTriviaDataLayer,
  SubmittedAnswer,
  TriviaDataLayer,
  TriviaQuestion,
} from "../core/types.js";
import { parseChannelFromPermalink, parseTsFromPermalink } from "../tools/reveal/slack.js";

/** Per-group cap on visible names before the "+N" overflow takes over. */
const ROSTER_GROUP_CAP = 5;

/**
 * Compact-layout char threshold past which we fall back to multiline. Slack
 * context blocks render fine up to ~3000 chars, but past ~200 the single
 * line wraps poorly on mobile (especially with emoji prefixes that take
 * more visual space than their string length).
 */
const ROSTER_COMPACT_CHAR_LIMIT = 200;

export interface RosterGroup {
  /** Stable key returned by the answer-type handler. */
  groupKey: string;
  /** All answer rows in this group, sorted by timestamp DESC (newest first). */
  rows: SubmittedAnswer[];
  /** First `rows.length` user IDs, capped at `ROSTER_GROUP_CAP`. */
  recentUserIds: string[];
  /** rows.length - recentUserIds.length (>= 0). */
  overflowCount: number;
}

/**
 * Group answers by the question's per-format `rosterGroupKey`. Within each
 * group, dedupe by userId (keep the newest row per user) and sort
 * newest-first. The order of groups in the returned array preserves the
 * order each group's NEWEST row appeared in the input — so groups with
 * recent activity surface ahead of older ones.
 */
export function groupRosterAnswers(
  answers: SubmittedAnswer[],
  handler: AnswerTypeHandler,
): RosterGroup[] {
  const groupsByKey = new Map<string, Map<string, SubmittedAnswer>>();
  const groupNewest = new Map<string, number>();

  for (const a of answers) {
    const key = handler.rosterGroupKey(a);
    if (key === null) continue;
    let perUser = groupsByKey.get(key);
    if (perUser === undefined) {
      perUser = new Map();
      groupsByKey.set(key, perUser);
    }
    const existing = perUser.get(a.userId);
    if (existing === undefined || a.timestamp > existing.timestamp) {
      perUser.set(a.userId, a);
    }
    const groupMax = groupNewest.get(key) ?? -Infinity;
    if (a.timestamp > groupMax) groupNewest.set(key, a.timestamp);
  }

  const orderedKeys = [...groupNewest.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);

  return orderedKeys.map((groupKey) => {
    const perUser = groupsByKey.get(groupKey)!;
    const rows = [...perUser.values()].sort((a, b) => b.timestamp - a.timestamp);
    const recentUserIds = rows.slice(0, ROSTER_GROUP_CAP).map((r) => r.userId);
    const overflowCount = Math.max(0, rows.length - ROSTER_GROUP_CAP);
    return { groupKey, rows, recentUserIds, overflowCount };
  });
}

/** Render one user reference for the roster — mention or plain `@displayName`. */
type NameOf = (userId: string) => string;

function renderGroupCompact(
  group: RosterGroup,
  question: TriviaQuestion,
  handler: AnswerTypeHandler,
  nameOf: NameOf,
): string {
  const label = handler.rosterGroupLabel(group, question);
  const names = group.recentUserIds.map((id) => nameOf(id)).join(", ");
  const overflow = group.overflowCount > 0 ? ` +${group.overflowCount}` : "";
  return `${label} (${group.rows.length}) ${names}${overflow}`;
}

function renderGroupMultiline(
  group: RosterGroup,
  question: TriviaQuestion,
  handler: AnswerTypeHandler,
  nameOf: NameOf,
): string {
  const label = handler.rosterGroupLabel(group, question);
  const names = group.recentUserIds.map((id) => nameOf(id)).join(", ");
  const overflow = group.overflowCount > 0 ? ` +${group.overflowCount}` : "";
  return `  ${label} (${group.rows.length}): ${names}${overflow}`;
}

function renderHidden(answers: SubmittedAnswer[], nameOf: NameOf): string {
  // Dedupe by userId (newest wins), sort newest-first, cap at ROSTER_GROUP_CAP.
  const maxByUser = new Map<string, number>();
  for (const a of answers) {
    const prev = maxByUser.get(a.userId);
    if (prev === undefined || a.timestamp > prev) maxByUser.set(a.userId, a.timestamp);
  }
  const ordered = [...maxByUser.entries()].sort((x, y) => y[1] - x[1]).map(([userId]) => userId);
  const label = t("roster.answered_label");
  if (ordered.length === 0) return `${label} ${t("roster.no_answers_yet")}`;
  const visible = ordered.slice(0, ROSTER_GROUP_CAP);
  const overflow =
    ordered.length > ROSTER_GROUP_CAP ? ` +${ordered.length - ROSTER_GROUP_CAP}` : "";
  return `${label} ${visible.map((id) => nameOf(id)).join(", ")}${overflow}`;
}

/**
 * Build the per-question roster footer. Behavior depends on the question's
 * stamped `liveAnswersVisible`:
 *
 *  - `true` (or absent, the cascaded default): grouped by answer, capped at
 *    `ROSTER_GROUP_CAP` per group, with `+N` overflow. Tries compact
 *    single-line layout first; falls back to multiline when the rendered
 *    text exceeds `ROSTER_COMPACT_CHAR_LIMIT`.
 *  - `false`: flat ungrouped list, capped at `ROSTER_GROUP_CAP` total.
 */
export function buildRosterBlock(
  answers: SubmittedAnswer[],
  question: TriviaQuestion,
  handler: AnswerTypeHandler,
  nameOf: NameOf,
): ContextBlock {
  const liveAnswersVisible = question.liveAnswersVisible ?? true;
  let text: string;

  if (!liveAnswersVisible) {
    text = renderHidden(answers, nameOf);
  } else {
    const label = t("roster.answered_label");
    const groups = groupRosterAnswers(answers, handler);
    if (groups.length === 0) {
      text = `${label} ${t("roster.no_answers_yet")}`;
    } else {
      const compact = `${label} ${groups.map((g) => renderGroupCompact(g, question, handler, nameOf)).join(" · ")}`;
      if (compact.length <= ROSTER_COMPACT_CHAR_LIMIT) {
        text = compact;
      } else {
        const lines = groups
          .map((g) => renderGroupMultiline(g, question, handler, nameOf))
          .join("\n");
        text = `${label}\n${lines}`;
      }
    }
  }

  return {
    type: "context",
    block_id: `freeform-answered-roster:${question.id}`,
    elements: [{ type: "mrkdwn", text }],
  };
}

function buildRosterDivider(questionId: string): DividerBlock {
  return {
    type: "divider",
    block_id: `freeform-answered-divider:${questionId}`,
  };
}

/** Context block shown in place of the buttons + roster once a question is locked. */
function buildLockedNotice(questionId: string): ContextBlock {
  return {
    type: "context",
    block_id: `locked-notice:${questionId}`,
    elements: [{ type: "mrkdwn", text: t("card.locked_notice") }],
  };
}

/**
 * Narrow slice of the Slack web client used by `editRosterIntoCard`. The function
 * only calls `chat.update`, so we accept the smaller surface — production passes
 * the full `App["client"]` (which satisfies this Pick); tests can pass a minimal
 * mock without casts.
 */
export type RosterEditClient = {
  chat: Pick<App["client"]["chat"], "update">;
};

export interface EditRosterParams {
  client: RosterEditClient;
  scoped: ScopedTriviaDataLayer;
  /** Unscoped layer — used only to read the global users store for display names. */
  data: Pick<TriviaDataLayer, "loadUsers">;
  question: TriviaQuestion;
  handler: AnswerTypeHandler;
}

/**
 * Repaint the question card with the latest answered-roster footer. Caller
 * already ack'd the action; every failure path here just logs and returns —
 * never throws back into the handler.
 *
 * Cheater filter applies here: flagged-cheater rows are stripped from the
 * answer list before grouping so they don't surface in the public footer.
 */
export async function editRosterIntoCard(params: EditRosterParams): Promise<void> {
  const { client, scoped, data, question, handler } = params;

  if (question.postedBlocks === undefined) {
    logger.warn(
      `[trivia:freeform] roster edit skipped — question ${question.id} has no postedBlocks (legacy row)`,
    );
    return;
  }
  if (!question.messageLink) {
    logger.warn(
      `[trivia:freeform] roster edit skipped — question ${question.id} has no messageLink`,
    );
    return;
  }
  const ts = parseTsFromPermalink(question.messageLink);
  const channel = parseChannelFromPermalink(question.messageLink);
  if (ts === null || channel === null) {
    logger.warn(
      `[trivia:freeform] roster edit skipped — could not parse ts/channel for question ${question.id}: ${question.messageLink}`,
    );
    return;
  }

  // Always rebuild from postedBlocks — never from the current Slack state — so
  // edits can't accumulate stale roster blocks. A locked question drops the answer
  // buttons and the live roster in favour of the lock notice; an unlocked one keeps
  // both (the buttons live inside postedBlocks, so unlocking restores them for free).
  let updatedBlocks: KnownBlock[];
  if (question.answerLocked === true) {
    updatedBlocks = [...stripAnswerButtons(question.postedBlocks), buildLockedNotice(question.id)];
  } else {
    const allAnswers = await scoped.loadAnswers();
    const forThisQuestion = allAnswers.filter((a) => a.questionId === question.id);
    const cheats = await scoped.loadCheats();
    const cheaterIds = new Set(
      cheats.filter((c) => c.questionId === question.id).map((c) => c.cheaterUserId),
    );
    const filtered = forThisQuestion.filter((a) => !cheaterIds.has(a.userId));

    const tagPlayers = question.tagPlayers ?? true;
    const users = await data.loadUsers();
    const nameOf = (userId: string): string =>
      renderPlayerRef(userId, users.get(userId)?.displayName ?? userId, tagPlayers);

    updatedBlocks = [
      ...question.postedBlocks,
      buildRosterDivider(question.id),
      buildRosterBlock(filtered, question, handler, nameOf),
    ];
  }

  try {
    await client.chat.update({ channel, ts, blocks: updatedBlocks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[trivia:freeform] roster chat.update failed for question ${question.id}: ${msg}`);
  }
}
