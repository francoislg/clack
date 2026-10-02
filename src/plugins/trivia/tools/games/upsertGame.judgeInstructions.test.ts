import { describe, it, expect, beforeEach } from "vitest";
import { createUpsertGameTool } from "./upsertGame.js";
import { upsertGameArgs } from "./upsertGame.testHelpers.js";
import { loadTriviaConfig } from "../../core/configBridge.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import { createFakeSdk, primeTriviaConfig, type FakeSdk } from "../../testHelpers.fakeSdk.js";
import type { TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const baseGame: TriviaGame = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 17 * * 1-5",
  timezone: "America/New_York",
  enabled: true,
};

function createTool() {
  return createUpsertGameTool(() => loadTriviaConfig()?.games ?? []);
}

describe("upsert_game — judgeInstructions", () => {
  let sdk: FakeSdk;

  beforeEach(() => {
    sdk = createFakeSdk().sdk;
  });

  it("create persists the trimmed value and reports hasJudgeInstructions", async () => {
    primeTriviaConfig(sdk, { games: [] });
    const result = parseToolResult(
      await createTool().handler(
        upsertGameArgs({
          name: "main",
          channel: "C123",
          questionCron: "0 9 * * 1-5",
          revealCron: "0 17 * * 1-5",
          timezone: "America/New_York",
          judgeInstructions: "  Accept French or English.  ",
        }),
        SESSION,
      ),
    );
    expect(result.action).toBe("created");
    expect(result.hasJudgeInstructions).toBe(true);
    expect(loadTriviaConfig()?.games?.[0]?.judgeInstructions).toBe("Accept French or English.");
  });

  it("update replaces an existing value", async () => {
    primeTriviaConfig(sdk, { games: [{ ...baseGame, judgeInstructions: "Old rule." }] });
    const result = parseToolResult(
      await createTool().handler(
        upsertGameArgs({ name: "main", judgeInstructions: "New rule." }),
        SESSION,
      ),
    );
    expect(result.action).toBe("updated");
    expect(loadTriviaConfig()?.games?.[0]?.judgeInstructions).toBe("New rule.");
  });

  it("update with null clears the tier and leaves additionalInstructions alone", async () => {
    primeTriviaConfig(sdk, {
      games: [
        { ...baseGame, judgeInstructions: "Old rule.", additionalInstructions: "Be concise." },
      ],
    });
    const result = parseToolResult(
      await createTool().handler(
        upsertGameArgs({ name: "main", judgeInstructions: null }),
        SESSION,
      ),
    );
    expect(result.hasJudgeInstructions).toBe(false);
    const game = loadTriviaConfig()?.games?.[0];
    expect(game?.judgeInstructions).toBeUndefined();
    expect(game !== undefined && "judgeInstructions" in game).toBe(false);
    expect(game?.additionalInstructions).toBe("Be concise.");
  });

  it("update with the argument omitted keeps the existing value", async () => {
    primeTriviaConfig(sdk, { games: [{ ...baseGame, judgeInstructions: "Keep me." }] });
    await createTool().handler(upsertGameArgs({ name: "main", enabled: false }), SESSION);
    const game = loadTriviaConfig()?.games?.[0];
    expect(game?.judgeInstructions).toBe("Keep me.");
    expect(game?.enabled).toBe(false);
  });

  it("rejects an empty / whitespace-only string, naming the field, and writes nothing", async () => {
    primeTriviaConfig(sdk, { games: [{ ...baseGame, judgeInstructions: "Keep me." }] });
    const result = parseToolResult(
      await createTool().handler(
        upsertGameArgs({ name: "main", judgeInstructions: "   " }),
        SESSION,
      ),
    );
    expect(result.error).toMatch(/judgeInstructions.*non-empty/);
    expect(loadTriviaConfig()?.games?.[0]?.judgeInstructions).toBe("Keep me.");
  });

  it("accepts judgeInstructions on a game-format slot", async () => {
    primeTriviaConfig(sdk, { games: [{ ...baseGame }] });
    await createTool().handler(
      upsertGameArgs({
        name: "main",
        format: { questions: [{ label: "Q1" }, { judgeInstructions: " Riddle slot rule. " }] },
      }),
      SESSION,
    );
    expect(loadTriviaConfig()?.games?.[0]?.format?.questions[1]?.judgeInstructions).toBe(
      "Riddle slot rule.",
    );
  });
});
