import type { ClackSdk } from "../../sdk.js";
import { getConfig } from "../../../config.js";
import { findCurrentSeason } from "./seasonTimeline.js";
import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  SeasonsState,
  TriviaDataLayer,
  ScopedTriviaDataLayer,
} from "./types.js";

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

    async function deleteAnswersForQuestion(questionId: string): Promise<number> {
      const answers = await loadAnswers();
      const before = answers.length;
      const kept = answers.filter((a) => a.questionId !== questionId);
      if (kept.length === before) return 0;
      await sdk.writeFile(aPath, JSON.stringify(kept, null, 2));
      return before - kept.length;
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
      deleteAnswersForQuestion,
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
