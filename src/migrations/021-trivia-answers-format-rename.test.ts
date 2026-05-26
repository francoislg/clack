import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  migrateConfig,
  migrateQuestionRow,
  migrateSeasonEntry,
  migrateSeasonsFile,
  type SeasonEntry,
  type SeasonsFile,
} from "./021-trivia-answers-format-rename.js";

describe("021 migrateConfig", () => {
  it("renames questionsTypes to answersFormat", () => {
    const config = { trivia: { questionsTypes: { boolean: 2, choice: 1 } } };
    const { changed, value } = migrateConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(value, { trivia: { answersFormat: { boolean: 2, choice: 1 } } });
  });

  it("drops stale questionsTypes when answersFormat already exists", () => {
    const config = {
      trivia: {
        questionsTypes: { boolean: 1 },
        answersFormat: { boolean: 2, choice: 1 },
      },
    };
    const { changed, value } = migrateConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(value, { trivia: { answersFormat: { boolean: 2, choice: 1 } } });
  });

  it("no-op when already migrated", () => {
    const config = { trivia: { answersFormat: { boolean: 1 } } };
    const { changed, value } = migrateConfig(config);
    assert.equal(changed, false);
    assert.deepEqual(value, { trivia: { answersFormat: { boolean: 1 } } });
  });

  it("no-op when no trivia block", () => {
    const config = { slack: { token: "x" } };
    const { changed } = migrateConfig(config);
    assert.equal(changed, false);
  });

  it("no-op when neither key is present", () => {
    const config = { trivia: { seasons: { enabled: true } } };
    const { changed } = migrateConfig(config);
    assert.equal(changed, false);
  });

  it("preserves other trivia fields", () => {
    const config = {
      trivia: {
        questionsTypes: { boolean: 1, choice: 1 },
        seasons: { enabled: true, prompt: "monthly" },
        choices: { min: 2, max: 4 },
      },
    };
    const { changed, value } = migrateConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(value, {
      trivia: {
        seasons: { enabled: true, prompt: "monthly" },
        choices: { min: 2, max: 4 },
        answersFormat: { boolean: 1, choice: 1 },
      },
    });
  });
});

describe("021 migrateQuestionRow", () => {
  it("renames type to answersFormat and stamps questionType for a choice row", () => {
    const { changed, value } = migrateQuestionRow({
      id: "q1",
      type: "choice",
      category: "Science",
      statement: "Mercury is closest to the Sun.",
      choices: ["Mercury", "Venus"],
      correctIndex: 0,
      emojis: ["🪐"],
      createdAt: 1000,
    });
    assert.equal(changed, true);
    assert.equal(value.type, undefined);
    assert.equal(value.answersFormat, "choice");
    assert.equal(value.questionType, "fact");
    assert.equal(value.category, "Science");
    assert.equal(value.correctIndex, 0);
  });

  it("renames type to answersFormat on an explicit boolean row", () => {
    const { changed, value } = migrateQuestionRow({
      id: "q2",
      type: "boolean",
      isTrue: true,
      category: "Math",
      statement: "1 + 1 = 2.",
      emojis: ["➕"],
      createdAt: 1001,
    });
    assert.equal(changed, true);
    assert.equal(value.type, undefined);
    assert.equal(value.answersFormat, "boolean");
    assert.equal(value.questionType, "fact");
  });

  it("legacy row with no type defaults answersFormat to 'boolean' and stamps questionType", () => {
    const { changed, value } = migrateQuestionRow({
      id: "legacy",
      isTrue: false,
      category: "History",
      statement: "Rome was founded yesterday.",
      emojis: ["🏛️"],
      createdAt: 999,
    });
    assert.equal(changed, true);
    assert.equal(value.answersFormat, "boolean");
    assert.equal(value.questionType, "fact");
    assert.equal(value.type, undefined);
  });

  it("no-op when row is already migrated", () => {
    const original = {
      id: "q3",
      answersFormat: "choice" as const,
      questionType: "fact" as const,
      category: "Science",
      statement: "x",
      choices: ["a", "b"],
      correctIndex: 0,
      emojis: ["🧪"],
      createdAt: 1002,
    };
    const { changed, value } = migrateQuestionRow({ ...original });
    assert.equal(changed, false);
    assert.deepEqual(value, original);
  });

  it("does not clobber an existing answersFormat value when both type and answersFormat are present", () => {
    // Defensive: e.g. someone re-ran the migration after manually editing.
    const { changed, value } = migrateQuestionRow({
      id: "q4",
      type: "choice",
      answersFormat: "choice",
      questionType: "fact",
      category: "x",
      statement: "x",
      choices: ["a", "b"],
      correctIndex: 0,
      emojis: [],
      createdAt: 1003,
    });
    assert.equal(changed, true);
    assert.equal(value.type, undefined);
    assert.equal(value.answersFormat, "choice");
    assert.equal(value.questionType, "fact");
  });
});

describe("021 migrateSeasonEntry", () => {
  it("renames questionsTypes to answersFormat", () => {
    const entry: SeasonEntry = {
      slug: "may-2026",
      startedAt: 1,
      expectedEndAt: 100,
      categories: ["Science"],
      questionsTypes: { boolean: 1, choice: 1 },
    };
    assert.equal(migrateSeasonEntry(entry), true);
    assert.equal("questionsTypes" in entry, false);
    assert.deepEqual(entry.answersFormat, { boolean: 1, choice: 1 });
  });

  it("renames questionTypes on each format slot to answersFormat", () => {
    const entry: SeasonEntry = {
      slug: "may-2026",
      startedAt: 1,
      expectedEndAt: 100,
      categories: ["Science"],
      format: {
        questions: [
          { label: "GK 1", questionTypes: { boolean: 1 } },
          {},
          { categories: ["History"], questionTypes: { choice: 1 } },
        ],
      },
    };
    assert.equal(migrateSeasonEntry(entry), true);
    const slots = entry.format!.questions!;
    assert.equal("questionTypes" in slots[0], false);
    assert.deepEqual(slots[0].answersFormat, { boolean: 1 });
    assert.deepEqual(slots[1], {});
    assert.equal("questionTypes" in slots[2], false);
    assert.deepEqual(slots[2].answersFormat, { choice: 1 });
    assert.deepEqual(slots[2].categories, ["History"]);
  });

  it("no-op when entry is already migrated", () => {
    const entry: SeasonEntry = {
      slug: "may-2026",
      startedAt: 1,
      expectedEndAt: 100,
      categories: ["Science"],
      answersFormat: { boolean: 1, choice: 1 },
      format: { questions: [{ answersFormat: { choice: 1 } }] },
    };
    const snapshot = JSON.stringify(entry);
    assert.equal(migrateSeasonEntry(entry), false);
    assert.equal(JSON.stringify(entry), snapshot);
  });

  it("handles entry with no questionsTypes and no format", () => {
    const entry: SeasonEntry = {
      slug: "starter",
      startedAt: 1,
      expectedEndAt: 100,
      categories: ["Science"],
    };
    assert.equal(migrateSeasonEntry(entry), false);
  });
});

describe("021 migrateSeasonsFile", () => {
  it("migrates every entry in the seasons array", () => {
    const file: SeasonsFile = {
      seasons: [
        {
          slug: "may-2026",
          startedAt: 1,
          expectedEndAt: 100,
          categories: ["A"],
          questionsTypes: { boolean: 1 },
        },
        {
          slug: "june-2026",
          startedAt: 100,
          expectedEndAt: 200,
          categories: ["B"],
          format: { questions: [{ questionTypes: { choice: 1 } }] },
        },
      ],
    };
    assert.equal(migrateSeasonsFile(file), true);
    const seasons = file.seasons!;
    assert.equal("questionsTypes" in seasons[0], false);
    assert.deepEqual(seasons[0].answersFormat, { boolean: 1 });
    const firstSlot = seasons[1].format!.questions![0];
    assert.equal("questionTypes" in firstSlot, false);
    assert.deepEqual(firstSlot.answersFormat, { choice: 1 });
  });

  it("no-op when seasons array is missing", () => {
    assert.equal(migrateSeasonsFile({ other: "thing" }), false);
  });

  it("no-op when seasons array is empty", () => {
    assert.equal(migrateSeasonsFile({ seasons: [] }), false);
  });

  it("idempotent across two passes", () => {
    const file: SeasonsFile = {
      seasons: [
        {
          slug: "may-2026",
          startedAt: 1,
          expectedEndAt: 100,
          categories: ["A"],
          questionsTypes: { boolean: 1 },
        },
      ],
    };
    assert.equal(migrateSeasonsFile(file), true);
    assert.equal(migrateSeasonsFile(file), false);
  });
});
