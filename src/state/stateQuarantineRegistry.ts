import type { QuarantineEntry, QuarantineReport } from "./resilientCollection.js";

/**
 * A resilient store's self-description for the unified Home Tab "Quarantined state" panel. Each
 * migrated store registers one at module load. `storeId` is stable and travels in the action-button
 * value so Retry/Delete route back to the right store; `label` is the human-readable source name.
 */
export interface QuarantineStoreDescriptor {
  storeId: string;
  label: string;
  getSummaries: () => Promise<QuarantineEntry[]>;
  retry: (key: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (key: string) => Promise<boolean>;
  isFrozen: () => boolean;
}

const registry = new Map<string, QuarantineStoreDescriptor>();

export function registerQuarantineStore(descriptor: QuarantineStoreDescriptor): void {
  registry.set(descriptor.storeId, descriptor);
}

export function getQuarantineStores(): QuarantineStoreDescriptor[] {
  return [...registry.values()];
}

export function getQuarantineStore(storeId: string): QuarantineStoreDescriptor | undefined {
  return registry.get(storeId);
}

/** Clear all registered stores (test isolation). */
export function clearQuarantineStores(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Owner-notification sink — one global sink, fed by every store's load path.
// Kept here (a dependency-free leaf) so store modules never import the Slack layer directly.
// ---------------------------------------------------------------------------

let sink: ((report: QuarantineReport) => void) | null = null;

/** Wire (or clear, with `null`) the owner-notification sink. */
export function setStateQuarantineSink(fn: ((report: QuarantineReport) => void) | null): void {
  sink = fn;
}

/** Every store passes this as its `onQuarantine`; fans a quarantine/freeze report out to the sink. */
export function emitStateQuarantine(report: QuarantineReport): void {
  sink?.(report);
}
