import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import type { SeasonEntry } from "../core/types.js";

/**
 * Pull a per-tier `instructions` or `additionalInstructions` value, trimmed.
 * Empty / whitespace-only strings are treated as absent (returns `undefined`)
 * — matches the resolver's "non-empty post-trim is the only signal" rule.
 */
function nonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Pure resolver for the replace-cascade `instructions` axis. Returns the first
 * non-empty trimmed value walking `slot → season → game → workspace`. Returns
 * `null` when every tier is empty or absent.
 *
 * See the `trivia-prompt-instructions` capability for the contract.
 */
export function resolveInstructions(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
): string | null {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    const v = nonEmpty(slot?.instructions);
    if (v !== undefined) return v;
  }
  const season = nonEmpty(currentSeason?.instructions);
  if (season !== undefined) return season;
  const gameValue = nonEmpty(game?.instructions);
  if (gameValue !== undefined) return gameValue;
  const workspace = nonEmpty(triviaConfig?.instructions);
  if (workspace !== undefined) return workspace;
  return null;
}

/**
 * Pure resolver for the cumulative-cascade `additionalInstructions` axis. Walks
 * `workspace → game → season → slot` (broadest first); each non-empty trimmed
 * value contributes one segment prefixed with its tier label. Segments are
 * joined with `\n\n`. Returns `null` when every tier is empty or absent.
 *
 * Slot label uses the numeric index (`[Slot N]`) regardless of the slot's
 * optional `label` display string — see the `trivia-prompt-instructions`
 * capability for the rationale.
 */
export function resolveAdditionalInstructions(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
): string | null {
  const segments: string[] = [];

  const workspace = nonEmpty(triviaConfig?.additionalInstructions);
  if (workspace !== undefined) segments.push(`[Workspace] ${workspace}`);

  const gameValue = nonEmpty(game?.additionalInstructions);
  if (gameValue !== undefined) segments.push(`[Game] ${gameValue}`);

  const season = nonEmpty(currentSeason?.additionalInstructions);
  if (season !== undefined) segments.push(`[Season] ${season}`);

  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    const v = nonEmpty(slot?.additionalInstructions);
    if (v !== undefined) segments.push(`[Slot ${slotIndex}] ${v}`);
  }

  if (segments.length === 0) return null;
  return segments.join("\n\n");
}
