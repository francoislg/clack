import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { resolveEffectiveFormat } from "../../domain/format.js";
import { AXIS_KEYS, resolveCascade } from "../../domain/resolveCascade.js";
import { buildCascadeContext } from "../../domain/cascadeContext.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, TriviaAnswersFormat } from "../../core/types.js";
import type { TriviaGame } from "../../core/configTypes.js";
import type { CascadeAxes, CascadeContext, CascadeResolution } from "../../core/cascadeAxes.js";

/** A single resolution (value + winning tier + per-tier ladder) for any axis. */
type AxisResolution = CascadeResolution<keyof CascadeAxes>;
/** answersFormat-keyed axes (difficulty/difficultyRatio) render one resolution per format. */
interface ByAnswersFormat {
  byAnswersFormat: { boolean: AxisResolution; choice: AxisResolution; freeform: AxisResolution };
}
type AxisExplain = AxisResolution | ByAnswersFormat;
interface CoordinateExplain {
  slot: number | null;
  axes: { [axis: string]: AxisExplain };
}

/** The answersFormat-keyed custom axes, rendered per-format unless one is supplied. */
const FORMAT_KEYED = new Set<keyof CascadeAxes>(["difficulty", "difficultyRatio"]);

const DESCRIPTION = `Explain the cascade resolution for a specific (game, slot) coordinate: for every cascading axis, the FINAL resolved value, the winning TIER, and the per-tier ladder. This is the audit counterpart to \`get_ideas\` — it shows what WILL resolve and WHERE, without rolling.

Arguments:
- \`game\` (required): a game name in config.trivia.games[].
- \`slot\` (optional): slot index within the effective format. Omit to explain every slot when a format is present, or the single-question coordinate when there is no format.
- \`answersFormat\` (optional): \`"boolean" | "choice" | "freeform"\`. The \`difficulty\` and \`difficultyRatio\` axes resolve per answersFormat; supply one to focus, or omit to see all three.

For each coordinate the response carries an \`axes\` map keyed by axis name. A normal axis entry is \`{ value, tier, ladder }\` where \`tier\` is one of \`slot|season|game|workspace|default|merged\` and \`ladder\` lists each concrete tier's raw contribution. The answersFormat-keyed axes carry \`{ byAnswersFormat: { boolean, choice, freeform } }\` instead (or a single \`{ value, tier, ladder }\` when \`answersFormat\` is supplied).

Resolution is identical to what \`get_ideas\` (generation axes) and \`post_questions\` (\`liveAnswersVisible\`/\`revealResponses\`) actually use — all three build the slot tier via the same \`buildCascadeContext\` helper and call the same resolver, so this audit cannot drift from runtime behavior. Per-slot axis overrides are read from the EFFECTIVE format (\`season.format ?? game.format\`): a game-format slot's overrides apply when no season format is active; an active season's format replaces the game's wholesale.`;

/** Resolve every axis for one coordinate. */
function explainCoordinate(
  ctx: CascadeContext,
  answersFormat: TriviaAnswersFormat | undefined,
): { [axis: string]: AxisExplain } {
  const axes: { [axis: string]: AxisExplain } = {};
  for (const key of AXIS_KEYS) {
    if (FORMAT_KEYED.has(key) && answersFormat === undefined) {
      axes[key] = {
        byAnswersFormat: {
          boolean: resolveCascade(key, ctx, { answersFormat: "boolean" }),
          choice: resolveCascade(key, ctx, { answersFormat: "choice" }),
          freeform: resolveCascade(key, ctx, { answersFormat: "freeform" }),
        },
      };
    } else {
      axes[key] = resolveCascade(key, ctx, { answersFormat });
    }
  }
  return axes;
}

export function createExplainCascadeTool(
  data: TriviaDataLayer,
  getConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "explain_cascade",
    DESCRIPTION,
    {
      game: z.string().describe("Game name (must be present in config.trivia.games[])."),
      slot: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Slot index within the effective format. Omit to explain every slot (format present) or the single-question coordinate (no format).",
        ),
      answersFormat: z
        .enum(["boolean", "choice", "freeform"])
        .optional()
        .describe("Focus the answersFormat-keyed axes (difficulty/difficultyRatio) on one format."),
    },
    async (args) => {
      let gameEntry: TriviaGame;
      try {
        gameEntry = requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const config = getConfigFn();
      const now = Date.now();
      const seasonsState = await scoped.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, now);
      const effectiveFormat = resolveEffectiveFormat(currentSeasonEntry, gameEntry);
      const answersFormat = args.answersFormat;

      const buildContext = (slotIndex: number | null): CascadeContext =>
        buildCascadeContext(currentSeasonEntry, gameEntry, slotIndex, config);

      // Slot supplied → validate range and explain that one coordinate.
      if (args.slot !== undefined) {
        if (effectiveFormat === null) {
          return errorResult(
            "no active format — `slot` must be omitted for the single-question flow.",
          );
        }
        if (args.slot < 0 || args.slot >= effectiveFormat.questions.length) {
          const tier =
            currentSeasonEntry?.format !== undefined
              ? `active season "${currentSeasonEntry.slug}"`
              : `game "${gameEntry.name}"`;
          return errorResult(
            `slot index ${args.slot} out of range — ${tier} has ${effectiveFormat.questions.length} slot(s).`,
          );
        }
      }

      // No slot → every slot when a format is present, else the single coordinate.
      let coordinates: CoordinateExplain[];
      if (args.slot !== undefined) {
        coordinates = [
          { slot: args.slot, axes: explainCoordinate(buildContext(args.slot), answersFormat) },
        ];
      } else if (effectiveFormat !== null) {
        coordinates = effectiveFormat.questions.map((_, i) => ({
          slot: i,
          axes: explainCoordinate(buildContext(i), answersFormat),
        }));
      } else {
        coordinates = [{ slot: null, axes: explainCoordinate(buildContext(null), answersFormat) }];
      }

      return textResult({
        game: gameEntry.name,
        seasonsEnabled: config?.seasons?.enabled ?? false,
        activeSeason: currentSeasonEntry?.slug ?? null,
        coordinates,
      });
    },
  );
}
