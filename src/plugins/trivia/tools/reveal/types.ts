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
 * different fields — there's no participation data to leak when `"no"`,
 * `"just-correctness"` keeps the named buckets but strips freeform answerText,
 * and `"just-winners"` keeps the named `correct` bucket but reduces the
 * incorrect/no-answer voters to anonymous counts.
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
      revealResponses: "just-winners";
      /**
       * Named winners. Freeform Voters here KEEP their `answerText` (the
       * winning answer is celebratory and about to be revealed); missers are
       * never named, so their typed text never appears.
       */
      correct: Voter[];
      /** Count of scored-wrong voters (bot + cheaters excluded). NO names. */
      incorrectCount: number;
      /** Count of reacted-but-did-not-answer voters (bot + cheaters excluded). NO names. */
      noAnswerCount: number;
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
  /**
   * Attribution for image-medium questions, present iff the question carried `media`.
   * Data-shaped (renderer composes the "📷 Image: …" context line). Deliberately
   * carries ONLY `title`/`attribution`/`license` — never `url` or `subjectId`, which
   * aren't needed for rendering and would widen the leak surface.
   */
  media?: { title: string; attribution?: string; license?: string };
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
  /** Count of revealed questions this player answered correctly. */
  correct: number;
  /** Count of revealed questions this player submitted a scored answer to. */
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
  /**
   * Handle for `update_answers_block`: the shared `batchId` of the processed
   * questions, or the single question's id for legacy/undefined-batchId rows.
   * Present only when `reveals` is non-empty.
   */
  batchId?: string;
  leaderboard: LeaderboardEntry[];
  /**
   * Always present — the per-player round scoreboard, derived from the scored
   * answers independently of any entry's `revealResponses` (which governs only
   * per-question display). `perPlayer` is empty when nobody answered this round.
   */
  roundSummary: RoundSummary;
  seasonStatus?: SeasonStatusOut;
  /**
   * Resolved decision for the All-Time leaderboard surface: the normal-reveal
   * `All Time` row and the season-finale All-Time table. Computed from the
   * `allTimeRow` axis (cascade `game → workspace → "end-of-season-only"`) and
   * `seasonStatus.isLastFireOfSeason`. Present only when `seasonStatus` is
   * present (seasons enabled with a current season). When absent, the renderer
   * treats it as `true` for backward compatibility. The All-Time surface ALSO
   * requires `seasonStatus.hasPriorSeasons` — that gate is applied by the
   * renderer, not folded into this flag.
   */
  showAllTimeRow?: boolean;
  errors?: Array<{ questionId: string; error: string }>;
  /**
   * Resolved value of the replace-cascade `instructions` axis at reveal time.
   * Present iff some tier (slot / season / game / workspace) sets a non-empty
   * value. See the `trivia-prompt-instructions` capability.
   */
  instructions?: string;
  /**
   * Resolved value of the cumulative-cascade `additionalInstructions` axis at
   * reveal time. Present iff at least one tier carries a non-empty value;
   * segments are tier-labeled (`[Workspace]` / `[Game]` / `[Season]` /
   * `[Slot N]`) and joined with `\n\n`.
   */
  additionalInstructions?: string;
}

/** Shape produced by `fetchMessageReactions`; mirrors Slack's `reactions[*]` after normalization. */
export interface SlackReactionLike {
  emoji: string;
  users: string[];
}

export type { RevealResponsesMode };
