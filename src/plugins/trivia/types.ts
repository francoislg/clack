export interface TriviaQuestion {
  id: string;
  category: string;
  statement: string;
  isTrue: boolean;
  emojis: string[];
  createdAt: number;
  postedAt?: number;
  messageLink?: string;
}

export interface TriviaUser {
  userId: string;
  displayName: string;
  joinedAt: number;
}

export interface SubmittedAnswer {
  userId: string;
  questionId: string;
  answer: boolean;
  correct: boolean;
  timestamp: number;
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
}
