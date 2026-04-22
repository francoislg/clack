import { readFileSync } from "node:fs";
import { z } from "zod";
import { resolveInstructionFile } from "../../instructions.js";
import { logger } from "../../logger.js";

export const DEFAULT_RETRY_BUDGET = 3;
export const DEFAULT_TIMEOUT_SECONDS = 300;

const checkSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  timeoutSeconds: z.number().positive().finite().default(DEFAULT_TIMEOUT_SECONDS),
});

const configSchema = z.object({
  checks: z.array(checkSchema),
  retryBudget: z.number().int().positive().default(DEFAULT_RETRY_BUDGET),
});

export type VerificationCheck = z.infer<typeof checkSchema>;
export type VerificationConfig = z.infer<typeof configSchema>;

export type ReadTextFile = (path: string) => string;

export interface LoadVerificationConfigDeps {
  resolveInstructionFile: typeof resolveInstructionFile;
  readTextFile: ReadTextFile;
}

export const defaultLoadVerificationConfigDeps: LoadVerificationConfigDeps = {
  resolveInstructionFile,
  readTextFile: (path: string) => readFileSync(path, "utf-8"),
};

export function loadVerificationConfig(
  repoName: string,
  deps: LoadVerificationConfigDeps = defaultLoadVerificationConfigDeps,
): VerificationConfig | null {
  const path = deps.resolveInstructionFile(`${repoName}/verification_checks.json`);
  if (!path) {
    return null;
  }

  let raw: string;
  try {
    raw = deps.readTextFile(path);
  } catch (err) {
    logger.warn(`Failed to read verification config at ${path}: ${String(err)}`);
    return null;
  }

  let parsedJson: ReturnType<typeof JSON.parse>;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    logger.warn(`Invalid JSON in verification config at ${path}: ${String(err)}`);
    return null;
  }

  const result = configSchema.safeParse(parsedJson);
  if (!result.success) {
    logger.warn(`Invalid verification config at ${path}: ${result.error.message}`);
    return null;
  }
  return result.data;
}
