export interface TriviaQuestion {
  id: string;
  topic: string;
  statement: string;
  isTrue: boolean;
  emojis: string[];
  createdAt: number;
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
  loadQuestions(): Promise<TriviaQuestion[]>;
  saveQuestion(q: TriviaQuestion): Promise<void>;
  loadUsers(): Promise<Map<string, TriviaUser>>;
  saveUser(u: TriviaUser): Promise<void>;
  loadAnswers(): Promise<SubmittedAnswer[]>;
  saveAnswer(a: SubmittedAnswer): Promise<void>;
}
