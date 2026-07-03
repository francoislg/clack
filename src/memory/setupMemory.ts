import { getMemory } from "../memoryRegistry.js";
import { logger } from "../logger.js";

/**
 * Learned repo-setup memory: one living entry per repo per run kind, keyed
 * `worker-setup:<repo>` / `tester-setup:<repo>`. Runs rewrite the entry via the
 * `remember` tool (replace semantics — the entry always holds the current full
 * recipe); prompt assembly injects it as advisory notes through this module.
 */

export type SetupRunKind = "worker" | "tester";

export function setupMemoryId(kind: SetupRunKind, repoName: string): string {
  return `${kind}-setup:${repoName}`;
}

export interface LoadedSetupNotes {
  notes: string;
  updatedAt: string;
}

/**
 * Fetch the learned setup notes for a repo/run kind, or null when there are none.
 * A missing entry, an empty `what`, or a store failure is the normal cold-run path —
 * never throws, so prompt assembly degrades to a run without notes.
 */
export async function loadSetupNotes(
  kind: SetupRunKind,
  repoName: string,
): Promise<LoadedSetupNotes | null> {
  try {
    const entry = await getMemory(setupMemoryId(kind, repoName));
    if (!entry) return null;
    const notes = entry.what.trim();
    return notes ? { notes, updatedAt: entry.updatedAt } : null;
  } catch (error) {
    logger.warn(`Failed to load ${kind} setup notes for '${repoName}': ${error}`);
    return null;
  }
}

/**
 * One execution-log line per run stating the injection outcome, so a cold run is
 * distinguishable from a logging gap and stale notes are visible by their age.
 */
export function setupNotesLogLine(loaded: LoadedSetupNotes | null): string {
  return loaded
    ? `Setup notes: injected (${loaded.notes.length} chars, updated ${loaded.updatedAt})`
    : "Setup notes: none (cold run)";
}

/**
 * Render the setup-memory prompt sections: the advisory notes section (when notes
 * exist) followed by the record/verify/rewrite directive (always).
 */
export function buildSetupMemoryPromptSections(
  kind: SetupRunKind,
  repoName: string,
  notes: string | null,
): string {
  const notesSection = notes ? buildSetupNotesSection(notes) : "";
  return notesSection + buildSetupMemoryDirective(kind, repoName);
}

function buildSetupNotesSection(notes: string): string {
  return `\n\nNOTES FROM PREVIOUS RUNS (advisory — learned repo setup):\n${notes}`;
}

/**
 * The record/verify/rewrite directive that keeps the setup entry a living document:
 * start from the notes, trust the repo over them on conflict, and rewrite the whole
 * entry at end of run when anything changed.
 */
function buildSetupMemoryDirective(kind: SetupRunKind, repoName: string): string {
  const id = setupMemoryId(kind, repoName);
  const sibling = setupMemoryId(kind === "worker" ? "tester" : "worker", repoName);
  return `

REPO SETUP MEMORY:
Clack keeps one living memory entry describing how to set this repo's workspace up, keyed "${id}". If a NOTES FROM PREVIOUS RUNS section appears above, start from it — but the notes describe the repo as it was LAST SEEN, and operator-provided instruction sections always take precedence over them. When a noted step fails or conflicts with the repository's actual state, trust the repository: re-read the doc sources the notes cite (README, CONTRIBUTING, docs/, manifests), repair the step, and update the doc pointers alongside it.
At the end of the run, if you learned anything a fresh run would need — setup steps, prerequisites, quirks — or corrected anything, rewrite the entry with the remember tool: id "${id}", what = the CURRENT full recipe as markdown with sections "## Services" (name → boot command, port, depends-on), "## Prerequisites" (env files, docker deps, build-first packages), "## Doc sources" (files the steps were derived from — re-check these on failure), "## Quirks". The full recipe body goes in \`what\` — even though the remember schema's usual convention is a one-line statement — never in \`why\` or \`nextSteps\`, and never split across fields; one call carries the complete entry. Do not set staleAfter. Rewrite the whole recipe, never append deltas — corrections and removals matter as much as additions; the entry must always read as the clean recipe as of today. Optionally cross-link the sibling view via linkedMemories: [{ id: "${sibling}", reason: "same repo, other run kind" }]. If nothing changed, skip the rewrite.`;
}
