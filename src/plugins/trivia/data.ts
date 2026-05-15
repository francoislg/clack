import type { ClackSdk } from "../sdk.js";
import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  SeasonsState,
  SeasonEntry,
  TriviaDataLayer,
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

export function createSdkDataLayer(sdk: ClackSdk): TriviaDataLayer {
  return {
    async loadCategories(): Promise<string[]> {
      return readSdkJson<string[]>(sdk, "categories.json", []);
    },

    async saveCategories(categories: string[]): Promise<void> {
      await sdk.writeFile("categories.json", JSON.stringify(categories, null, 2));
    },

    async loadQuestions(): Promise<TriviaQuestion[]> {
      return readSdkJson<TriviaQuestion[]>(sdk, "questions.json", []);
    },

    async saveQuestion(q: TriviaQuestion): Promise<void> {
      const questions = await this.loadQuestions();
      questions.push(q);
      await sdk.writeFile("questions.json", JSON.stringify(questions, null, 2));
    },

    async updateQuestion(id: string, updates: Partial<TriviaQuestion>): Promise<void> {
      const questions = await this.loadQuestions();
      const idx = questions.findIndex((q) => q.id === id);
      if (idx === -1) return;
      questions[idx] = { ...questions[idx], ...updates };
      await sdk.writeFile("questions.json", JSON.stringify(questions, null, 2));
    },

    async loadUsers(): Promise<Map<string, TriviaUser>> {
      const record = await readSdkJson<Record<string, TriviaUser>>(sdk, "users.json", {});
      return new Map(Object.entries(record));
    },

    async saveUser(u: TriviaUser): Promise<void> {
      const users = await this.loadUsers();
      users.set(u.userId, u);
      const record = Object.fromEntries(users);
      await sdk.writeFile("users.json", JSON.stringify(record, null, 2));
    },

    async loadAnswers(): Promise<SubmittedAnswer[]> {
      return readSdkJson<SubmittedAnswer[]>(sdk, "answers.json", []);
    },

    async saveAnswer(a: SubmittedAnswer): Promise<void> {
      const answers = await this.loadAnswers();
      answers.push(a);
      await sdk.writeFile("answers.json", JSON.stringify(answers, null, 2));
    },

    async loadCheats(): Promise<CheatReport[]> {
      return readSdkJson<CheatReport[]>(sdk, "cheats.json", []);
    },

    async loadSeasonsState(): Promise<SeasonsState | null> {
      return readSdkJson<SeasonsState | null>(sdk, "seasons.json", null);
    },

    async saveSeasonsState(state: SeasonsState): Promise<void> {
      await sdk.writeFile("seasons.json", JSON.stringify(state, null, 2));
    },

    async getCurrentSeasonSlug(): Promise<string | null> {
      const state = await this.loadSeasonsState();
      return findCurrentSeason(state, Date.now())?.slug ?? null;
    },

    async saveCheat(report: CheatReport): Promise<{ totalAttempts: number }> {
      const cheats = await this.loadCheats();
      cheats.push(report);
      await sdk.writeFile("cheats.json", JSON.stringify(cheats, null, 2));

      const users = await this.loadUsers();
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
    },
  };
}
