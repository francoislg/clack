import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Trivia type-axis split. Renames the legacy `type: "boolean" | "choice"` discriminator
 * to `answersFormat`, and stamps every existing question record with `questionType: "fact"`
 * (the implicit value of every pre-topical question). Mirrors the same rename on the
 * config-side `trivia.questionsTypes` → `trivia.answersFormat` and on every `SeasonEntry`
 * / `SeasonFormatSlot` `questionTypes` → `answersFormat`.
 *
 * After this migration, the on-disk shape carries two orthogonal axes:
 *   - `answersFormat: "boolean" | "choice"` — answer shape (renamed).
 *   - `questionType: "fact" | "topical"` — generation source (new; all pre-topical rows = "fact").
 *
 * Per-game discovery is dynamic — admins can configure any games — so the migration
 * scans `data/plugins/trivia/games/*` at run time via direct fs reads inside the static
 * function. Pure record-level transforms live as top-level functions for test reach.
 *
 * Idempotent: every transform is a no-op once the new shape is in place.
 */

const CONFIG_PATH = "data/config.json";
const TRIVIA_GAMES_DIR = "data/plugins/trivia/games";

interface TriviaConfigShape {
  questionsTypes?: Record<string, number>;
  answersFormat?: Record<string, number>;
  [k: string]: unknown;
}

interface ConfigShape {
  trivia?: TriviaConfigShape;
  [k: string]: unknown;
}

export interface QuestionRow {
  type?: string;
  answersFormat?: string;
  questionType?: string;
  [k: string]: unknown;
}

export interface SeasonSlot {
  questionTypes?: Record<string, number>;
  answersFormat?: Record<string, number>;
  [k: string]: unknown;
}

export interface SeasonEntry {
  questionsTypes?: Record<string, number>;
  questionTypes?: Record<string, number>;
  answersFormat?: Record<string, number>;
  format?: { questions?: SeasonSlot[] };
  [k: string]: unknown;
}

export interface SeasonsFile {
  seasons?: SeasonEntry[];
  [k: string]: unknown;
}

/**
 * Pure transform: apply the rename + questionType stamp to a single config blob.
 * Returns a `{ changed, value }` pair so callers can short-circuit when nothing
 * is needed. Treats absent `trivia` block as a no-op.
 */
export function migrateConfig(config: ConfigShape): { changed: boolean; value: ConfigShape } {
  if (!config.trivia || typeof config.trivia !== "object") {
    return { changed: false, value: config };
  }
  const trivia = config.trivia;
  if ("questionsTypes" in trivia && !("answersFormat" in trivia)) {
    trivia.answersFormat = trivia.questionsTypes;
    delete trivia.questionsTypes;
    return { changed: true, value: config };
  }
  if ("questionsTypes" in trivia && "answersFormat" in trivia) {
    delete trivia.questionsTypes;
    return { changed: true, value: config };
  }
  return { changed: false, value: config };
}

/**
 * Pure transform: rename `type` → `answersFormat` on a question record and
 * stamp `questionType: "fact"` (the implicit pre-topical value) when absent.
 * Legacy boolean rows that lack both `type` and `answersFormat` are stamped
 * with `answersFormat: "boolean"` to match the post-migration invariant
 * (every record carries `answersFormat`).
 */
export function migrateQuestionRow(input: QuestionRow): { changed: boolean; value: QuestionRow } {
  const row: QuestionRow = { ...input };
  let changed = false;

  if ("type" in row) {
    if (row.answersFormat === undefined) {
      row.answersFormat = row.type;
    }
    delete row.type;
    changed = true;
  }
  if (row.answersFormat === undefined) {
    row.answersFormat = "boolean";
    changed = true;
  }
  if (row.questionType === undefined) {
    row.questionType = "fact";
    changed = true;
  }

  return { changed, value: row };
}

/**
 * Pure transform: rename `questionsTypes` → `answersFormat` on a SeasonEntry,
 * and `questionTypes` → `answersFormat` on each SeasonFormatSlot within
 * `format.questions`.
 */
export function migrateSeasonEntry(entry: SeasonEntry): boolean {
  let changed = false;

  if ("questionsTypes" in entry && !("answersFormat" in entry)) {
    entry.answersFormat = entry.questionsTypes;
    delete entry.questionsTypes;
    changed = true;
  } else if ("questionsTypes" in entry && "answersFormat" in entry) {
    delete entry.questionsTypes;
    changed = true;
  }

  const slots = entry.format?.questions;
  if (Array.isArray(slots)) {
    for (const slot of slots) {
      if (typeof slot !== "object" || slot === null) continue;
      if ("questionTypes" in slot && !("answersFormat" in slot)) {
        slot.answersFormat = slot.questionTypes;
        delete slot.questionTypes;
        changed = true;
      } else if ("questionTypes" in slot && "answersFormat" in slot) {
        delete slot.questionTypes;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Pure transform: migrate every entry inside a seasons.json structure.
 */
export function migrateSeasonsFile(file: SeasonsFile): boolean {
  if (!Array.isArray(file.seasons)) return false;
  let changed = false;
  for (const entry of file.seasons) {
    if (typeof entry !== "object" || entry === null) continue;
    if (migrateSeasonEntry(entry)) changed = true;
  }
  return changed;
}

function listGameDirs(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const name of entries) {
    const full = join(rootDir, name);
    try {
      if (statSync(full).isDirectory()) dirs.push(name);
    } catch {
      // skip unreadable entries
    }
  }
  return dirs;
}

export const migration: Migration = {
  version: 21,
  name: "Trivia: rename type → answersFormat and stamp questionType: 'fact'",
  priority: "blocking",
  // The static function additionally enumerates `data/plugins/trivia/games/*` at run time
  // because game names are dynamic — mirrors the per-game discovery pattern from 019.
  files: [CONFIG_PATH],
  static: (files) => {
    const result: Record<string, StaticFileResult> = {};

    // 1. Config rename
    const configRaw = files[CONFIG_PATH];
    if (configRaw !== null) {
      try {
        const parsed: ConfigShape = JSON.parse(configRaw);
        const outcome = migrateConfig(parsed);
        if (outcome.changed) {
          result[CONFIG_PATH] = JSON.stringify(outcome.value, null, 2) + "\n";
        }
      } catch (err) {
        logger.warn(
          `[migration 021] Skipping config rename: malformed config.json (${
            err instanceof Error ? err.message : String(err)
          }).`,
        );
      }
    }

    // 2. Per-game questions.json + seasons.json
    for (const gameName of listGameDirs(TRIVIA_GAMES_DIR)) {
      const gameDir = join(TRIVIA_GAMES_DIR, gameName);

      // 2a. questions.json — array of question rows
      const qPath = join(gameDir, "questions.json");
      if (existsSync(qPath)) {
        try {
          const raw = readFileSync(qPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            let mutated = false;
            const migrated = parsed.map((row: unknown) => {
              if (typeof row !== "object" || row === null) return row;
              const outcome = migrateQuestionRow(row as QuestionRow);
              if (outcome.changed) mutated = true;
              return outcome.value;
            });
            if (mutated) {
              const trailing = raw.endsWith("\n") ? "\n" : "";
              result[qPath] = JSON.stringify(migrated, null, 2) + trailing;
            }
          }
        } catch (err) {
          logger.warn(
            `[migration 021] Skipping ${qPath}: malformed JSON (${
              err instanceof Error ? err.message : String(err)
            }).`,
          );
        }
      }

      // 2b. seasons.json — { seasons: SeasonEntry[] }
      const sPath = join(gameDir, "seasons.json");
      if (existsSync(sPath)) {
        try {
          const raw = readFileSync(sPath, "utf-8");
          const parsed: SeasonsFile = JSON.parse(raw);
          if (migrateSeasonsFile(parsed)) {
            const trailing = raw.endsWith("\n") ? "\n" : "";
            result[sPath] = JSON.stringify(parsed, null, 2) + trailing;
          }
        } catch (err) {
          logger.warn(
            `[migration 021] Skipping ${sPath}: malformed JSON (${
              err instanceof Error ? err.message : String(err)
            }).`,
          );
        }
      }
    }

    return result;
  },
};
