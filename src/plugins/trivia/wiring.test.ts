import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { triviaPlugin } from "./index.js";
import { _resetTriviaConfigBridge } from "./core/configBridge.js";
import { createFakeSdk, type FakeSdk, type FakeMcpServer } from "./testHelpers.fakeSdk.js";
import type { TriviaConfig } from "./core/configTypes.js";

const SEASONS_ON: TriviaConfig = { games: [], seasons: { enabled: true, prompt: "p" } };

async function bootTrivia(config: TriviaConfig | null = { games: [] }): Promise<FakeSdk> {
  const { sdk, testHelpers } = createFakeSdk();
  if (config !== null) {
    testHelpers.files.set("config.json", JSON.stringify(config));
  }
  await triviaPlugin(sdk);
  return sdk;
}

function managementHandle(sdk: FakeSdk): FakeMcpServer {
  return sdk.registerMcpServer("management", { autoload: false, description: "" });
}

function toolNames(handle: FakeMcpServer): string[] {
  return handle.registerTool.mock.calls.map((call) => call[1].name);
}

/** The trailing "Tools: a, b, c." list of an integration-catalog description. */
function advertisedTools(description: string): string[] {
  const match = description.match(/Tools: ([^.]+)\./);
  return match === null ? [] : match[1].split(",").map((name) => name.trim());
}

describe("trivia plugin wiring", () => {
  beforeEach(() => _resetTriviaConfigBridge());
  afterEach(() => _resetTriviaConfigBridge());

  it("registers config-mutation tools on trivia:management and runtime tools on the default server", async () => {
    const sdk = await bootTrivia(SEASONS_ON);
    const management = toolNames(managementHandle(sdk));
    const runtime = toolNames(sdk.mcpServer);

    expect(management.sort()).toEqual(
      [
        "add_categories",
        "remove_categories",
        "upsert_game",
        "delete_game",
        "unlock_questions",
        "set_workspace_config",
        "upsert_season",
        "delete_season",
      ].sort(),
    );
    for (const name of [
      "get_ideas",
      "save_question",
      "post_questions",
      "compute_answers",
      "lock_questions",
      "find_previous_questions",
      "retrieve_scores",
      "list_games",
      "list_seasons",
      "check_season_status",
      "start_new_season",
      "save_cheating",
    ]) {
      expect(runtime, `${name} should be on the default trivia server`).toContain(name);
    }
    expect(runtime).not.toContain("upsert_season");
    expect(runtime).not.toContain("unlock_questions");
  });

  it("registers every management tool admin-only, and member read tools as member", async () => {
    const sdk = await bootTrivia(SEASONS_ON);
    for (const call of managementHandle(sdk).registerTool.mock.calls) {
      expect(call[0], `${call[1].name} should be admin-gated`).toBe("admin");
    }

    const runtimeRoleByName = new Map(
      sdk.mcpServer.registerTool.mock.calls.map((call) => [call[1].name, call[0]]),
    );
    for (const name of ["find_previous_questions", "retrieve_scores", "list_games"]) {
      expect(runtimeRoleByName.get(name), `${name} should be member-accessible`).toBe("member");
    }
    expect(runtimeRoleByName.get("get_ideas")).toBe("admin");
  });

  it("advertises an exhaustive and exact tool list in the trivia:management description", async () => {
    const sdk = await bootTrivia(SEASONS_ON);
    const options = sdk.registerMcpServer.mock.calls.find((call) => call[0] === "management")?.[1];
    if (options === undefined) throw new Error("plugin never registered trivia:management");

    expect(options.autoload).toBe(false);
    expect(advertisedTools(options.description).sort()).toEqual(
      toolNames(managementHandle(sdk)).sort(),
    );
  });

  it("advertises an exhaustive and exact tool list when seasons are disabled", async () => {
    const sdk = await bootTrivia({ games: [] });
    const options = sdk.registerMcpServer.mock.calls.find((call) => call[0] === "management")?.[1];
    if (options === undefined) throw new Error("plugin never registered trivia:management");

    expect(advertisedTools(options.description).sort()).toEqual(
      toolNames(managementHandle(sdk)).sort(),
    );
  });

  it("gates the season tools on seasons.enabled", async () => {
    const off = await bootTrivia({ games: [] });
    const offManagement = toolNames(managementHandle(off));
    expect(offManagement).not.toContain("upsert_season");
    expect(offManagement).not.toContain("delete_season");
    expect(toolNames(off.mcpServer)).not.toContain("check_season_status");
    expect(toolNames(off.mcpServer)).not.toContain("list_seasons");

    _resetTriviaConfigBridge();

    const on = await bootTrivia(SEASONS_ON);
    const onManagement = toolNames(managementHandle(on));
    expect(onManagement).toContain("upsert_season");
    expect(onManagement).toContain("delete_season");
    expect(toolNames(on.mcpServer)).toContain("check_season_status");
    expect(toolNames(on.mcpServer)).toContain("list_seasons");
  });

  it("self-disables with a clear error when the cron capability is off", async () => {
    const { sdk } = createFakeSdk({ capabilities: { crons: false } });
    await triviaPlugin(sdk);

    expect(sdk.error).toHaveBeenCalledTimes(1);
    expect(sdk.error.mock.calls[0][0]).toMatch(/Trivia requires the cron scheduler/);
    expect(sdk.error.mock.calls[0][0]).toMatch(/config\.cron\.enabled/);
    expect(sdk.registerTool).not.toHaveBeenCalled();
    expect(sdk.registerMcpServer).not.toHaveBeenCalled();
    expect(sdk.reconcileCronJobs).not.toHaveBeenCalled();
  });
});
