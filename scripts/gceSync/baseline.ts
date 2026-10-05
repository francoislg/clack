import { z } from "zod";

/** Path → sha256 both sides last agreed on. Lives in the clone (`data/.gce-sync-baseline.json`). */
export type Baseline = ReadonlyMap<string, string>;

const baselineFileSchema = z.object({
  files: z.record(z.string(), z.string()),
});

/**
 * An absent, malformed, or mis-shaped file reads as an empty baseline — which classifies every
 * differing file as changed on both sides, the direction that never overwrites the VM.
 */
export function parseBaseline(text: string | undefined): { baseline: Baseline; warning?: string } {
  if (text === undefined) return { baseline: new Map() };
  let parsed: ReturnType<typeof baselineFileSchema.safeParse>;
  try {
    parsed = baselineFileSchema.safeParse(JSON.parse(text));
  } catch {
    return { baseline: new Map(), warning: "baseline is not valid JSON — treating as empty" };
  }
  if (!parsed.success) {
    return { baseline: new Map(), warning: "baseline has an unexpected shape — treating as empty" };
  }
  return { baseline: new Map(Object.entries(parsed.data.files)) };
}

export function serializeBaseline(baseline: Baseline): string {
  const files = Object.fromEntries([...baseline].sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ files }, null, 2)}\n`;
}

export function withAgreement(baseline: Baseline, agreed: ReadonlyMap<string, string>): Baseline {
  return new Map([...baseline, ...agreed]);
}
