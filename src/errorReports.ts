import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDataDir } from "./config.js";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { ConversationMessage } from "./claude/index.js";

export interface ErrorReport {
  sessionId: string;
  errorMessage: string;
  conversationTrace: ConversationMessage[];
  stderrOutput?: string;
  analysis?: string;
  timestamp: number;
}

function getErrorReportsDir(): string {
  return resolve(getDataDir(), "error-reports");
}

function getReportFilename(sessionId: string): string {
  return `${sessionId}-${Date.now()}.json`;
}

export async function writeErrorReport(report: ErrorReport): Promise<string> {
  const dir = getErrorReportsDir();
  await mkdir(dir, { recursive: true });

  const filename = getReportFilename(report.sessionId);
  const filepath = resolve(dir, filename);

  await writeFile(filepath, JSON.stringify(report, null, 2));
  logger.info(`Error report written: ${filename}`);

  return filepath;
}

export async function listErrorReports(): Promise<string[]> {
  const dir = getErrorReportsDir();
  if (!(await fileExists(dir))) return [];

  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
}

export async function readErrorReport(filename: string): Promise<ErrorReport | null> {
  const filepath = resolve(getErrorReportsDir(), filename);
  if (!(await fileExists(filepath))) return null;

  try {
    const content = await readFile(filepath, "utf-8");
    return JSON.parse(content) as ErrorReport;
  } catch {
    logger.error(`Failed to read error report: ${filename}`);
    return null;
  }
}
