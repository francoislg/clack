import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ClackSdk } from "../sdk.js";
import type { TriviaQuestion, TriviaUser, SubmittedAnswer, TriviaDataLayer } from "./types.js";

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonString(path: string, json: string): Promise<void> {
  await writeFile(path, json, "utf-8");
}

export function createFileDataLayer(dataDir: string): TriviaDataLayer {
  const categoriesPath = join(dataDir, "categories.json");
  const questionsPath = join(dataDir, "questions.json");
  const usersPath = join(dataDir, "users.json");
  const answersPath = join(dataDir, "answers.json");

  return {
    async loadCategories(): Promise<string[]> {
      return readJsonFile<string[]>(categoriesPath, []);
    },

    async saveCategories(categories: string[]): Promise<void> {
      await ensureDir(dataDir);
      await writeJsonString(categoriesPath, JSON.stringify(categories, null, 2));
    },

    async loadQuestions(): Promise<TriviaQuestion[]> {
      return readJsonFile<TriviaQuestion[]>(questionsPath, []);
    },

    async saveQuestion(q: TriviaQuestion): Promise<void> {
      await ensureDir(dataDir);
      const questions = await this.loadQuestions();
      questions.push(q);
      await writeJsonString(questionsPath, JSON.stringify(questions, null, 2));
    },

    async updateQuestion(id: string, updates: Partial<TriviaQuestion>): Promise<void> {
      await ensureDir(dataDir);
      const questions = await this.loadQuestions();
      const idx = questions.findIndex((q) => q.id === id);
      if (idx === -1) return;
      questions[idx] = { ...questions[idx], ...updates };
      await writeJsonString(questionsPath, JSON.stringify(questions, null, 2));
    },

    async saveUser(u: TriviaUser): Promise<void> {
      await ensureDir(dataDir);
      const users = await this.loadUsers();
      users.set(u.userId, u);
      const record = Object.fromEntries(users);
      await writeJsonString(usersPath, JSON.stringify(record, null, 2));
    },

    async loadUsers(): Promise<Map<string, TriviaUser>> {
      const record = await readJsonFile<Record<string, TriviaUser>>(usersPath, {});
      return new Map(Object.entries(record));
    },

    async loadAnswers(): Promise<SubmittedAnswer[]> {
      return readJsonFile<SubmittedAnswer[]>(answersPath, []);
    },

    async saveAnswer(a: SubmittedAnswer): Promise<void> {
      await ensureDir(dataDir);
      const answers = await this.loadAnswers();
      answers.push(a);
      await writeJsonString(answersPath, JSON.stringify(answers, null, 2));
    },
  };
}

// ============================================================================
// SDK-based data layer (uses ClackSdk for scoped file I/O)
// ============================================================================

function readSdkJson<T>(sdk: ClackSdk, path: string, fallback: T): Promise<T> {
  return sdk.readFile(path).then((raw) => {
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  });
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
  };
}

// ============================================================================
// In-memory data layer (for tests)
// ============================================================================

export function createInMemoryDataLayer(): TriviaDataLayer {
  let categories: string[] = [];
  const questions: TriviaQuestion[] = [];
  const users = new Map<string, TriviaUser>();
  const answers: SubmittedAnswer[] = [];

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
  };
}
