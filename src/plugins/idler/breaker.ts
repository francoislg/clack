import { z } from "zod";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import type { IdlerWindow } from "./types.js";

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

export async function recordEmptyFire(
  sdk: BreakerSdk,
  window: IdlerWindow,
  now: Date,
): Promise<BreakerState> {
  const state = await loadBreakerState(sdk);
  const key = windowKeyFor(window, now);

  let next: BreakerState;
  if (state.windowKey === key) {
    next = { ...state, consecutiveEmpty: state.consecutiveEmpty + 1 };
  } else {
    next = { windowKey: key, consecutiveEmpty: 1, pendingAsync: [] };
  }

  await saveBreakerState(sdk, next);
  return next;
}

export async function recordProductive(sdk: BreakerSdk): Promise<void> {
  const state = await loadBreakerState(sdk);
  if (state.consecutiveEmpty === 0) return;
  await saveBreakerState(sdk, { ...state, consecutiveEmpty: 0 });
}
