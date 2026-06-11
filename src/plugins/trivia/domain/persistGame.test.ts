import { describe, it, expect, vi, beforeEach } from "vitest";
import { persistGameWrite } from "./persistGame.js";
import { saveTriviaConfig } from "../core/configBridge.js";

vi.mock("../core/configBridge.js", () => ({
  saveTriviaConfig: vi.fn(async () => {}),
}));

const season = { slug: "season-1", startedAt: 0, expectedEndAt: 1 };

function recordingWriter(order: string[], opts: { throwOnSeason?: boolean } = {}) {
  return {
    forGame: () => ({
      saveSeasonsState: async () => {
        if (opts.throwOnSeason) throw new Error("season write failed");
        order.push("season");
      },
    }),
  };
}

describe("persistGameWrite", () => {
  beforeEach(() => {
    vi.mocked(saveTriviaConfig).mockClear();
    vi.mocked(saveTriviaConfig).mockImplementation(async () => {});
  });

  it("writes the season before the config", async () => {
    const order: string[] = [];
    vi.mocked(saveTriviaConfig).mockImplementation(async () => {
      order.push("config");
    });
    await persistGameWrite(
      {},
      { gameName: "g", data: recordingWriter(order), initialSeasonEntry: season },
    );
    expect(order).toEqual(["season", "config"]);
  });

  it("does not write the config when the season write fails", async () => {
    const order: string[] = [];
    await expect(
      persistGameWrite(
        {},
        {
          gameName: "g",
          data: recordingWriter(order, { throwOnSeason: true }),
          initialSeasonEntry: season,
        },
      ),
    ).rejects.toThrow(/season write failed/);
    expect(saveTriviaConfig).not.toHaveBeenCalled();
  });

  it("writes only the config when there is no initial season", async () => {
    const order: string[] = [];
    await persistGameWrite({}, { gameName: "g", data: recordingWriter(order) });
    expect(order).toEqual([]);
    expect(saveTriviaConfig).toHaveBeenCalledOnce();
  });
});
