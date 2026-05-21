import type { LeaderboardEntry } from "../../domain/computeLeaderboard.js";

export interface Voter {
  userId: string;
  displayName: string;
  /**
   * Set for freeform reveal entries — the user's typed answer text, quoted in
   * the rendered verdict. Absent for boolean/choice voter entries.
   */
  answerText?: string;
}

export interface WildcardVoter extends Voter {
  emoji: string;
}

export interface VoterBuckets {
  correct: Voter[];
  incorrect: Voter[];
  /** Always `[]` for choice and freeform questions (the bucket only applies to boolean). */
  fenceSitters: Voter[];
  wildcards: WildcardVoter[];
}

export type RevealAnswer =
  | { type: "boolean"; isTrue: boolean }
  | { type: "choice"; choices: string[]; correctIndex: number }
  | {
      type: "freeform";
      expectedAnswer: string;
      acceptableAnswers?: string[];
      gradingNotes?: string;
    };

export interface ProcessRevealEntry {
  questionId: string;
  statement: string;
  category: string;
  emojis: string[];
  messageLink: string;
  wasReprocessed: boolean;
  answer: RevealAnswer;
  voters: VoterBuckets;
}

export interface SeasonStatusOut {
  currentSlug: string;
  isLastFireOfSeason: boolean;
  seasonClosed: boolean;
  newSeasonStarted?: { slug: string; expectedEndAt: number };
  mvp?: { userId: string; displayName: string; currentSeasonCorrect: number };
  /**
   * True iff any persisted answer belongs to a season other than `currentSlug`.
   * When false, "All Time" totals equal "Current Season" totals — the renderer
   * should drop the redundant All Time row from the leaderboard table.
   */
  hasPriorSeasons: boolean;
}

export interface RoundSummaryEntry {
  userId: string;
  displayName: string;
  /** Count of reveals where this player appears in voters.correct. */
  correct: number;
  /** Count of reveals where this player appears in ANY voter bucket. */
  answered: number;
  /** Present iff this player is tied for the highest `correct` count (and that count is > 0). */
  roundMvp?: true;
}

export interface RoundSummary {
  totalQuestions: number;
  perPlayer: RoundSummaryEntry[];
}

export interface ProcessRevealResult {
  game: string;
  reveals: ProcessRevealEntry[];
  leaderboard: LeaderboardEntry[];
  roundSummary: RoundSummary;
  seasonStatus?: SeasonStatusOut;
  errors?: Array<{ questionId: string; error: string }>;
}

/** Shape produced by `fetchMessageReactions`; mirrors Slack's `reactions[*]` after normalization. */
export interface SlackReactionLike {
  emoji: string;
  users: string[];
}
