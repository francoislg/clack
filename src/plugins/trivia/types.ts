export interface TriviaQuestion {
  id: string;
  category: string;
  statement: string;
  isTrue: boolean;
  emojis: string[];
  createdAt: number;
  postedAt?: number;
  messageLink?: string;
  season?: string;
}

// `cheatAttempts` is cumulative across seasons — season rollover does not reset it.
export interface TriviaUser {
  userId: string;
  displayName: string;
  joinedAt: number;
  cheatAttempts?: number;
}

export interface SubmittedAnswer {
  userId: string;
  questionId: string;
  answer: boolean;
  correct: boolean;
  timestamp: number;
  season?: string;
}

export interface CheatReport {
  cheaterUserId: string;
  questionId: string;
  reason: string;
  evidence?: string;
  detectedAt: string;
  season?: string;
}

export interface TriviaSeasonsConfig {
  enabled: boolean;
  prompt: string;
}

export interface SeasonEntry {
  slug: string;
  startedAt: number;
  expectedEndAt: number;
  endedAt?: number;
  categories: string[];
}

export interface SeasonsState {
  seasons: SeasonEntry[];
}

export interface TriviaDataLayer {
  loadCategories(): Promise<string[]>;
  saveCategories(categories: string[]): Promise<void>;
  loadQuestions(): Promise<TriviaQuestion[]>;
  saveQuestion(q: TriviaQuestion): Promise<void>;
  updateQuestion(id: string, updates: Partial<TriviaQuestion>): Promise<void>;
  loadUsers(): Promise<Map<string, TriviaUser>>;
  saveUser(u: TriviaUser): Promise<void>;
  loadAnswers(): Promise<SubmittedAnswer[]>;
  saveAnswer(a: SubmittedAnswer): Promise<void>;
  loadCheats(): Promise<CheatReport[]>;
  saveCheat(report: CheatReport): Promise<{ totalAttempts: number }>;
  loadSeasonsState(): Promise<SeasonsState | null>;
  saveSeasonsState(state: SeasonsState): Promise<void>;
  getCurrentSeasonSlug(): Promise<string | null>;
}
