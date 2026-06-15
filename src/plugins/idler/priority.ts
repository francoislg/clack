/** The kinds of pending work, in descending base weight. */
export type WorkKind = "continue" | "triage" | "implement" | "review" | "none";

export interface PrioritySignals {
  kind: WorkKind;
  /** A human reply or new comment past the cursor arrived — raises priority. */
  freshInput?: boolean;
  /** Waiting on a human with no new activity — sinks below all workable units. */
  blocked?: boolean;
}

const KIND_WEIGHT: Record<WorkKind, number> = {
  continue: 400,
  triage: 300,
  implement: 200,
  review: 100,
  none: 0,
};

const FRESH_INPUT_BUMP = 50;
/** Large enough to push a blocked unit below any workable one regardless of kind. */
const BLOCKED_SINK = 1000;

/**
 * Deterministic priority from work signals. The sync/work tools provide the signals (derived by
 * reading references); this turns them into a stable score so ranking never depends on LLM whim.
 */
export function computePriority(signals: PrioritySignals): number {
  let score = KIND_WEIGHT[signals.kind];
  if (signals.freshInput) score += FRESH_INPUT_BUMP;
  if (signals.blocked) score -= BLOCKED_SINK;
  return score;
}
