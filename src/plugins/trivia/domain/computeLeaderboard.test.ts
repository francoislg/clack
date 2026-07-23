import { describe, test } from "vitest";
import { strict as assert } from "node:assert";
import { buildQuestionPointsMap, computeLeaderboard } from "./computeLeaderboard.js";
import type { SubmittedAnswer, TriviaQuestion, TriviaUser } from "../core/types.js";

/** No question is worth more than 1 — every id falls through to the `?? 1` default. */
const ALL_ONE_POINT = new Map<string, number>();

function makeAnswer(
  overrides: Partial<SubmittedAnswer> & Pick<SubmittedAnswer, "userId">,
): SubmittedAnswer {
  return {
    questionId: "q1",
    correct: false,
    timestamp: 0,
    ...overrides,
  } satisfies SubmittedAnswer;
}

function makeUser(userId: string, displayName: string): [string, TriviaUser] {
  return [userId, { userId, displayName }];
}

describe("computeLeaderboard", () => {
  test("returns empty leaderboard when there are no answers", () => {
    const result = computeLeaderboard([], new Map(), ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.deepEqual(result.leaderboard, []);
    assert.equal(result.totalPlayers, 0);
  });

  test("excludes synthetic team: rows — the individual board never lists teams", () => {
    const answers = [
      makeAnswer({ userId: "U1", correct: true }),
      makeAnswer({ userId: "team:Red", correct: true }),
      makeAnswer({ userId: "team:Blue", correct: true }),
    ];
    const users = new Map([makeUser("U1", "Alice")]);
    const { leaderboard, totalPlayers } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.deepEqual(
      leaderboard.map((e) => e.userId),
      ["U1"],
    );
    assert.equal(totalPlayers, 1);
  });

  test("single user — totals and accuracy", () => {
    const answers = [
      makeAnswer({ userId: "U1", correct: true }),
      makeAnswer({ userId: "U1", correct: false }),
      makeAnswer({ userId: "U1", correct: true }),
    ];
    const users = new Map([makeUser("U1", "Alice")]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.equal(leaderboard.length, 1);
    assert.equal(leaderboard[0].userId, "U1");
    assert.equal(leaderboard[0].displayName, "Alice");
    assert.equal(leaderboard[0].totalCorrect, 2);
    assert.equal(leaderboard[0].totalAnswered, 3);
    assert.equal(leaderboard[0].accuracy, 67); // 2/3 → 0.6667 → 67
  });

  test("sortBy=totalCorrect — most wins first, accuracy tiebreak", () => {
    // Alice: 5 correct of 10 (50%); Bob: 3 correct of 3 (100%); Carol: 5 correct of 5 (100%)
    const answers: SubmittedAnswer[] = [
      ...Array.from({ length: 5 }, () => makeAnswer({ userId: "U_A", correct: true })),
      ...Array.from({ length: 5 }, () => makeAnswer({ userId: "U_A", correct: false })),
      ...Array.from({ length: 3 }, () => makeAnswer({ userId: "U_B", correct: true })),
      ...Array.from({ length: 5 }, () => makeAnswer({ userId: "U_C", correct: true })),
    ];
    const users = new Map([
      makeUser("U_A", "Alice"),
      makeUser("U_B", "Bob"),
      makeUser("U_C", "Carol"),
    ]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    // Alice (5) and Carol (5) tied on totalCorrect; Carol has 100% accuracy vs Alice 50%.
    assert.deepEqual(
      leaderboard.map((e) => e.displayName),
      ["Carol", "Alice", "Bob"],
    );
  });

  test("sortBy=accuracy — highest accuracy first, totalCorrect tiebreak", () => {
    // Alice: 5 of 10 (50%); Bob: 10 of 10 (100%); Carol: 3 of 3 (100%)
    const answers: SubmittedAnswer[] = [
      ...Array.from({ length: 5 }, () => makeAnswer({ userId: "U_A", correct: true })),
      ...Array.from({ length: 5 }, () => makeAnswer({ userId: "U_A", correct: false })),
      ...Array.from({ length: 10 }, () => makeAnswer({ userId: "U_B", correct: true })),
      ...Array.from({ length: 3 }, () => makeAnswer({ userId: "U_C", correct: true })),
    ];
    const users = new Map([
      makeUser("U_A", "Alice"),
      makeUser("U_B", "Bob"),
      makeUser("U_C", "Carol"),
    ]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "accuracy",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    // Bob and Carol tied at 100% accuracy; Bob has more totalCorrect (10 > 3).
    assert.deepEqual(
      leaderboard.map((e) => e.displayName),
      ["Bob", "Carol", "Alice"],
    );
  });

  test("limit trims results", () => {
    const users = new Map<string, TriviaUser>();
    const answers: SubmittedAnswer[] = [];
    for (let i = 0; i < 15; i++) {
      const uid = `U${i}`;
      users.set(uid, { userId: uid, displayName: `User${i}` });
      // Each user has (i+1) correct answers to ensure unique ordering.
      for (let j = 0; j <= i; j++) {
        answers.push(makeAnswer({ userId: uid, correct: true }));
      }
    }
    const { leaderboard, totalPlayers } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      limit: 5,
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.equal(leaderboard.length, 5);
    assert.equal(totalPlayers, 15);
    // Top 5 should be users 14..10 (most-correct).
    assert.deepEqual(
      leaderboard.map((e) => e.displayName),
      ["User14", "User13", "User12", "User11", "User10"],
    );
  });

  test("seasons enabled — currentSeasonCorrect/Answered fields are populated; ranking still uses all-time totalCorrect", () => {
    // Alice: 3 correct in current season, 5 correct all-time
    // Bob:   1 correct in current season, 10 correct all-time
    // The primary filter (s-now) determines INCLUSION (only those with answers in s-now appear) AND
    // accuracy scope. Ranking is still by the entry's totalCorrect, which is all-time — this matches
    // the historical retrieve_scores behavior so the reveal table's "raw win count" column stays
    // consistent with column ordering.
    const answers: SubmittedAnswer[] = [
      // Alice — current season
      ...Array.from({ length: 3 }, () =>
        makeAnswer({ userId: "U_A", correct: true, season: "s-now" }),
      ),
      makeAnswer({ userId: "U_A", correct: false, season: "s-now" }),
      // Alice — old season
      ...Array.from({ length: 2 }, () =>
        makeAnswer({ userId: "U_A", correct: true, season: "s-old" }),
      ),
      // Bob — current season
      makeAnswer({ userId: "U_B", correct: true, season: "s-now" }),
      makeAnswer({ userId: "U_B", correct: false, season: "s-now" }),
      // Bob — old season
      ...Array.from({ length: 9 }, () =>
        makeAnswer({ userId: "U_B", correct: true, season: "s-old" }),
      ),
    ];
    const users = new Map([makeUser("U_A", "Alice"), makeUser("U_B", "Bob")]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: "s-now",
      currentSeasonSlug: "s-now",
    });
    // Bob ranks first (all-time totalCorrect 10 > Alice 5), even though Alice leads the current season.
    assert.equal(leaderboard[0].userId, "U_B");
    assert.equal(leaderboard[0].totalCorrect, 10);
    assert.equal(leaderboard[0].totalAnswered, 11);
    assert.equal(leaderboard[0].currentSeasonCorrect, 1);
    assert.equal(leaderboard[0].currentSeasonAnswered, 2);

    assert.equal(leaderboard[1].userId, "U_A");
    assert.equal(leaderboard[1].totalCorrect, 5);
    assert.equal(leaderboard[1].totalAnswered, 6);
    assert.equal(leaderboard[1].currentSeasonCorrect, 3);
    assert.equal(leaderboard[1].currentSeasonAnswered, 4);
  });

  test("seasons enabled — primary filter scopes INCLUSION (no answers in primary scope ⇒ omitted)", () => {
    // Alice: 0 in s-now, 5 in s-old → omitted (no s-now participation)
    // Bob:   2 in s-now, 0 in s-old → included
    const answers: SubmittedAnswer[] = [
      ...Array.from({ length: 5 }, () =>
        makeAnswer({ userId: "U_A", correct: true, season: "s-old" }),
      ),
      ...Array.from({ length: 2 }, () =>
        makeAnswer({ userId: "U_B", correct: true, season: "s-now" }),
      ),
    ];
    const users = new Map([makeUser("U_A", "Alice"), makeUser("U_B", "Bob")]);
    const { leaderboard, totalPlayers } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: "s-now",
      currentSeasonSlug: "s-now",
    });
    assert.equal(leaderboard.length, 1);
    assert.equal(leaderboard[0].userId, "U_B");
    assert.equal(totalPlayers, 1);
  });

  test("seasons disabled — currentSeasonCorrect/Answered fields are absent", () => {
    const answers = [makeAnswer({ userId: "U1", correct: true })];
    const users = new Map([makeUser("U1", "Alice")]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.equal(leaderboard[0].currentSeasonCorrect, undefined);
    assert.equal(leaderboard[0].currentSeasonAnswered, undefined);
  });

  test("missing user falls back to userId as displayName", () => {
    const answers = [makeAnswer({ userId: "U_unknown", correct: true })];
    const { leaderboard } = computeLeaderboard(answers, new Map(), ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.equal(leaderboard[0].displayName, "U_unknown");
  });

  test("accuracy is computed over the PRIMARY scope, not all-time", () => {
    // Alice in s-now: 1 correct of 2 (50%)
    // Alice all-time: 1 correct of 2 in s-now plus 10 correct of 10 in s-old = 11/12 ≈ 92%
    const answers: SubmittedAnswer[] = [
      makeAnswer({ userId: "U_A", correct: true, season: "s-now" }),
      makeAnswer({ userId: "U_A", correct: false, season: "s-now" }),
      ...Array.from({ length: 10 }, () =>
        makeAnswer({ userId: "U_A", correct: true, season: "s-old" }),
      ),
    ];
    const users = new Map([makeUser("U_A", "Alice")]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: "s-now",
      currentSeasonSlug: "s-now",
    });
    // accuracy should reflect the PRIMARY scope (s-now): 1/2 = 50%
    assert.equal(leaderboard[0].accuracy, 50);
    // totalCorrect remains the all-time count
    assert.equal(leaderboard[0].totalCorrect, 11);
  });
});

function makeQuestion(id: string, points?: number): TriviaQuestion {
  return {
    id,
    category: "Science",
    statement: "...",
    answersFormat: "boolean",
    questionType: "fact",
    emojis: ["🔬"],
    createdAt: 0,
    ...(points !== undefined ? { points } : {}),
  };
}

describe("buildQuestionPointsMap", () => {
  test("enters only questions worth more than 1", () => {
    const map = buildQuestionPointsMap([
      makeQuestion("q1", 3),
      makeQuestion("q2"),
      makeQuestion("q3", 1),
    ]);
    assert.equal(map.get("q1"), 3);
    assert.equal(map.get("q2"), undefined);
    assert.equal(map.get("q3"), undefined, "an explicit 1 is indistinguishable from absence");
    assert.equal(map.size, 1);
  });
});

describe("computeLeaderboard — points", () => {
  test("a correct answer pays its question's stamped points", () => {
    // Alice: one 2-point question. Bob: two 1-point questions. Equal points, unequal counts.
    const answers = [
      makeAnswer({ userId: "U1", questionId: "q-heavy", correct: true }),
      makeAnswer({ userId: "U2", questionId: "q-a", correct: true }),
      makeAnswer({ userId: "U2", questionId: "q-b", correct: true }),
    ];
    const users = new Map([makeUser("U1", "Alice"), makeUser("U2", "Bob")]);
    const points = buildQuestionPointsMap([makeQuestion("q-heavy", 2)]);

    const { leaderboard } = computeLeaderboard(answers, users, points, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });

    const alice = leaderboard.find((e) => e.userId === "U1");
    const bob = leaderboard.find((e) => e.userId === "U2");
    assert.equal(alice?.totalPoints, 2);
    assert.equal(alice?.totalCorrect, 1);
    assert.equal(bob?.totalPoints, 2);
    assert.equal(bob?.totalCorrect, 2);
  });

  test("an incorrect answer on a high-value question pays nothing", () => {
    const answers = [makeAnswer({ userId: "U1", questionId: "q-heavy", correct: false })];
    const users = new Map([makeUser("U1", "Alice")]);
    const points = buildQuestionPointsMap([makeQuestion("q-heavy", 3)]);

    const { leaderboard } = computeLeaderboard(answers, users, points, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.equal(leaderboard[0].totalPoints, 0);
    assert.equal(leaderboard[0].totalAnswered, 1);
  });

  test("pending freeform rows stay excluded from points", () => {
    const answers = [
      makeAnswer({ userId: "U1", questionId: "q-heavy", correct: undefined, answerText: "guess" }),
    ];
    const users = new Map([makeUser("U1", "Alice")]);
    const points = buildQuestionPointsMap([makeQuestion("q-heavy", 3)]);

    const { leaderboard } = computeLeaderboard(answers, users, points, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.deepEqual(leaderboard, []);
  });

  test("ranking is points-primary — fewer correct can outrank more", () => {
    const answers = [
      makeAnswer({ userId: "U1", questionId: "q-heavy", correct: true }),
      makeAnswer({ userId: "U2", questionId: "q-a", correct: true }),
      makeAnswer({ userId: "U2", questionId: "q-b", correct: true }),
    ];
    const users = new Map([makeUser("U1", "Alice"), makeUser("U2", "Bob")]);
    const points = buildQuestionPointsMap([makeQuestion("q-heavy", 5)]);

    const { leaderboard } = computeLeaderboard(answers, users, points, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    assert.equal(leaderboard[0].userId, "U1", "5 points beats 2 despite half the correct count");
    assert.equal(leaderboard[1].userId, "U2");
  });

  test("uniform 1-point history — totalPoints tracks totalCorrect exactly", () => {
    const answers = [
      makeAnswer({ userId: "U1", questionId: "q-a", correct: true }),
      makeAnswer({ userId: "U1", questionId: "q-b", correct: true }),
      makeAnswer({ userId: "U1", questionId: "q-c", correct: false }),
      makeAnswer({ userId: "U2", questionId: "q-a", correct: true }),
    ];
    const users = new Map([makeUser("U1", "Alice"), makeUser("U2", "Bob")]);
    const { leaderboard } = computeLeaderboard(answers, users, ALL_ONE_POINT, {
      sortBy: "totalCorrect",
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    });
    for (const entry of leaderboard) {
      assert.equal(entry.totalPoints, entry.totalCorrect, `${entry.displayName} diverged`);
    }
    assert.deepEqual(
      leaderboard.map((e) => e.userId),
      ["U1", "U2"],
      "ordering matches the pre-points behavior",
    );
  });

  test("currentSeasonPoints is scoped to the current season", () => {
    const answers = [
      makeAnswer({ userId: "U1", questionId: "q-heavy", correct: true, season: "s-now" }),
      makeAnswer({ userId: "U1", questionId: "q-old", correct: true, season: "s-old" }),
    ];
    const users = new Map([makeUser("U1", "Alice")]);
    const points = buildQuestionPointsMap([makeQuestion("q-heavy", 2), makeQuestion("q-old", 4)]);

    const { leaderboard } = computeLeaderboard(answers, users, points, {
      sortBy: "totalCorrect",
      primaryFilterSeason: "s-now",
      currentSeasonSlug: "s-now",
    });
    assert.equal(leaderboard[0].currentSeasonPoints, 2);
    assert.equal(leaderboard[0].totalPoints, 6, "all-time spans both seasons");
  });

  test("flipping a verdict re-prices through the join with no answer-row change", () => {
    const users = new Map([makeUser("U1", "Alice")]);
    const points = buildQuestionPointsMap([makeQuestion("q-heavy", 2)]);
    const options = {
      sortBy: "totalCorrect" as const,
      primaryFilterSeason: null,
      currentSeasonSlug: null,
    };

    const before = computeLeaderboard(
      [makeAnswer({ userId: "U1", questionId: "q-heavy", correct: false })],
      users,
      points,
      options,
    );
    assert.equal(before.leaderboard[0].totalPoints, 0);

    // The only mutation an override performs: the row's `correct` verdict.
    const after = computeLeaderboard(
      [makeAnswer({ userId: "U1", questionId: "q-heavy", correct: true })],
      users,
      points,
      options,
    );
    assert.equal(after.leaderboard[0].totalPoints, 2);
  });
});
