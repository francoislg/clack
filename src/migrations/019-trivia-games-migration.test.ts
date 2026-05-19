import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migration } from "./019-trivia-games-migration.js";
import type { StaticFileResult } from "./types.js";

const JOBS_PATH = "data/state/cron-jobs.json";
const CONFIG_PATH = "data/config.json";
const PLUGIN_TRIVIA = "data/plugins/trivia";
const FLAT_FILES = ["questions.json", "answers.json", "cheats.json", "seasons.json"] as const;
const FALLBACK_GAME_NAME = "initialgame";

type StaticOutput = { [path: string]: StaticFileResult };

interface FlatFileSeed {
  questions?: string;
  answers?: string;
  cheats?: string;
  seasons?: string;
}

/** Build the `files` map for `migration.static`, including optional flat-file seeds
 *  and any pre-existing per-game files (used to test idempotency on the data-move step). */
function buildFiles(
  jobsFile: JobsFileLike | null,
  config: ConfigLike | null,
  flat: FlatFileSeed = {},
  preExistingGameFiles: Record<string, string> = {},
): Record<string, string | null> {
  const files: Record<string, string | null> = {
    [JOBS_PATH]: jobsFile === null ? null : JSON.stringify(jobsFile),
    [CONFIG_PATH]: config === null ? null : JSON.stringify(config),
    [`${PLUGIN_TRIVIA}/questions.json`]: flat.questions ?? null,
    [`${PLUGIN_TRIVIA}/answers.json`]: flat.answers ?? null,
    [`${PLUGIN_TRIVIA}/cheats.json`]: flat.cheats ?? null,
    [`${PLUGIN_TRIVIA}/seasons.json`]: flat.seasons ?? null,
    [`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/questions.json`]:
      preExistingGameFiles[`${FALLBACK_GAME_NAME}/questions.json`] ?? null,
    [`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/answers.json`]:
      preExistingGameFiles[`${FALLBACK_GAME_NAME}/answers.json`] ?? null,
    [`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/cheats.json`]:
      preExistingGameFiles[`${FALLBACK_GAME_NAME}/cheats.json`] ?? null,
    [`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/seasons.json`]:
      preExistingGameFiles[`${FALLBACK_GAME_NAME}/seasons.json`] ?? null,
  };
  return files;
}

interface JobLike {
  id: string;
  cronExpression: string;
  channel: string;
  prompt: string;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
  plugin?: string;
}

interface JobsFileLike {
  jobs: JobLike[];
}

interface GameLike {
  name: string;
  channel: string;
  questionCron: string;
  revealCron: string;
  timezone: string;
}

interface ConfigLike {
  trivia?: {
    games?: GameLike[];
  };
  repositories?: unknown[];
}

function run(jobsFile: JobsFileLike | null, config: ConfigLike | null): StaticOutput {
  return migration.static!(buildFiles(jobsFile, config));
}

function runWithFlatData(
  jobsFile: JobsFileLike | null,
  config: ConfigLike | null,
  flat: FlatFileSeed,
  preExistingGameFiles: Record<string, string> = {},
): StaticOutput {
  return migration.static!(buildFiles(jobsFile, config, flat, preExistingGameFiles));
}

function parsedJobsFile(out: StaticOutput): JobsFileLike | null {
  const written = out[JOBS_PATH];
  if (typeof written !== "string") return null;
  const parsed: JobsFileLike = JSON.parse(written);
  return parsed;
}

function parsedConfig(out: StaticOutput): ConfigLike | null {
  const written = out[CONFIG_PATH];
  if (typeof written !== "string") return null;
  const parsed: ConfigLike = JSON.parse(written);
  return parsed;
}

interface JobOverrides {
  id?: string;
  cronExpression?: string;
  channel?: string;
  prompt?: string;
  plugin?: string;
  timezone?: string;
}

function makeJob(overrides: JobOverrides = {}): JobLike {
  return {
    id: overrides.id ?? "j-x",
    cronExpression: overrides.cronExpression ?? "0 9 * * 1-5",
    channel: overrides.channel ?? "C1",
    prompt:
      overrides.prompt ??
      "Call send_questions_instructions and follow the returned instructions exactly.",
    createdBy: "U1",
    createdAt: "2026-01-01T00:00:00Z",
    enabled: true,
    timezone: overrides.timezone ?? "America/Montreal",
    plugin: overrides.plugin ?? "trivia",
  };
}

describe("migration 019: trivia games", () => {
  it("converts a clean dispatcher pair into a games[] entry and removes both jobs", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({
          id: "q-1",
          cronExpression: "0 9 * * 1-5",
          channel: "C123",
          prompt: "Call send_questions_instructions and follow the returned instructions exactly.",
        }),
        makeJob({
          id: "r-1",
          cronExpression: "0 15 * * 1-5",
          channel: "C123",
          prompt:
            "Call process_responses_instructions and follow the returned instructions exactly.",
        }),
      ],
    };
    const config: ConfigLike = { repositories: [] };

    const out = run(jobs, config);
    const newConfig = parsedConfig(out);
    const newJobsFile = parsedJobsFile(out);

    assert.ok(newConfig?.trivia?.games);
    assert.equal(newConfig.trivia.games.length, 1);
    assert.deepEqual(newConfig.trivia.games[0], {
      name: "legacy-c123",
      channel: "C123",
      questionCron: "0 9 * * 1-5",
      revealCron: "0 15 * * 1-5",
      timezone: "America/Montreal",
    });
    assert.ok(newJobsFile);
    assert.equal(newJobsFile.jobs.length, 0);
  });

  it("leaves an unpaired dispatcher job in place with no writes", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({
          id: "q-1",
          channel: "C1",
          prompt: "Call send_questions_instructions and follow",
        }),
      ],
    };
    const out = run(jobs, { repositories: [] });
    assert.equal(out[CONFIG_PATH], undefined);
    assert.equal(out[JOBS_PATH], undefined);
  });

  it("leaves an inline-fat-prompt trivia job in place", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({
          id: "j-fat",
          channel: "C1",
          prompt: "Custom inline trivia prompt with hand-edited steps and no dispatcher reference",
        }),
      ],
    };
    const out = run(jobs, { repositories: [] });
    assert.equal(out[CONFIG_PATH], undefined);
    assert.equal(out[JOBS_PATH], undefined);
  });

  it("is idempotent on already-migrated input (no candidates left)", () => {
    const jobs: JobsFileLike = { jobs: [] };
    const config: ConfigLike = {
      trivia: {
        games: [
          {
            name: "legacy-c123",
            channel: "C123",
            questionCron: "0 9 * * 1-5",
            revealCron: "0 15 * * 1-5",
            timezone: "America/Montreal",
          },
        ],
      },
    };
    const out = run(jobs, config);
    assert.equal(out[CONFIG_PATH], undefined);
    assert.equal(out[JOBS_PATH], undefined);
  });

  it("migrates multiple pairs across channels", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({ id: "a-q", channel: "CA", cronExpression: "0 9 * * *" }),
        makeJob({
          id: "a-r",
          channel: "CA",
          cronExpression: "0 17 * * *",
          prompt: "Call process_responses_instructions and follow",
        }),
        makeJob({ id: "b-q", channel: "CB", cronExpression: "0 10 * * *" }),
        makeJob({
          id: "b-r",
          channel: "CB",
          cronExpression: "0 18 * * *",
          prompt: "Call process_responses_instructions and follow",
        }),
      ],
    };
    const out = run(jobs, { repositories: [] });
    const cfg = parsedConfig(out);
    assert.equal(cfg?.trivia?.games?.length, 2);
    const jobsFile = parsedJobsFile(out);
    assert.equal(jobsFile?.jobs.length, 0);
  });

  it("ignores non-trivia plugin jobs and unrelated user-created jobs", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({
          id: "weather-q",
          channel: "C1",
          plugin: "weather",
          prompt: "Call send_questions_instructions and follow",
        }),
        makeJob({
          id: "user-1",
          channel: "C2",
          plugin: "",
          prompt: "Daily digest of merged PRs",
        }),
      ],
    };
    const out = run(jobs, { repositories: [] });
    assert.equal(out[CONFIG_PATH], undefined);
    assert.equal(out[JOBS_PATH], undefined);
  });

  it("returns no writes when either file is missing", () => {
    const out = migration.static!({
      [JOBS_PATH]: null,
      [CONFIG_PATH]: JSON.stringify({ repositories: [] }),
    });
    assert.deepEqual(out, {});
  });

  it("returns no writes when JSON is malformed", () => {
    const out = migration.static!({
      [JOBS_PATH]: "{not valid json",
      [CONFIG_PATH]: JSON.stringify({ repositories: [] }),
    });
    assert.deepEqual(out, {});
  });

  // ── Data-move inheritance paths (merged from former migration 020) ──────────

  it("fresh deployment: no schedule, no flat data → no writes at all", () => {
    const out = run({ jobs: [] }, { repositories: [] });
    assert.equal(out[CONFIG_PATH], undefined);
    assert.equal(out[JOBS_PATH], undefined);
    // No per-game files written either.
    for (const file of FLAT_FILES) {
      assert.equal(out[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/${file}`], undefined);
    }
  });

  it("flat data + dispatcher schedule → data lands in the legacy-<channel> game (no initialgame)", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({ id: "q-1", channel: "C123" }),
        makeJob({
          id: "r-1",
          channel: "C123",
          prompt: "Call process_responses_instructions and follow",
        }),
      ],
    };
    const out = runWithFlatData(
      jobs,
      { repositories: [] },
      {
        questions:
          '[{"id":"q1","category":"X","statement":"S","isTrue":true,"emojis":["x"],"createdAt":1}]',
        answers: "[]",
      },
    );

    // legacy-c123 created, no initialgame
    const cfg = parsedConfig(out);
    assert.equal(cfg?.trivia?.games?.length, 1);
    assert.equal(cfg?.trivia?.games?.[0].name, "legacy-c123");

    // Data moved into legacy-c123, not initialgame
    assert.ok(
      typeof out[`${PLUGIN_TRIVIA}/games/legacy-c123/questions.json`] === "string",
      "questions.json should land in legacy-c123",
    );
    assert.ok(
      typeof out[`${PLUGIN_TRIVIA}/games/legacy-c123/answers.json`] === "string",
      "answers.json should land in legacy-c123",
    );
    // Source flat files deleted
    assert.deepEqual(out[`${PLUGIN_TRIVIA}/questions.json`], { delete: true });
    assert.deepEqual(out[`${PLUGIN_TRIVIA}/answers.json`], { delete: true });

    // initialgame should NOT exist
    assert.equal(out[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/questions.json`], undefined);
  });

  it("flat data + NO schedule + NO config games → creates initialgame and moves data into it", () => {
    const out = runWithFlatData(
      { jobs: [] },
      { repositories: [] },
      {
        questions:
          '[{"id":"q1","category":"X","statement":"S","isTrue":true,"emojis":["x"],"createdAt":1}]',
      },
    );

    const cfg = parsedConfig(out);
    assert.equal(cfg?.trivia?.games?.length, 1);
    assert.equal(cfg?.trivia?.games?.[0].name, FALLBACK_GAME_NAME);
    assert.equal(cfg?.trivia?.games?.[0].channel, "C000000000");
    // The fallback writes `enabled: false` to prevent unintended cron scheduling.
    const fallback = cfg?.trivia?.games?.[0] as { enabled?: boolean } | undefined;
    assert.equal(fallback?.enabled, false);

    // Data moved
    assert.ok(
      typeof out[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/questions.json`] === "string",
    );
    assert.deepEqual(out[`${PLUGIN_TRIVIA}/questions.json`], { delete: true });
  });

  it("flat data + pre-existing config games → data lands in the FIRST pre-existing game", () => {
    const config: ConfigLike = {
      trivia: {
        games: [
          {
            name: "main",
            channel: "C111",
            questionCron: "0 9 * * 1-5",
            revealCron: "0 17 * * 1-5",
            timezone: "UTC",
          },
          {
            name: "secondary",
            channel: "C222",
            questionCron: "0 10 * * 1-5",
            revealCron: "0 18 * * 1-5",
            timezone: "UTC",
          },
        ],
      },
    };
    const out = runWithFlatData({ jobs: [] }, config, {
      questions:
        '[{"id":"q1","category":"X","statement":"S","isTrue":true,"emojis":["x"],"createdAt":1}]',
    });

    // No new games added (existing ones cover the slot)
    const cfg = parsedConfig(out);
    assert.equal(cfg, null, "config should be untouched when no new games are added");

    // Data landed in "main" (first pre-existing entry)
    assert.ok(typeof out[`${PLUGIN_TRIVIA}/games/main/questions.json`] === "string");
    assert.equal(out[`${PLUGIN_TRIVIA}/games/secondary/questions.json`], undefined);
    assert.equal(out[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/questions.json`], undefined);
    assert.deepEqual(out[`${PLUGIN_TRIVIA}/questions.json`], { delete: true });
  });

  it("multi-channel dispatcher + flat data → data lands in the FIRST newly-created legacy entry", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({ id: "a-q", channel: "CA", cronExpression: "0 9 * * *" }),
        makeJob({
          id: "a-r",
          channel: "CA",
          cronExpression: "0 17 * * *",
          prompt: "Call process_responses_instructions and follow",
        }),
        makeJob({ id: "b-q", channel: "CB", cronExpression: "0 10 * * *" }),
        makeJob({
          id: "b-r",
          channel: "CB",
          cronExpression: "0 18 * * *",
          prompt: "Call process_responses_instructions and follow",
        }),
      ],
    };
    const out = runWithFlatData(
      jobs,
      { repositories: [] },
      {
        questions:
          '[{"id":"q1","category":"X","statement":"S","isTrue":true,"emojis":["x"],"createdAt":1}]',
      },
    );

    const cfg = parsedConfig(out);
    assert.equal(cfg?.trivia?.games?.length, 2);
    // The migration walks `byChannel` in insertion order; CA was inserted first.
    const firstName = cfg?.trivia?.games?.[0].name;
    assert.ok(
      typeof out[`${PLUGIN_TRIVIA}/games/${firstName}/questions.json`] === "string",
      `data should land in ${firstName} (first newly-created game)`,
    );
  });

  it("idempotency: re-running with data already in games/initialgame/ does NOT move flat data again", () => {
    const preExisting = {
      [`${FALLBACK_GAME_NAME}/questions.json`]: "[]",
    };
    const out = runWithFlatData(
      { jobs: [] },
      {
        trivia: {
          games: [
            {
              name: FALLBACK_GAME_NAME,
              channel: "C000000000",
              questionCron: "0 0 * * 0",
              revealCron: "0 0 * * 0",
              timezone: "UTC",
            },
          ],
        },
      },
      // Flat files still present (e.g. partial migration earlier)
      {
        questions:
          '[{"id":"q1","category":"X","statement":"S","isTrue":true,"emojis":["x"],"createdAt":1}]',
      },
      preExisting,
    );

    // Since games/initialgame/ already has data, the migration skips the move.
    // The flat file should NOT be marked for deletion or rewritten.
    assert.equal(out[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/questions.json`], undefined);
    assert.equal(out[`${PLUGIN_TRIVIA}/questions.json`], undefined);
  });

  it("dispatcher schedule + no flat data → step 1 runs, step 2 is a no-op (no initialgame fallback)", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({ id: "q-1", channel: "C123" }),
        makeJob({
          id: "r-1",
          channel: "C123",
          prompt: "Call process_responses_instructions and follow",
        }),
      ],
    };
    const out = run(jobs, { repositories: [] });

    const cfg = parsedConfig(out);
    assert.equal(cfg?.trivia?.games?.length, 1);
    assert.equal(cfg?.trivia?.games?.[0].name, "legacy-c123");
    // No per-game data files should be created (none to migrate)
    for (const file of FLAT_FILES) {
      assert.equal(out[`${PLUGIN_TRIVIA}/games/legacy-c123/${file}`], undefined);
      assert.equal(out[`${PLUGIN_TRIVIA}/games/${FALLBACK_GAME_NAME}/${file}`], undefined);
    }
  });

  it("skips channels already represented in games[] but still consumes their legacy jobs", () => {
    const jobs: JobsFileLike = {
      jobs: [
        makeJob({ id: "q-1", channel: "C123" }),
        makeJob({
          id: "r-1",
          channel: "C123",
          prompt: "Call process_responses_instructions and follow",
        }),
      ],
    };
    const config: ConfigLike = {
      trivia: {
        games: [
          {
            name: "ops-daily",
            channel: "C123",
            questionCron: "0 10 * * 1-5",
            revealCron: "0 16 * * 1-5",
            timezone: "UTC",
          },
        ],
      },
    };
    const out = run(jobs, config);
    assert.equal(out[CONFIG_PATH], undefined);
    const newJobsFile = parsedJobsFile(out);
    assert.equal(newJobsFile?.jobs.length, 0);
  });
});
