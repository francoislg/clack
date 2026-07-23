import { beforeEach, describe, expect, it } from "vitest";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";
import { createTriviaDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { FakeScopedTriviaDataLayer, FakeTriviaDataLayer } from "../testHelpers.js";
import type { TriviaUser } from "../core/types.js";
import type { TeamDef } from "../core/configTypes.js";
import { selectAnsweringStrategy } from "./select.js";

const ROSTER: TeamDef[] = [{ name: "Red", userIds: ["U1", "U2"] }];
const USERS = new Map<string, TriviaUser>([["U1", { userId: "U1", displayName: "Alice" }]]);

describe("selectAnsweringStrategy", () => {
  let dataLayer: FakeTriviaDataLayer;
  let scoped: FakeScopedTriviaDataLayer;

  beforeEach(() => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    dataLayer = createTriviaDataLayer(sdk).dataLayer;
    scoped = dataLayer.forGame(FIXTURE_GAME_NAME);
  });

  it("returns the by-team strategy for a byTeam-stamped question with a roster", () => {
    const strategy = selectAnsweringStrategy(
      { answeringType: "byTeam", teamsStamp: { teams: ROSTER } },
      scoped,
      dataLayer,
    );
    // The by-team strategy renders team owner keys as a bold team name.
    expect(strategy.ownerLabel("team:Red", { tagPlayers: true, users: USERS })).toBe("*Red*");
  });

  it("returns the individual strategy when the stamp is absent (legacy row)", () => {
    const strategy = selectAnsweringStrategy({}, scoped, dataLayer);
    // The individual strategy has no notion of team keys — it renders via the player ref.
    expect(strategy.ownerLabel("U1", { tagPlayers: false, users: USERS })).toBe("@Alice");
    expect(strategy.ownerLabel("team:Red", { tagPlayers: false, users: USERS })).toBe("@team:Red");
  });

  it("degrades to individual semantics when byTeam-stamped with an empty roster", async () => {
    const strategy = selectAnsweringStrategy(
      { answeringType: "byTeam", teamsStamp: { teams: [] } },
      scoped,
      dataLayer,
    );
    // Empty roster → every clicker is a free agent → an answer lands on answers.json.
    await strategy.answer("U1", "q1", { answer: true, correct: true }, {});
    expect(scoped.saveAnswer).toHaveBeenCalledTimes(1);
    expect(scoped.upsertTeamAnswer).not.toHaveBeenCalled();
  });
});
