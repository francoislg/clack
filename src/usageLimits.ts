import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import { getStateDir } from "./config.js";
import { zodErrorToResult } from "./plugins/zodResult.js";

// ============================================================================
// Dependency Injection
// ============================================================================

// Narrow, honest signatures for exactly the I/O this module performs — so both the real fs
// functions and test doubles are directly assignable without casts.
export interface UsageLimitsDeps {
  readFile: (path: string, encoding: "utf-8") => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
}

export const defaultUsageLimitsDeps: UsageLimitsDeps = {
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, data) => writeFile(path, data),
  mkdir: async (path, opts) => {
    await mkdir(path, opts);
  },
  fileExists,
};

let deps: UsageLimitsDeps = defaultUsageLimitsDeps;

export function setUsageLimitsDeps(d: UsageLimitsDeps): void {
  deps = d;
}

export function resetUsageLimitsDeps(): void {
  deps = defaultUsageLimitsDeps;
  cached = null;
}

// ============================================================================
// Types + schema
// ============================================================================

/**
 * One Claude subscription rate-limit window's latest observed snapshot, captured from a
 * `rate_limit_event`'s `rate_limit_info` and stamped with when we saw it. All fields are
 * optional because the SDK marks them optional and because on-disk state may be partial/legacy.
 */
export interface UsageLimitWindow {
  /** The SDK's most recent status for this window. */
  status?: string;
  /** Fraction of the window consumed, 0–1. */
  utilization?: number;
  /** When the window refills, epoch SECONDS (as the SDK reports it). */
  resetsAt?: number;
  /** When we observed this snapshot, epoch MILLISECONDS (our own stamp). */
  observedAt?: number;
  overageStatus?: string;
  overageResetsAt?: number;
  isUsingOverage?: boolean;
}

/** Latest snapshot per `rateLimitType` (e.g. `five_hour`, `seven_day`). */
export type UsageLimitsState = Record<string, UsageLimitWindow>;

// Permissive by design: this is a graceful state reader. Unknown extra keys are stripped, but a
// window carrying a `rateLimitType` we don't have a label for is still retained and rendered with
// a fallback label. Never `.strict()` — a too-tight schema would silently wipe real state.
const usageLimitWindowZod = z.object({
  status: z.string().optional(),
  utilization: z.number().optional(),
  resetsAt: z.number().optional(),
  observedAt: z.number().optional(),
  overageStatus: z.string().optional(),
  overageResetsAt: z.number().optional(),
  isUsingOverage: z.boolean().optional(),
});

const usageLimitsStateZod = z.record(z.string(), usageLimitWindowZod).default({});

// ============================================================================
// Paths + cache
// ============================================================================

function getUsageLimitsPath(): string {
  return resolve(getStateDir(), "usage-limits.json");
}

let cached: UsageLimitsState | null = null;

/**
 * Read the persisted snapshot set. Graceful: a missing or malformed file logs and yields `{}`
 * rather than throwing, so neither the Home Tab nor a live run can be broken by bad state.
 */
export async function readUsageLimits(): Promise<UsageLimitsState> {
  if (cached) {
    return cached;
  }
  // A concurrent write (which sets `cached` authoritatively) may land while we await disk. Await
  // first, THEN apply `??=` synchronously so that fresher write wins over the stale bytes this
  // read started with — assigning `cached = await …` directly would clobber it.
  const loaded = await loadFromDisk();
  return (cached ??= loaded);
}

async function loadFromDisk(): Promise<UsageLimitsState> {
  const path = getUsageLimitsPath();
  if (!(await deps.fileExists(path))) {
    return {};
  }

  try {
    const content = await deps.readFile(path, "utf-8");
    const result = usageLimitsStateZod.safeParse(JSON.parse(content));
    if (!result.success) {
      logger.warn(
        `usage-limits.json has unexpected shape; using empty state: ${
          zodErrorToResult(result.error, "usageLimits").error
        }`,
      );
      return {};
    }
    return result.data;
  } catch (error) {
    logger.warn(`Failed to load usage-limits.json; using empty state: ${String(error)}`);
    return {};
  }
}

// Serialize read-modify-write so two concurrent runs recording different windows can't interleave
// and clobber each other — each window's latest snapshot must survive.
let writeChain: Promise<void> = Promise.resolve();

async function writeUsageLimits(state: UsageLimitsState): Promise<void> {
  const stateDir = getStateDir();
  if (!(await deps.fileExists(stateDir))) {
    await deps.mkdir(stateDir, { recursive: true });
  }
  await deps.writeFile(getUsageLimitsPath(), JSON.stringify(state, null, 2));
  cached = state;
}

/**
 * Record the latest snapshot for a single window, keyed by `rateLimitType`. A snapshot with no
 * `rateLimitType` has no window identity and is ignored. Merges over the existing store so other
 * windows are untouched; the observation is stamped with the current time.
 */
export async function recordUsageLimit(info: SDKRateLimitInfo): Promise<void> {
  const type = info.rateLimitType;
  if (!type) {
    return;
  }
  const observedAt = Date.now();

  const run = writeChain.then(async () => {
    const state = await readUsageLimits();
    const entry: UsageLimitWindow = {
      status: info.status,
      observedAt,
      ...(info.utilization !== undefined && { utilization: info.utilization }),
      ...(info.resetsAt !== undefined && { resetsAt: info.resetsAt }),
      ...(info.overageStatus !== undefined && { overageStatus: info.overageStatus }),
      ...(info.overageResetsAt !== undefined && { overageResetsAt: info.overageResetsAt }),
      ...(info.isUsingOverage !== undefined && { isUsingOverage: info.isUsingOverage }),
    };
    await writeUsageLimits({ ...state, [type]: entry });
  });

  // Advance the chain so a later record still runs even if this write rejects. The rejection is
  // not swallowed — it propagates through the returned `run` to this call's caller, which logs it.
  writeChain = run.catch((err) => {
    logger.debug(`usage-limit write in chain failed (surfaced to caller): ${String(err)}`);
  });
  return run;
}
