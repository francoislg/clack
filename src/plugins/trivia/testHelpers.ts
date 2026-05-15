import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  SeasonsState,
  TriviaDataLayer,
} from "./types.js";
import { findCurrentSeason } from "./data.js";

/** In-memory implementation of TriviaDataLayer, for unit tests. */
export function createInMemoryDataLayer(): TriviaDataLayer {
  let categories: string[] = [];
  const questions: TriviaQuestion[] = [];
  const users = new Map<string, TriviaUser>();
  const answers: SubmittedAnswer[] = [];
  const cheats: CheatReport[] = [];
  let seasonsState: SeasonsState | null = null;

  return {
    async loadCategories() {
      return [...categories];
    },
    async saveCategories(c) {
      categories = [...c];
    },
    async loadQuestions() {
      return [...questions];
    },
    async saveQuestion(q) {
      questions.push(q);
    },
    async updateQuestion(id, updates) {
      const idx = questions.findIndex((q) => q.id === id);
      if (idx === -1) return;
      questions[idx] = { ...questions[idx], ...updates };
    },
    async loadUsers() {
      return new Map(users);
    },
    async saveUser(u) {
      users.set(u.userId, u);
    },
    async loadAnswers() {
      return [...answers];
    },
    async saveAnswer(a) {
      answers.push(a);
    },
    async loadCheats() {
      return [...cheats];
    },
    async saveCheat(report) {
      cheats.push(report);
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
      return { totalAttempts: next.cheatAttempts ?? 1 };
    },
    async loadSeasonsState() {
      return seasonsState === null ? null : structuredClone(seasonsState);
    },
    async saveSeasonsState(state) {
      seasonsState = structuredClone(state);
    },
    async getCurrentSeasonSlug() {
      return findCurrentSeason(seasonsState, Date.now())?.slug ?? null;
    },
  };
}
