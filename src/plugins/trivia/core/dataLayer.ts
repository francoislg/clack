import { z } from "zod";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { loadTriviaConfig, defaultGetGames } from "./configBridge.js";
import { findGame } from "./gamesRegistry.js";
import { findCurrentSeason } from "./seasonTimeline.js";
import { monthInZone, seasonSlug, endOfMonthInZone } from "../domain/monthBoundaries.js";
import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  TeamAnswerSlot,
  SeasonEntry,
  SeasonsState,
  TriviaDataLayer,
  ScopedTriviaDataLayer,
} from "./types.js";
import type { JsonObject } from "./configTypes.js";
import { parsePhases } from "./configParsers/phases.js";

const triviaUserDataZod = z.object({
  joinedAt: z.number().optional(),
  cheatAttempts: z.number().optional(),
});

// Permissive shape gates for the persisted collections: each validates only the load-bearing
// fields every real record carries, so a corrupt/wrong-shape file falls back to empty while
// legacy/evolved records (extra fields) pass untouched — never wipe valid state (see CLAUDE.md).
const categoriesSchema = z.array(z.string());
const questionsSchema = z.array(z.object({ id: z.string() }));
const answersSchema = z.array(z.object({ userId: z.string(), questionId: z.string() }));
const cheatsSchema = z.array(z.object({ cheaterUserId: z.string(), questionId: z.string() }));
const teamAnswersSchema = z.array(
  z.object({ teamName: z.string(), questionId: z.string(), lastAnsweredBy: z.string() }),
);

/**
 * Permissive per-season shape gate. `looseObject` (the zod-v4 passthrough) is
 * MANDATORY: `saveSeasonsState` writes the whole entry back, so legacy on-disk
 * keys MUST survive the round-trip or a later save would silently discard real
 * state. Only the load-bearing identity fields are required (a malformed one drops
 * the entry, its siblings kept); every other modeled field is `.catch(undefined)`
 * so a bad value drops just that field, never the entry. `phases` is validated
 * separately via `parsePhases` in `parseSeasonsState` (it returns issues to log).
 */
export const seasonEntryZod = z.looseObject({
  slug: z.string(),
  startedAt: z.number(),
  expectedEndAt: z.number(),
  endedAt: z.number().optional().catch(undefined),
  theme: z.string().optional().catch(undefined),
  categories: z.array(z.string()).min(1).optional().catch(undefined),
});

/**
 * Graceful reader for a `seasons.json` payload. Drops only the parts that fail to
 * validate — a bad entry, a bad `phases` array, or a bad phase field — never the
 * whole file, and never the sibling entries. Every warning names the season slug
 * and the offending field. `label` names the source file in the log lines.
 */
export function parseSeasonsState(
  raw: unknown,
  sdk: ClackSdk,
  label = "seasons.json",
): SeasonsState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    sdk.logger.warn(`trivia: ${label} is not an object; treating as empty season state`);
    return { seasons: [] };
  }
  const seasonsRaw = (raw as JsonObject).seasons;
  if (!Array.isArray(seasonsRaw)) {
    sdk.logger.warn(`trivia: ${label} 'seasons' is not an array; treating as empty season state`);
    return { seasons: [] };
  }

  const seasons: SeasonEntry[] = [];
  seasonsRaw.forEach((entryRaw, i) => {
    const parsed = seasonEntryZod.safeParse(entryRaw);
    if (!parsed.success) {
      const named =
        entryRaw !== null &&
        typeof entryRaw === "object" &&
        !Array.isArray(entryRaw) &&
        typeof (entryRaw as JsonObject).slug === "string"
          ? String((entryRaw as JsonObject).slug)
          : "(unnamed)";
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      sdk.logger.warn(
        `trivia: ${label} season "${named}" (index ${i}) dropped — invalid identity field(s): ${detail}`,
      );
      return;
    }
    // `rest` carries every validated + passthrough field EXCEPT phases; phases is
    // re-attached only when it survives its own validation (dropped whole otherwise).
    const { phases: rawPhases, ...rest } = parsed.data;
    if (rawPhases === undefined) {
      seasons.push(rest as SeasonEntry);
      return;
    }
    const { phases, issues } = parsePhases(rawPhases, rest.slug);
    for (const issue of issues) {
      sdk.logger.warn(`trivia: ${label} '${issue.field}': ${issue.error}`);
    }
    if (phases === undefined) {
      seasons.push(rest as SeasonEntry);
      return;
    }
    const withPhases = { ...rest, phases };
    seasons.push(withPhases as SeasonEntry);
  });
  return { seasons };
}

async function readSdkJson<T>(
  sdk: ClackSdk,
  path: string,
  fallback: T,
  schema?: z.ZodTypeAny,
): Promise<T> {
  const raw = await sdk.readFile(path);
  if (raw === null) return fallback;
  let parsed: T;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    sdk.logger.warn(
      `trivia: ${path} is not valid JSON; using fallback: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
  if (schema !== undefined && !schema.safeParse(parsed).success) {
    sdk.logger.warn(`trivia: ${path} has an unexpected shape; using fallback`);
    return fallback;
  }
  return parsed;
}

function isSeasonsEnabled(): boolean {
  return loadTriviaConfig()?.seasons?.enabled === true;
}

function gameTimezone(name: string): string | undefined {
  return findGame(defaultGetGames(), name)?.timezone;
}

export function createSdkDataLayer(sdk: ClackSdk): TriviaDataLayer {
  // ── Global accessors ────────────────────────────────────────────────────────
  async function loadCategories(): Promise<string[]> {
    return readSdkJson<string[]>(sdk, "categories.json", [], categoriesSchema);
  }

  async function saveCategories(categories: string[]): Promise<void> {
    await sdk.writeFile("categories.json", JSON.stringify(categories, null, 2));
  }

  // Trivia's slice of each user's central-registry record (`plugins.trivia`).
  const userData = sdk.users.data(triviaUserDataZod);

  async function loadUsers(): Promise<Map<string, TriviaUser>> {
    const identities = await sdk.users.list();
    return new Map(identities.map((u) => [u.userId, u]));
  }

  async function refreshIdentities(userIds: readonly string[]): Promise<void> {
    await Promise.all([...new Set(userIds)].map((id) => sdk.users.get(id)));
  }

  async function recordJoin(userId: string): Promise<void> {
    const existing = await userData.get(userId);
    if (existing?.joinedAt !== undefined) return;
    await userData.merge(userId, { joinedAt: Date.now() });
  }

  // ── Per-game scoped accessor ────────────────────────────────────────────────
  function forGame(name: string): ScopedTriviaDataLayer {
    const qPath = `games/${name}/questions.json`;
    const aPath = `games/${name}/answers.json`;
    const cPath = `games/${name}/cheats.json`;
    const sPath = `games/${name}/seasons.json`;
    const taPath = `games/${name}/team-answers.json`;

    async function loadQuestions(): Promise<TriviaQuestion[]> {
      return readSdkJson<TriviaQuestion[]>(sdk, qPath, [], questionsSchema);
    }

    async function saveQuestion(q: TriviaQuestion): Promise<void> {
      const questions = await loadQuestions();
      questions.push(q);
      await sdk.writeFile(qPath, JSON.stringify(questions, null, 2));
    }

    async function updateQuestion(id: string, updates: Partial<TriviaQuestion>): Promise<void> {
      const questions = await loadQuestions();
      const idx = questions.findIndex((q) => q.id === id);
      if (idx === -1) return;
      questions[idx] = { ...questions[idx], ...updates };
      await sdk.writeFile(qPath, JSON.stringify(questions, null, 2));
    }

    async function loadAnswers(): Promise<SubmittedAnswer[]> {
      return readSdkJson<SubmittedAnswer[]>(sdk, aPath, [], answersSchema);
    }

    async function saveAnswer(a: SubmittedAnswer): Promise<void> {
      const answers = await loadAnswers();
      answers.push(a);
      await sdk.writeFile(aPath, JSON.stringify(answers, null, 2));
    }

    async function updateAnswer(
      userId: string,
      questionId: string,
      partial: Partial<SubmittedAnswer>,
    ): Promise<void> {
      const answers = await loadAnswers();
      const idx = answers.findIndex((a) => a.userId === userId && a.questionId === questionId);
      if (idx === -1) {
        sdk.logger.warn(
          `updateAnswer: no row found for (userId=${userId}, questionId=${questionId})`,
        );
        return;
      }
      answers[idx] = { ...answers[idx], ...partial };
      await sdk.writeFile(aPath, JSON.stringify(answers, null, 2));
    }

    async function loadCheats(): Promise<CheatReport[]> {
      return readSdkJson<CheatReport[]>(sdk, cPath, [], cheatsSchema);
    }

    async function loadTeamAnswers(): Promise<TeamAnswerSlot[]> {
      return readSdkJson<TeamAnswerSlot[]>(sdk, taPath, [], teamAnswersSchema);
    }

    async function upsertTeamAnswer(slot: TeamAnswerSlot): Promise<void> {
      const slots = await loadTeamAnswers();
      const idx = slots.findIndex(
        (s) => s.teamName === slot.teamName && s.questionId === slot.questionId,
      );
      if (idx === -1) slots.push(slot);
      else slots[idx] = slot;
      await sdk.writeFile(taPath, JSON.stringify(slots, null, 2));
    }

    async function removeTeamAnswer(teamName: string, questionId: string): Promise<void> {
      const slots = await loadTeamAnswers();
      const remaining = slots.filter(
        (s) => !(s.teamName === teamName && s.questionId === questionId),
      );
      if (remaining.length === slots.length) return;
      await sdk.writeFile(taPath, JSON.stringify(remaining, null, 2));
    }

    /**
     * Fallback season-bootstrap: when seasons is enabled and this game's seasons.json
     * is missing, seed a starter season (slug `season-YYYY-MM`) before returning.
     * The primary path is `upsert_game`'s required `initialSeason`, which writes the
     * file at creation; this fallback covers games that acquire a seasons.json by
     * another route (hand-edited `config.json`, pre-existing games), so no consumer
     * ever sees a seasons-enabled game with a null current season. Subsequent calls
     * find the file and skip the seed. The starter entry has no `categories` field —
     * it inherits from the cascade (game's `categories` if set, else the global
     * `categories.json`). See `resolveActiveCategories` in `../domain/categories.ts`.
     * The starter season's month and end instant are resolved in the game's configured
     * timezone, so the window closes with the last local day of the month.
     */
    async function loadSeasonsState(): Promise<SeasonsState | null> {
      const raw = await sdk.readFile(sPath);
      if (raw !== null) {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch (err) {
          sdk.logger.warn(
            `trivia: ${sPath} is not valid JSON; treating as empty season state: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { seasons: [] };
        }
        return parseSeasonsState(parsedJson, sdk, sPath);
      }
      if (!isSeasonsEnabled()) return null;
      const now = Date.now();
      const timezone = gameTimezone(name);
      if (timezone === undefined) {
        sdk.logger.warn(
          `trivia: game "${name}" is absent from config; seeding its starter season on UTC month boundaries`,
        );
      }
      const month = monthInZone(now, timezone);
      const seeded: SeasonsState = {
        seasons: [
          {
            slug: seasonSlug(month),
            startedAt: now,
            expectedEndAt: endOfMonthInZone(month, timezone),
          },
        ],
      };
      await sdk.writeFile(sPath, JSON.stringify(seeded, null, 2));
      return seeded;
    }

    async function saveSeasonsState(state: SeasonsState): Promise<void> {
      await sdk.writeFile(sPath, JSON.stringify(state, null, 2));
    }

    async function getCurrentSeasonSlug(): Promise<string | null> {
      const state = await loadSeasonsState();
      return findCurrentSeason(state, Date.now())?.slug ?? null;
    }

    async function saveCheat(report: CheatReport): Promise<{ totalAttempts: number }> {
      const cheats = await loadCheats();
      cheats.push(report);
      await sdk.writeFile(cPath, JSON.stringify(cheats, null, 2));

      // Cheat tally is global — it lives in the user's central-registry trivia namespace.
      const existing = await userData.get(report.cheaterUserId);
      const totalAttempts = (existing?.cheatAttempts ?? 0) + 1;
      await userData.merge(report.cheaterUserId, { cheatAttempts: totalAttempts });
      return { totalAttempts };
    }

    async function removeCheat(
      cheaterUserId: string,
      questionId: string,
    ): Promise<{ removedCount: number; totalAttempts: number }> {
      const cheats = await loadCheats();
      const remaining = cheats.filter(
        (c) => !(c.cheaterUserId === cheaterUserId && c.questionId === questionId),
      );
      const removedCount = cheats.length - remaining.length;

      const existing = await userData.get(cheaterUserId);
      if (removedCount === 0) {
        return { removedCount: 0, totalAttempts: existing?.cheatAttempts ?? 0 };
      }

      await sdk.writeFile(cPath, JSON.stringify(remaining, null, 2));

      const totalAttempts = Math.max(0, (existing?.cheatAttempts ?? 0) - removedCount);
      await userData.merge(cheaterUserId, { cheatAttempts: totalAttempts });
      return { removedCount, totalAttempts };
    }

    return {
      loadQuestions,
      saveQuestion,
      updateQuestion,
      loadAnswers,
      saveAnswer,
      updateAnswer,
      loadCheats,
      saveCheat,
      removeCheat,
      loadTeamAnswers,
      upsertTeamAnswer,
      removeTeamAnswer,
      loadSeasonsState,
      saveSeasonsState,
      getCurrentSeasonSlug,
    };
  }

  return {
    loadCategories,
    saveCategories,
    loadUsers,
    refreshIdentities,
    recordJoin,
    forGame,
  };
}
