import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { detectRuntime } from "../claude/utilities.js";
import type { Migration } from "./types.js";

export function getPendingMigrations(
  currentVersion: number,
  migrations: Migration[]
): Migration[] {
  return migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
}

export async function executeMigration(migration: Migration): Promise<void> {
  const cwd = process.cwd();

  // Read current file contents for context
  const fileContents: string[] = [];
  for (const filePath of migration.files) {
    const fullPath = resolve(cwd, filePath);
    if (existsSync(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      fileContents.push(`--- ${filePath} ---\n${content}`);
    } else {
      fileContents.push(`--- ${filePath} --- (does not exist yet)`);
    }
  }

  const systemPrompt = `You are a migration tool for Clack, a self-hosted Slack bot.
You are executing migration "${migration.name}" (version ${migration.version}).

You have access to read and write ONLY these files:
${migration.files.map((f) => `- ${f}`).join("\n")}

Current file contents:
${fileContents.join("\n\n")}

Rules:
- Only modify the files listed above
- Make the minimum changes necessary
- Preserve existing data and formatting where possible
- If a file doesn't exist yet and needs to be created, write its full contents${
    migration.deleteAfter?.length
      ? `\n\nNote: The following files will be automatically deleted after you finish:\n${migration.deleteAfter.map((f) => `- ${f}`).join("\n")}\nYou do not need to clear or modify them.`
      : ""
  }`;

  logger.info(`Executing migration: ${migration.name} (v${migration.version})`);

  // Build allowed tools list scoped to the migration's files
  const allowedFiles = migration.files.map((f) => resolve(cwd, f));

  let lastAssistantText = "";

  for await (const message of query({
    prompt: migration.prompt,
    options: {
      cwd,
      executable: detectRuntime(),
      systemPrompt,
      model: "sonnet",
      permissionMode: "bypassPermissions",
      // Allow only file read/write tools
      disallowedTools: ["Bash", "Task", "NotebookEdit", "Glob", "Grep"],
      maxTurns: 10,
    },
  })) {
    if (message.type === "assistant" && message.message?.content) {
      lastAssistantText = "";
      for (const block of message.message.content) {
        if ("text" in block && typeof block.text === "string") {
          lastAssistantText += block.text;
        }
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        logger.info(`Migration "${migration.name}" completed successfully`);
      } else {
        const errorMessage =
          "errors" in message ? message.errors?.join(", ") : "Unknown error";
        throw new Error(
          `Migration "${migration.name}" failed: ${errorMessage}`
        );
      }
    }
  }

  // Dedup: remove output files that match their defaults
  if (migration.dedupAgainst) {
    for (const [outputPath, defaultPath] of Object.entries(
      migration.dedupAgainst
    )) {
      const outputFull = resolve(cwd, outputPath);
      const defaultFull = resolve(cwd, defaultPath);
      if (existsSync(outputFull) && existsSync(defaultFull)) {
        const outputContent = (await readFile(outputFull, "utf-8")).trim();
        const defaultContent = (await readFile(defaultFull, "utf-8")).trim();
        if (outputContent === defaultContent) {
          await unlink(outputFull);
          logger.info(
            `Migration "${migration.name}": removed ${outputPath} (matches default)`
          );
        }
      }
    }
  }

  // Delete files listed in deleteAfter (if any)
  if (migration.deleteAfter) {
    for (const filePath of migration.deleteAfter) {
      const fullPath = resolve(cwd, filePath);
      if (existsSync(fullPath)) {
        await unlink(fullPath);
        logger.info(`Migration "${migration.name}": deleted ${filePath}`);
      }
    }
  }
}
