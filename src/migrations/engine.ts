import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { clackQuery } from "../claude/query.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { detectRuntime } from "../claude/utilities.js";
import type { Migration, StaticFileResult } from "./types.js";

export function getPendingMigrations(currentVersion: number, migrations: Migration[]): Migration[] {
  return migrations.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);
}

/**
 * Read all migration files into a path→content map.
 * Returns null for files that don't exist.
 */
async function readMigrationFiles(filePaths: string[]): Promise<Record<string, string | null>> {
  const contents: Record<string, string | null> = {};
  for (const filePath of filePaths) {
    if (existsSync(filePath)) {
      contents[filePath] = await readFile(filePath, "utf-8");
    } else {
      contents[filePath] = null;
    }
  }
  return contents;
}

/**
 * Apply static transform results: write file contents or delete files.
 */
async function applyStaticResults(
  results: Record<string, StaticFileResult>,
  migrationName: string,
): Promise<void> {
  for (const [filePath, result] of Object.entries(results)) {
    if (typeof result === "object" && "delete" in result && result.delete) {
      if (existsSync(filePath)) {
        await unlink(filePath);
        logger.info(`Migration "${migrationName}": deleted ${filePath}`);
      }
    } else if (typeof result === "string") {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(filePath, result);
    }
  }
}

export async function executeMigration(migration: Migration): Promise<void> {
  logger.info(`Executing migration: ${migration.name} (v${migration.version})`);

  const fileContents = await readMigrationFiles(migration.files);

  // --- Phase 1: Static transform ---
  let staticSucceeded = false;
  if (migration.static) {
    try {
      const results = migration.static(fileContents);
      await applyStaticResults(results, migration.name);
      staticSucceeded = true;
      logger.info(`Migration "${migration.name}": static transform completed`);
    } catch (err) {
      const errMsg = errorMessage(err);
      if (migration.prompt) {
        logger.warn(
          `Migration "${migration.name}": static transform failed (${errMsg}), falling back to Claude`,
        );
      } else {
        throw new Error(`Migration "${migration.name}" static transform failed: ${errMsg}`);
      }
    }
  }

  // --- Phase 2: Claude prompt (if defined and not skipped) ---
  const shouldRunClaude = migration.prompt && (!migration.static || !staticSucceeded);

  if (shouldRunClaude) {
    // Re-read files (they may have been modified by a partial static transform)
    const currentContents: string[] = [];
    for (const filePath of migration.files) {
      if (existsSync(filePath)) {
        const content = await readFile(filePath, "utf-8");
        currentContents.push(`--- ${filePath} ---\n${content}`);
      } else {
        currentContents.push(`--- ${filePath} --- (does not exist yet)`);
      }
    }

    const staticErrorContext =
      migration.static && !staticSucceeded
        ? `\n\nNote: The static transform for this migration failed. Please complete the migration manually by following the instructions below.`
        : "";

    const systemPrompt = `You are a migration tool for Clack, a self-hosted Slack bot.
You are executing migration "${migration.name}" (version ${migration.version}).

You have access to read and write ONLY these files:
${migration.files.map((f) => `- ${f}`).join("\n")}

Current file contents:
${currentContents.join("\n\n")}

Rules:
- Only modify the files listed above
- Make the minimum changes necessary
- Preserve existing data and formatting where possible
- If a file doesn't exist yet and needs to be created, write its full contents${
      migration.deleteAfter?.length
        ? `\n\nNote: The following files will be automatically deleted after you finish:\n${migration.deleteAfter.map((f) => `- ${f}`).join("\n")}\nYou do not need to clear or modify them.`
        : ""
    }${staticErrorContext}`;

    for await (const message of clackQuery({
      prompt: migration.prompt!,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        systemPrompt,
        model: "sonnet",
        permissionMode: "bypassPermissions",
        disallowedTools: ["Bash", "Task", "NotebookEdit", "Glob", "Grep"],
        maxTurns: 10,
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          logger.info(`Migration "${migration.name}" completed successfully`);
        } else {
          const errMsg = "errors" in message ? message.errors?.join(", ") : "Unknown error";
          throw new Error(`Migration "${migration.name}" failed: ${errMsg}`);
        }
      }
    }
  } else if (!migration.static && !migration.prompt) {
    throw new Error(`Migration "${migration.name}" has neither static nor prompt defined`);
  } else if (staticSucceeded) {
    logger.info(`Migration "${migration.name}" completed successfully (static only)`);
  }

  // --- Phase 3: Dedup + cleanup (unchanged) ---
  if (migration.dedupAgainst) {
    for (const [outputPath, defaultPath] of Object.entries(migration.dedupAgainst)) {
      const outputFull = resolve(process.cwd(), outputPath);
      const defaultFull = resolve(process.cwd(), defaultPath);
      if (existsSync(outputFull) && existsSync(defaultFull)) {
        const outputContent = (await readFile(outputFull, "utf-8")).trim();
        const defaultContent = (await readFile(defaultFull, "utf-8")).trim();
        if (outputContent === defaultContent) {
          await unlink(outputFull);
          logger.info(`Migration "${migration.name}": removed ${outputPath} (matches default)`);
        }
      }
    }
  }

  if (migration.deleteAfter) {
    for (const filePath of migration.deleteAfter) {
      const fullPath = resolve(process.cwd(), filePath);
      if (existsSync(fullPath)) {
        await unlink(fullPath);
        logger.info(`Migration "${migration.name}": deleted ${filePath}`);
      }
    }
  }
}
