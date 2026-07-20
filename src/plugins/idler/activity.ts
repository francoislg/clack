import { z } from "zod";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";

/** The SDK surface activity I/O needs — narrowed so tests can supply a plain fake. */
export type ActivitySdk = Pick<ClackSdk, "readFile" | "writeFile">;

const ACTIVITY_PATH = "activity.json";

const entrySchema = z.object({
  /** ISO timestamp the action was logged (caller-stamped — scripts have no clock). */
  at: z.string(),
  kind: z.enum(["pr_opened", "comments_addressed", "review", "approval", "parked", "failure"]),
  /** Unit key the action relates to, when applicable. */
  unitKey: z.string().optional(),
  /** One-line human-readable detail for the digest (PR url, reason parked, error, …). */
  detail: z.string(),
});

const activitySchema = z.object({
  entries: z.array(entrySchema).default([]),
});

export type IdlerActivityEntry = z.infer<typeof entrySchema>;
export type IdlerActivity = z.infer<typeof activitySchema>;

/** Graceful reader — malformed/missing log reads as empty (never throws). */
export async function loadActivity(sdk: ActivitySdk): Promise<IdlerActivity> {
  const raw = await sdk.readFile(ACTIVITY_PATH);
  if (raw === null) return { entries: [] };
  try {
    const result = activitySchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

export async function appendActivity(sdk: ActivitySdk, entry: IdlerActivityEntry): Promise<void> {
  const current = await loadActivity(sdk);
  const next: IdlerActivity = { entries: [...current.entries, entry] };
  await sdk.writeFile(ACTIVITY_PATH, JSON.stringify(next, null, 2));
}

/** Clear the log once the summary has consumed it, so the next window starts fresh. */
export async function clearActivity(sdk: ActivitySdk): Promise<void> {
  await sdk.writeFile(ACTIVITY_PATH, JSON.stringify({ entries: [] }, null, 2));
}
