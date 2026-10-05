import type { DifferingClassification, PullPlan, PushPlan } from "./plan.js";

function bullet(path: string, suffix = ""): string {
  return `  • ${path}${suffix}`;
}

/** A header followed by its bullets, or nothing when the list is empty. */
function section(header: string, items: readonly string[]): string | undefined {
  if (items.length === 0) return undefined;
  return [header, ...items].join("\n");
}

/** The in-sync line plus every non-empty section, blocks separated by a blank line. */
function render(inSyncCount: number, sections: ReadonlyArray<string | undefined>): string {
  const blocks = [
    `✓ ${inSyncCount} file(s) in sync`,
    ...sections.filter((s): s is string => s !== undefined),
  ];
  return blocks.join("\n\n");
}

const BACKUP_SUFFIX = "  [local copy backed up first — it had its own edits]";

export function formatPullPlan(plan: PullPlan): string {
  return render(plan.inSync.length, [
    section(
      `Create locally (${plan.create.length}):`,
      plan.create.map((p) => bullet(p)),
    ),
    section(
      `Replace locally (${plan.replace.length}):`,
      plan.replace.map((r) => bullet(r.path, r.backup ? BACKUP_SUFFIX : "")),
    ),
    section(
      `Kept — changed only locally, pending a push (${plan.pendingPush.length}):`,
      plan.pendingPush.map((p) => bullet(p)),
    ),
    section(
      `Local only (${plan.localOnly.length}):`,
      plan.localOnly.map((p) => bullet(p)),
    ),
  ]);
}

function reasonFor(classification: DifferingClassification): string {
  switch (classification) {
    case "changed-local":
      return "  (only local changed)";
    case "changed-vm":
      return "  (only the VM changed — pull first)";
    case "changed-both":
      return "  (changed on both sides or never synced — pull first)";
  }
}

export function formatPushPlan(plan: PushPlan): string {
  return render(plan.inSync.length, [
    section(
      `Create on VM (${plan.create.length}):`,
      plan.create.map((p) => bullet(p)),
    ),
    section(
      `Replace on VM (${plan.replace.length}):`,
      plan.replace.map((p) => bullet(p)),
    ),
    section(
      `Refused — the VM copy changed since the last sync; pull, re-apply, push again (${plan.refused.length}):`,
      plan.refused.map((f) => bullet(f.path, reasonFor(f.classification))),
    ),
    section(
      `Not pushed — differs from the VM; name it with --overwrite to replace (${plan.skipped.length}):`,
      plan.skipped.map((f) => bullet(f.path, reasonFor(f.classification))),
    ),
    section(
      `VM only — never deleted (${plan.vmOnly.length}):`,
      plan.vmOnly.map((p) => bullet(p)),
    ),
  ]);
}

/** Local-time `YYYYMMDD-HHMMSS`, used to name backup folders. */
export function localStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
