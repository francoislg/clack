import { listMemory } from "../memoryRegistry.js";
import { canAccessMemory } from "../permissions.js";
import type { UserRole } from "../roles.js";

/**
 * The namespace of a memory id is the segment before its first `:` (`clack-pr:pr-4499` → `clack-pr`,
 * `fun:dad-joke-1` → `fun`). Ids with no `:` have no namespace and are skipped — they carry no "kind"
 * to advertise. This is the ONLY convention that defines a tracked kind, so any new namespace a caller
 * remembers under surfaces automatically with no code change.
 */
export function namespaceOf(id: string): string | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  return id.slice(0, idx);
}

/** Distinct memory namespaces currently present in the store, sorted. */
export async function listTrackedKinds(): Promise<string[]> {
  const entries = await listMemory();
  const kinds = new Set<string>();
  for (const entry of entries) {
    const ns = namespaceOf(entry.id);
    if (ns) kinds.add(ns);
  }
  return [...kinds].sort();
}

/**
 * A system-prompt block naming what KINDS of things Clack is currently tracking in memory, derived
 * live from the store. Empty string when nothing is tracked — the section is then omitted entirely.
 * Names the kinds only (not the items); Claude uses `recall` to fetch specifics on demand.
 */
export async function buildTrackedMemoryKinds(): Promise<string> {
  const kinds = await listTrackedKinds();
  if (kinds.length === 0) return "";
  return [
    "## Currently tracked in memory",
    "",
    `Clack is tracking these kinds of things: ${kinds.join(", ")}.`,
    "When a request refers to one of these, call `recall` with its identifier or a keyword before acting — there may be prior context and next steps.",
  ].join("\n");
}

/**
 * The tracked-kinds block for a session held by `role`, or `""` when the role can't reach the
 * memory faculty (the prompt then carries no tracked-memory section). An absent role defaults to
 * `member`, matching the prompt builder's own default.
 */
export async function trackedMemoryKindsForRole(role: UserRole | undefined): Promise<string> {
  if (!canAccessMemory(role ?? "member")) return "";
  return buildTrackedMemoryKinds();
}
