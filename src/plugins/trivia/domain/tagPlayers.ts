import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_TAG_PLAYERS } from "../core/configTypes.js";

/**
 * Pure resolver for the `tagPlayers` knob. Cascade:
 *   `game.tagPlayers → workspace.tagPlayers → true`.
 *
 * No season or slot tier (like `allTimeRow`). The first tier that supplies a
 * value wins; when no tier supplies one, returns the built-in default `true`
 * (preserve legacy pinging behavior).
 */
export function resolveTagPlayers(
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): boolean {
  if (game?.tagPlayers !== undefined) return game.tagPlayers;
  if (workspace?.tagPlayers !== undefined) return workspace.tagPlayers;
  return DEFAULT_TAG_PLAYERS;
}

/**
 * Render a single player reference for a deterministic Slack block. When
 * `tagPlayers` is true, emit the real `<@USERID>` mention (pings); when false,
 * emit plain-text `@displayName` (no ping). Used by the live roster and the
 * reveal footer; the Claude-authored reveal post applies the same rule via the
 * MENTION POLICY prompt directive.
 */
export function renderPlayerRef(userId: string, displayName: string, tagPlayers: boolean): string {
  return tagPlayers ? `<@${userId}>` : `@${displayName}`;
}
