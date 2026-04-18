import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";

// ============================================================================
// Types
// ============================================================================

export interface CronRun {
  executedAt: string;
  status: "success" | "error";
  /** Slack message timestamp — absent when delivery failed */
  responseTs?: string;
}

export interface CronJob {
  id: string;
  cronExpression: string;
  channel: string;
  /** What Claude does each tick */
  prompt: string;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
  oneShot?: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error";
  /**
   * Fully-qualified MCP tool names (e.g., `mcp__trivia__submit_answers`) that must be called during
   * this dynamic job's run before `submit_response` will be accepted. Ignored for static jobs.
   */
  requiredTools?: string[];
  /**
   * Name of a loaded Clack plugin this job is associated with. Currently informational —
   * the cron scheduler does not derive required-tools from this field (see
   * `computeEffectiveRequiredTools`); `requiredTools` above is the single source of truth.
   */
  plugin?: string;
  /** Recent execution history (most recent last, capped at {@link MAX_RUNS}) */
  runs?: CronRun[];
}

interface CronJobState {
  jobs: CronJob[];
}

// ============================================================================
// Storage
// ============================================================================

const DEFAULT_STATE: CronJobState = { jobs: [] };

let cached: CronJobState | null = null;

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getFilePath(): string {
  return resolve(getStateDir(), "cron-jobs.json");
}

export async function loadJobs(): Promise<CronJob[]> {
  if (cached) {
    return cached.jobs;
  }

  const filePath = getFilePath();

  if (!(await fileExists(filePath))) {
    cached = { ...DEFAULT_STATE, jobs: [] };
    return cached.jobs;
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<CronJobState>;
    cached = { jobs: parsed.jobs ?? [] };
    return cached.jobs;
  } catch (error) {
    logger.error("Failed to load cron jobs:", error);
    cached = { ...DEFAULT_STATE, jobs: [] };
    return cached.jobs;
  }
}

async function saveState(state: CronJobState): Promise<void> {
  const stateDir = getStateDir();
  const filePath = getFilePath();

  if (!(await fileExists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  await writeFile(filePath, JSON.stringify(state, null, 2));
  cached = state;
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function getJobs(): Promise<CronJob[]> {
  return loadJobs();
}

export async function getEnabledJobs(): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.enabled);
}

export async function getJob(jobId: string): Promise<CronJob | null> {
  const jobs = await loadJobs();
  return jobs.find((j) => j.id === jobId) ?? null;
}

export async function getJobsByUser(userId: string): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.createdBy === userId);
}

export async function getJobsByChannel(channelId: string): Promise<CronJob[]> {
  const jobs = await loadJobs();
  return jobs.filter((j) => j.channel === channelId);
}

export interface CreateCronJobParams {
  cronExpression: string;
  channel: string;
  prompt: string;
  createdBy: string;
  timezone: string;
  oneShot?: boolean;
  requiredTools?: string[];
  plugin?: string;
}

export async function createJob(params: CreateCronJobParams): Promise<CronJob> {
  const jobs = await loadJobs();
  const job: CronJob = {
    id: randomUUID().slice(0, 12),
    cronExpression: params.cronExpression,
    channel: params.channel,
    prompt: params.prompt,
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    enabled: true,
    timezone: params.timezone,
    ...(params.oneShot && { oneShot: true }),
    ...(params.requiredTools && params.requiredTools.length > 0
      ? { requiredTools: params.requiredTools }
      : {}),
    ...(params.plugin ? { plugin: params.plugin } : {}),
  };
  jobs.push(job);
  await saveState({ jobs });
  logger.info(`Cron job ${job.id} created for channel ${params.channel}`);
  return job;
}

export async function toggleJob(jobId: string): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  job.enabled = !job.enabled;
  await saveState({ jobs });
  logger.info(`Cron job ${jobId} ${job.enabled ? "enabled" : "disabled"}`);
  return job;
}

export interface UpdateCronJobParams {
  cronExpression?: string;
  channel?: string;
  prompt?: string;
  timezone?: string;
  oneShot?: boolean;
  /** Pass an empty array to clear; undefined leaves the field unchanged. */
  requiredTools?: string[];
  /** Pass empty string to clear; undefined leaves the field unchanged. */
  plugin?: string;
}

export async function updateJob(
  jobId: string,
  params: UpdateCronJobParams,
): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  if (params.cronExpression !== undefined) job.cronExpression = params.cronExpression;
  if (params.channel !== undefined) job.channel = params.channel;
  if (params.prompt !== undefined) job.prompt = params.prompt;
  if (params.timezone !== undefined) job.timezone = params.timezone;
  if (params.oneShot !== undefined) job.oneShot = params.oneShot || undefined;
  if (params.requiredTools !== undefined) {
    job.requiredTools = params.requiredTools.length > 0 ? params.requiredTools : undefined;
  }
  if (params.plugin !== undefined) {
    job.plugin = params.plugin.length > 0 ? params.plugin : undefined;
  }

  await saveState({ jobs });
  logger.info(`Cron job ${jobId} updated`);
  return job;
}

export async function deleteJob(jobId: string): Promise<boolean> {
  const jobs = await loadJobs();
  const index = jobs.findIndex((j) => j.id === jobId);
  if (index === -1) return false;

  jobs.splice(index, 1);
  await saveState({ jobs });
  logger.info(`Cron job ${jobId} deleted`);
  return true;
}

export async function updateJobRunStatus(
  jobId: string,
  status: "success" | "error",
  responseTs?: string,
): Promise<void> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;

  const now = new Date().toISOString();
  job.lastRunAt = now;
  job.lastRunStatus = status;

  if (!job.runs) job.runs = [];
  job.runs.push({ executedAt: now, status, ...(responseTs ? { responseTs } : {}) });

  await saveState({ jobs });
}

// Clear cache (useful for testing)
export function clearCronJobsCache(): void {
  cached = null;
}
