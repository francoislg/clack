import { z } from "zod";

/**
 * The idler's execution bookkeeping, stored under `plugins.idler` on a core memory entry. Durable
 * knowledge (`what`, `references`) lives on the core entry; only execution state lives here.
 * Permissive defaults so a partial/legacy slice never fails the whole entry.
 */
export const idlerSlotSchema = z.object({
  priority: z.number().default(0),
  open: z.boolean().default(true),
  whereWeAre: z.string().default(""),
  /** Per-reference idempotency cursors, keyed by reference id. */
  cursorsByRefId: z.record(z.string(), z.string()).default({}),
  /**
   * Snapshot of the entry's `updatedAt` taken when the memory scan triaged it as not-idler-work.
   * The entry re-qualifies for the scan once a content write advances `updatedAt` past this value
   * (so it stays ignored while they remain equal). Absent on tracked work units.
   */
  ignoredAt: z.string().optional(),
});

export type IdlerSlot = z.infer<typeof idlerSlotSchema>;

/** Parse a raw `plugins.idler` value into a slice, or null when absent/invalid. */
export function parseSlot(raw: unknown): IdlerSlot | null {
  if (raw === undefined || raw === null) return null;
  const result = idlerSlotSchema.safeParse(raw);
  return result.success ? result.data : null;
}
