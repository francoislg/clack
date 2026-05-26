import type { RevealAnswerDescriptor } from "../../answerTypes/types.js";
import type { LeaderboardEntry } from "../../domain/computeLeaderboard.js";
import type { RevealResponsesMode } from "../../core/configTypes.js";

export interface Voter {
  userId: string;
  displayName: string;
  /**
   * Set for freeform reveal entries when the question's `revealResponses` is
   * `"yes"` — the user's typed answer text, quoted in the rendered verdict.
   * Stripped from the payload when `revealResponses === "just-correctness"`
   * (typed text stays anonymous) and absent for boolean/choice voter entries.
   */
  answerText?: string;
}

export interface ReactorEntry {
  userId: string;
  displayName: string;
  /** Every emoji name this reactor used on the question message (no duplicates). */
  emojis: string[];
}

/**
 * Discriminated union on the question's stamped `revealResponses`. The shape
 * varies because the renderer's per-mode rendering branches need physically
 * different fields — there's no participation data to leak when `"no"`, and
 * `"just-correctness"` keeps the named buckets but strips freeform answerText.
 */
export type VoterBuckets =
  | {
      revealResponses: "yes";
      correct: Voter[];
      incorrect: Voter[];
      /** Reacted but did NOT submit a button answer. */
      noAnswer: Voter[];
      /** Every reactor's full emoji set (bot + cheaters stripped). */
      reactions: ReactorEntry[];
    }
  | {
      revealResponses: "just-correctness";
      /** Freeform Voters in `correct`/`incorrect` have NO `answerText`. */
      correct: Voter[];
      incorrect: Voter[];
      noAnswer: Voter[];
      reactions: ReactorEntry[];
    }
  | {
      revealResponses: "no";
      reactions: ReactorEntry[];
    };

export interface ProcessRevealEntry {
  questionId: string;
  statement: string;
  category: string;
  emojis: string[];
  messageLink: string;
  wasReprocessed: boolean;
  answer: RevealAnswerDescriptor;
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
  /**
   * Omitted when ANY reveal entry in the batch has `revealResponses !== "yes"`.
   * The aggregate per-player counts would leak across slots in the restricted
   * modes, so the whole field is dropped instead of selectively masked.
   */
  roundSummary?: RoundSummary;
  seasonStatus?: SeasonStatusOut;
  errors?: Array<{ questionId: string; error: string }>;
}

/** Shape produced by `fetchMessageReactions`; mirrors Slack's `reactions[*]` after normalization. */
export interface SlackReactionLike {
  emoji: string;
  users: string[];
}

export type { RevealResponsesMode };
