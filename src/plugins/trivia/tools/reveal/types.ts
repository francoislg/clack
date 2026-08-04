import type { RevealAnswerDescriptor } from "../../answerTypes/types.js";
import type { LeaderboardEntry } from "../../domain/computeLeaderboard.js";
import type {
  RevealResponsesMode,
  TeamsScoringMode,
  TriviaFinalRevealSummary,
  TriviaIncludeRevealInQuestions,
} from "../../core/configTypes.js";

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

/** One team's entry in a team-grouped voter bucket. */
export interface TeamBucketEntry {
  /** Team name — rendered as plain text, never a Slack mention. */
  team: string;
  /**
   * Unattributed member answer texts (freeform questions under
   * `revealResponses: "yes"` only) — the texts the team's members typed, with
   * no mapping back to which member typed which.
   */
  answerTexts?: string[];
}

/**
 * Team-grouped projection of an entry's `voters`, present only when teams mode
 * is ON. A team buckets by TEAM verdict — Correct: ≥1 member correct;
 * Incorrect: members answered but none correct; NoAnswer: no member answered
 * but ≥1 member reacted (mirroring the individual noAnswer semantics, so a
 * fully-absent team lands in no bucket). Members are absorbed into the team
 * name and never listed. Free agents remain individual `Voter`s.
 *
 * Mirrors the `revealResponses` variants of `voters`: under `"yes"` /
 * `"just-correctness"` all six fields are present; under `"just-winners"` only
 * the two correct fields (missers stay anonymous counts on `voters`); under
 * `"no"` the whole field is absent.
 */
export interface TeamVoterBuckets {
  correctTeams: TeamBucketEntry[];
  correctFreeAgents: Voter[];
  incorrectTeams?: TeamBucketEntry[];
  incorrectFreeAgents?: Voter[];
  noAnswerTeams?: string[];
  noAnswerFreeAgents?: Voter[];
}

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
  /**
   * What this question paid, present iff its stamped `points` exceeds 1 — so the
   * reveal narrative can call out the stakes. Absent means the ordinary 1 point.
   */
  points?: number;
  /**
   * Team-grouped projection of `voters`, present only when the game's effective
   * teams mode is ON (and `revealResponses` isn't `"no"`). Renderers name teams
   * instead of members; free agents stay individual. See `TeamVoterBuckets`.
   */
  teamVoters?: TeamVoterBuckets;
}

/** One team's row in the teams-mode standings payload. */
export interface TeamStandingEntry {
  name: string;
  /** Points this reveal's batch earned the team, through the resolved strategy. */
  thisRound: number;
  currentSeason: number;
  /**
   * All-time points, present ONLY when the team name (case-insensitive) matches
   * ≥1 prior season's stamped roster — absent means the All Time cell renders empty.
   */
  allTime?: number;
}

/** One free agent's (player in no team) row in the teams-mode standings payload. */
export interface FreeAgentStandingEntry {
  userId: string;
  displayName: string;
  thisRound: number;
  currentSeason: number;
  allTime: number;
}

/**
 * Teams-mode standings block, present on `ProcessRevealResult` only when the
 * game's effective teams mode is ON. Carries everything the standings table
 * needs: team rows (season points desc), free-agent rows, the resolved scoring
 * mode, and the finale signal.
 */
export interface TeamStandingsOut {
  scoring: TeamsScoringMode;
  teams: TeamStandingEntry[];
  freeAgents: FreeAgentStandingEntry[];
  /**
   * Present (true) on the season's last fire when effective
   * `teamsFinaleIndividuals` is on — directs the renderer to append the classic
   * individual leaderboard table below the team standings.
   */
  finaleIndividuals?: true;
}

export interface PerfectRoundsChampion {
  /** Every player tied at the maximum perfect-round count. */
  userIds: string[];
  /** The maximum perfect-round count (≥ 1 when this field is present). */
  count: number;
}

export interface SeasonStatusOut {
  currentSlug: string;
  isLastFireOfSeason: boolean;
  seasonClosed: boolean;
  newSeasonStarted?: { slug: string; expectedEndAt: number };
  /** Picked by `currentSeasonPoints`; `currentSeasonCorrect` rides along for context. */
  mvp?: {
    userId: string;
    displayName: string;
    currentSeasonCorrect: number;
    currentSeasonPoints: number;
  };
  /**
   * True iff any persisted answer belongs to a season other than `currentSlug`.
   * When false, "All Time" totals equal "Current Season" totals — the renderer
   * should drop the redundant All Time row from the leaderboard table.
   */
  hasPriorSeasons: boolean;
  /**
   * Perfect rounds champion(s) — present only at the season finale when the knob
   * is enabled AND at least one player earned a perfect round. Individual honor
   * (team rows excluded).
   */
  perfectRoundsChampion?: PerfectRoundsChampion;
}

export interface RoundSummaryEntry {
  userId: string;
  displayName: string;
  /** Count of revealed questions this player answered correctly. */
  correct: number;
  /** Count of revealed questions this player submitted a scored answer to. */
  answered: number;
  /**
   * Points earned this fire — each correct question pays its stamped `points`
   * (absent = 1), so this equals `correct` when every revealed question is worth 1.
   */
  points: number;
  /** Present iff this player is tied for the highest `points` total (and that total is > 0). */
  roundMvp?: true;
  /** Present iff the fire had >= 3 questions AND this player answered every one correctly. */
  perfectRound?: true;
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
   * Always present — the per-player round scoreboard, derived from the scored
   * answers independently of any entry's `revealResponses` (which governs only
   * per-question display). `perPlayer` is empty when nobody answered this round.
   */
  roundSummary: RoundSummary;
  /**
   * Resolved `includeRevealInQuestions` axis (cascade `game → workspace → "no"`)
   * at reveal time. Always present. `"yes"` tells the reveal prompt to author
   * per-card narrative via `set_reveal_narrative` before `refresh_question_cards`
   * projects the cards; `"no"` keeps cards facts-only (narrative in the summary).
   */
  includeRevealInQuestions: TriviaIncludeRevealInQuestions;
  /**
   * Resolved `finalRevealSummary` axis (cascade `game → workspace → "yes"`) at
   * reveal time. Always present. Governs ONLY the verdict/WHY/voter narrative's
   * placement — the leaderboard `table` always posts top-level. `"yes"` →
   * narrative top-level; `"no"` → narrative omitted; `"in-thread"` → narrative
   * via `submit_response`'s `thread_replies` with a top-level pointer.
   */
  finalRevealSummary: TriviaFinalRevealSummary;
  /**
   * Resolved `tagPlayers` knob (cascade `game → workspace → true`). When `true`
   * (default) the reveal post names players with pinging `<@USERID>` mentions;
   * when `false` it MUST name them as plain-text `@displayName` so the post
   * pings no one. Always present. See `resolveTagPlayers`.
   */
  tagPlayers: boolean;
  seasonStatus?: SeasonStatusOut;
  /**
   * Seasonless wind-down eligibility — the seasonless analog of
   * `seasonStatus.isLastFireOfSeason`. Present (always `{ eligible: true }`)
   * ONLY when the game has no active season AND no queued season AND carries
   * `disableAfterRound: true` AND this reveal left zero posted-but-unrevealed
   * questions. REPORT-ONLY: the renderer reacts by calling `end_season`, which
   * performs the wind-down. Absent whenever a season is active.
   */
  windDown?: { eligible: true };
  /**
   * Teams-mode standings, present ONLY when the game's effective teams mode is
   * ON — the teams-off payload is byte-identical to pre-teams behavior. See
   * `TeamStandingsOut`.
   */
  teamStandings?: TeamStandingsOut;
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
  /**
   * Questions in the reveal batch that were INVALIDATED (`settle_question` with
   * `invalidate`). Present only when non-empty. Worth 0 points, never scored; the
   * reveal prompt renders each as an "invalidated" line (with its reason) and
   * `refresh_question_cards` repaints the card as invalidated.
   */
  invalidatedQuestions?: Array<{
    questionId: string;
    statement: string;
    category: string;
    emojis: string[];
    invalidatedReason?: string;
  }>;
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
