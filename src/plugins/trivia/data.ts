import type { ClackSdk } from "../sdk.js";
import { getConfig } from "../../config.js";
import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  SeasonsState,
  SeasonEntry,
  TriviaDataLayer,
  ScopedTriviaDataLayer,
} from "./types.js";

/**
 * Returns the season whose active window contains `now`, or null when `now` falls
 * in a gap between seasons (or there is no current state at all).
 *
 * The active window is `[startedAt, endedAt ?? expectedEndAt)`. The no-overlap
 * invariant enforced by upsert_season guarantees at most one season satisfies the
 * predicate; if more than one does, the timeline has been corrupted and we throw.
 */
export function findCurrentSeason(state: SeasonsState | null, now: number): SeasonEntry | null {
  if (state === null) return null;
  const active = state.seasons.filter(
    (s) => s.startedAt <= now && (s.endedAt ?? s.expectedEndAt) > now,
  );
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  throw new Error(
    `Timeline invariant violated: ${active.length} seasons active at ${new Date(now).toISOString()}`,
  );
}

/**
 * Returns the next future season — the entry with the smallest `startedAt` strictly
 * greater than `now`, or null if none exist.
 */
export function findNextSeason(state: SeasonsState | null, now: number): SeasonEntry | null {
  if (state === null) return null;
  const future = state.seasons.filter((s) => s.startedAt > now);
  if (future.length === 0) return null;
  return future.reduce((earliest, s) => (s.startedAt < earliest.startedAt ? s : earliest));
}

/** Returns the season whose slug matches, or null. */
export function findSeasonBySlug(state: SeasonsState | null, slug: string): SeasonEntry | null {
  if (state === null) return null;
  return state.seasons.find((s) => s.slug === slug) ?? null;
}

/**
 * Two intervals `[aStart, aEnd)` and `[bStart, bEnd)` overlap iff aStart < bEnd && bStart < aEnd.
 * For seasons, the "end" of the interval is `endedAt ?? expectedEndAt`.
 */
function intervalsOverlap(a: SeasonEntry, b: SeasonEntry): boolean {
  const aEnd = a.endedAt ?? a.expectedEndAt;
  const bEnd = b.endedAt ?? b.expectedEndAt;
  return a.startedAt < bEnd && b.startedAt < aEnd;
}

/**
 * Throws if `proposed` would overlap any other season on the timeline.
 * `excludingSlug` is excluded from the overlap check — used when upserting an existing entry.
 */
export function validateNoOverlap(
  state: SeasonsState | null,
  proposed: SeasonEntry,
  excludingSlug?: string,
): void {
  if (state === null) return;
  for (const existing of state.seasons) {
    if (excludingSlug !== undefined && existing.slug === excludingSlug) continue;
    if (intervalsOverlap(proposed, existing)) {
      throw new Error(
        `Season "${proposed.slug}" interval [${proposed.startedAt}, ${proposed.endedAt ?? proposed.expectedEndAt}) overlaps existing season "${existing.slug}" [${existing.startedAt}, ${existing.endedAt ?? existing.expectedEndAt})`,
      );
    }
  }
}

async function readSdkJson<T>(sdk: ClackSdk, path: string, fallback: T): Promise<T> {
  const raw = await sdk.readFile(path);
  if (raw === null) return fallback;
  const parsed: T = JSON.parse(raw);
  return parsed;
}

function isSeasonsEnabled(): boolean {
  try {
    return getConfig().trivia?.seasons?.enabled === true;
  } catch {
    // Config not loaded (e.g. test harness) — treat as disabled to avoid spurious file writes.
    return false;
  }
}

function initialSeasonSlug(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `season-${yyyy}-${mm}`;
}

function endOfCurrentMonthUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999);
}

export function createSdkDataLayer(sdk: ClackSdk): TriviaDataLayer {
  // ── Global accessors ────────────────────────────────────────────────────────
  async function loadCategories(): Promise<string[]> {
    return readSdkJson<string[]>(sdk, "categories.json", []);
  }

  async function saveCategories(categories: string[]): Promise<void> {
    await sdk.writeFile("categories.json", JSON.stringify(categories, null, 2));
  }

  async function loadUsers(): Promise<Map<string, TriviaUser>> {
    const record = await readSdkJson<Record<string, TriviaUser>>(sdk, "users.json", {});
    return new Map(Object.entries(record));
  }

  async function saveUser(u: TriviaUser): Promise<void> {
    const users = await loadUsers();
    users.set(u.userId, u);
    const record = Object.fromEntries(users);
    await sdk.writeFile("users.json", JSON.stringify(record, null, 2));
  }

  // ── Per-game scoped accessor ────────────────────────────────────────────────
  function forGame(name: string): ScopedTriviaDataLayer {
    const qPath = `games/${name}/questions.json`;
    const aPath = `games/${name}/answers.json`;
    const cPath = `games/${name}/cheats.json`;
    const sPath = `games/${name}/seasons.json`;

    async function loadQuestions(): Promise<TriviaQuestion[]> {
      return readSdkJson<TriviaQuestion[]>(sdk, qPath, []);
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
      return readSdkJson<SubmittedAnswer[]>(sdk, aPath, []);
    }

    async function saveAnswer(a: SubmittedAnswer): Promise<void> {
      const answers = await loadAnswers();
      answers.push(a);
      await sdk.writeFile(aPath, JSON.stringify(answers, null, 2));
    }

    async function loadCheats(): Promise<CheatReport[]> {
      return readSdkJson<CheatReport[]>(sdk, cPath, []);
    }

    /**
     * Lazy season-bootstrap: when seasons is enabled and this game's seasons.json
     * is missing, seed a starter season (slug `season-YYYY-MM`, categories copied
     * from the global pool) before returning. Subsequent calls find the file and
     * skip the seed.
     */
    async function loadSeasonsState(): Promise<SeasonsState | null> {
      const raw = await sdk.readFile(sPath);
      if (raw !== null) {
        const parsed: SeasonsState = JSON.parse(raw);
        return parsed;
      }
      if (!isSeasonsEnabled()) return null;
      const now = new Date();
      const baseline = await loadCategories();
      const seeded: SeasonsState = {
        seasons: [
          {
            slug: initialSeasonSlug(now),
            startedAt: now.getTime(),
            expectedEndAt: endOfCurrentMonthUtc(now),
            categories: [...baseline],
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

      // Cheat tally is global — `users.json` lives at the trivia root, not under games/.
      const users = await loadUsers();
      const existing = users.get(report.cheaterUserId);
      const next: TriviaUser = existing
        ? { ...existing, cheatAttempts: (existing.cheatAttempts ?? 0) + 1 }
        : {
            userId: report.cheaterUserId,
            displayName: report.cheaterUserId,
            joinedAt: Date.now(),
            cheatAttempts: 1,
          };
      users.set(report.cheaterUserId, next);
      const record = Object.fromEntries(users);
      await sdk.writeFile("users.json", JSON.stringify(record, null, 2));
      return { totalAttempts: next.cheatAttempts ?? 1 };
    }

    return {
      loadQuestions,
      saveQuestion,
      updateQuestion,
      loadAnswers,
      saveAnswer,
      loadCheats,
      saveCheat,
      loadSeasonsState,
      saveSeasonsState,
      getCurrentSeasonSlug,
    };
  }

  return {
    loadCategories,
    saveCategories,
    loadUsers,
    saveUser,
    forGame,
  };
}
