import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import {
  loadTriviaConfig,
  saveTriviaConfig,
  defaultGetGames,
  type GetGamesFn,
} from "../../core/configBridge.js";
import type { TriviaConfig } from "../../core/configTypes.js";

export function createDeleteGameTool(getGamesFn: GetGamesFn = defaultGetGames) {
  return tool(
    "delete_game",
    "Remove a trivia game from data/plugins/trivia/config.json. The plugin reconciles cron jobs on the next load — the question/reveal jobs for this game disappear. The per-game data directory at data/plugins/trivia/games/<name>/ is NOT deleted (preserved for archival); operators clear it manually when ready. Returns an error if the named game doesn't exist.",
    {
      name: z.string().describe("Game identifier to remove. Must exist in the registry."),
    },
    async (args) => {
      const games = [...getGamesFn()];
      const idx = games.findIndex((g) => g.name === args.name);
      if (idx === -1) {
        return errorResult(`Unknown game "${args.name}". Call list_games to see registered games.`);
      }

      games.splice(idx, 1);
      const currentConfig: TriviaConfig = loadTriviaConfig() ?? {};
      const nextConfig: TriviaConfig = { ...currentConfig, games };
      await saveTriviaConfig(nextConfig);

      return textResult({ name: args.name, action: "deleted" });
    },
  );
}
