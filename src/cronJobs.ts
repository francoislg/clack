import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";

// ============================================================================
// Types
// ============================================================================

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
}

export async function updateJob(jobId: string, params: UpdateCronJobParams): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  if (params.cronExpression !== undefined) job.cronExpression = params.cronExpression;
  if (params.channel !== undefined) job.channel = params.channel;
  if (params.prompt !== undefined) job.prompt = params.prompt;
  if (params.timezone !== undefined) job.timezone = params.timezone;
  if (params.oneShot !== undefined) job.oneShot = params.oneShot || undefined;

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
): Promise<void> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;

  job.lastRunAt = new Date().toISOString();
  job.lastRunStatus = status;
  await saveState({ jobs });
}

// Clear cache (useful for testing)
export function clearCronJobsCache(): void {
  cached = null;
}
