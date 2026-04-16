import type { ClackSdk } from "../sdk.js";
import type {
  TriviaQuestion,
  TriviaUser,
  SubmittedAnswer,
  CheatReport,
  TriviaDataLayer,
} from "./types.js";

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
