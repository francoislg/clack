import { z } from "zod";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import type { IdlerConfig, IdlerWindow } from "./types.js";

/** The SDK surface breaker I/O needs — narrowed so tests can supply a plain fake. */
export type BreakerSdk = Pick<ClackSdk, "readFile" | "writeFile">;

const BREAKER_PATH = "breaker.json";

const breakerStateSchema = z.object({
  windowKey: z.string().default(""),
  consecutiveEmpty: z.number().int().min(0).default(0),
  pendingAsync: z.array(z.string()).default([]),
});

export type BreakerState = z.infer<typeof breakerStateSchema>;

const ZERO_STATE: BreakerState = { windowKey: "", consecutiveEmpty: 0, pendingAsync: [] };

/** Graceful reader — malformed/missing state reads as zero state (never throws). */
export async function loadBreakerState(sdk: BreakerSdk): Promise<BreakerState> {
  const raw = await sdk.readFile(BREAKER_PATH);
  if (raw === null) return { ...ZERO_STATE };
  try {
    const result = breakerStateSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { ...ZERO_STATE };
  } catch {
    return { ...ZERO_STATE };
  }
}

export async function saveBreakerState(sdk: BreakerSdk, state: BreakerState): Promise<void> {
  await sdk.writeFile(BREAKER_PATH, JSON.stringify(state, null, 2));
}

export function windowKeyFor(window: IdlerWindow, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: window.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";

  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;

  const overnight = window.start > window.end;
  if (overnight && hour < window.end) {
    const d = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The breaker's trip status for the current window, or undefined when disabled
 * (stopAfterEmptyRounds <= 0). Stale state (windowKey != current) never trips and reports 0.
 */
export function evaluateBreaker(
  config: IdlerConfig,
  state: BreakerState,
  now: Date,
): { tripped: boolean; consecutiveEmpty: number; threshold: number } | undefined {
  const threshold = config.stopAfterEmptyRounds;
  if (threshold <= 0) return undefined;
  const key = windowKeyFor(config.workHours, now);
  const consecutiveEmpty = state.windowKey === key ? state.consecutiveEmpty : 0;
  return { tripped: consecutiveEmpty >= threshold, consecutiveEmpty, threshold };
}

export async function recordEmptyFire(
  sdk: BreakerSdk,
  window: IdlerWindow,
  now: Date,
): Promise<BreakerState> {
  const state = await loadBreakerState(sdk);
  const key = windowKeyFor(window, now);

  if (state.windowKey !== key) {
    const next: BreakerState = { windowKey: key, consecutiveEmpty: 1, pendingAsync: [] };
    await saveBreakerState(sdk, next);
    return next;
  }
  if (state.pendingAsync.length > 0) {
    // Freeze: the fire found nothing, but the idler's own async output is still expected.
    return state;
  }
  const next: BreakerState = { ...state, consecutiveEmpty: state.consecutiveEmpty + 1 };
  await saveBreakerState(sdk, next);
  return next;
}

/** Register a pending async trigger (e.g. "owner/repo#123") with set semantics; no counter change. */
export async function recordAsyncTriggered(
  sdk: BreakerSdk,
  window: IdlerWindow,
  now: Date,
  asyncKey: string,
): Promise<BreakerState> {
  const state = await loadBreakerState(sdk);
  const key = windowKeyFor(window, now);
  const base: BreakerState =
    state.windowKey === key ? state : { windowKey: key, consecutiveEmpty: 0, pendingAsync: [] };
  const pendingAsync = base.pendingAsync.includes(asyncKey)
    ? base.pendingAsync
    : [...base.pendingAsync, asyncKey];
  const next: BreakerState = { ...base, pendingAsync };
  await saveBreakerState(sdk, next);
  return next;
}

/** Lift the empty counter (sync surfaced work) — resets consecutiveEmpty but leaves pendingAsync. */
export async function recordLift(sdk: BreakerSdk): Promise<void> {
  const state = await loadBreakerState(sdk);
  if (state.consecutiveEmpty === 0) return;
  await saveBreakerState(sdk, { ...state, consecutiveEmpty: 0 });
}

export async function recordProductive(sdk: BreakerSdk): Promise<void> {
  const state = await loadBreakerState(sdk);
  if (state.consecutiveEmpty === 0 && state.pendingAsync.length === 0) return;
  await saveBreakerState(sdk, { ...state, consecutiveEmpty: 0, pendingAsync: [] });
}
