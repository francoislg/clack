import { describe, it, expect } from "vitest";
import type { PullPlan, PushPlan } from "./plan.js";
import { formatPullPlan, formatPushPlan, localStamp } from "./report.js";

const emptyPull = (): PullPlan => ({
  create: [],
  replace: [],
  pendingPush: [],
  localOnly: [],
  inSync: [],
  agreed: new Map(),
});

const emptyPush = (): PushPlan => ({
  create: [],
  replace: [],
  skipped: [],
  refused: [],
  vmOnly: [],
  inSync: [],
  agreed: new Map(),
});

describe("formatPullPlan", () => {
  it("shows only the in-sync line for an empty plan", () => {
    expect(formatPullPlan(emptyPull())).toBe("✓ 0 file(s) in sync");
  });

  it("renders every section, with a backup suffix on edited replaces", () => {
    const plan: PullPlan = {
      ...emptyPull(),
      create: ["data/new"],
      replace: [
        { path: "data/edited", backup: true },
        { path: "data/fresh", backup: false },
      ],
      pendingPush: ["data/mine"],
      localOnly: ["data/only"],
      inSync: ["data/same"],
    };
    expect(formatPullPlan(plan)).toBe(
      [
        "✓ 1 file(s) in sync",
        "",
        "Create locally (1):",
        "  • data/new",
        "",
        "Replace locally (2):",
        "  • data/edited  [local copy backed up first — it had its own edits]",
        "  • data/fresh",
        "",
        "Kept — changed only locally, pending a push (1):",
        "  • data/mine",
        "",
        "Local only (1):",
        "  • data/only",
      ].join("\n"),
    );
  });
});

describe("formatPushPlan", () => {
  it("shows only the in-sync line for an empty plan", () => {
    expect(formatPushPlan(emptyPush())).toBe("✓ 0 file(s) in sync");
  });

  it("renders every section with the three reason labels", () => {
    const plan: PushPlan = {
      ...emptyPush(),
      create: ["data/new"],
      replace: ["data/repl"],
      refused: [
        { path: "data/r1", classification: "changed-local" },
        { path: "data/r2", classification: "changed-vm" },
        { path: "data/r3", classification: "changed-both" },
      ],
      skipped: [
        { path: "data/s1", classification: "changed-local" },
        { path: "data/s2", classification: "changed-vm" },
        { path: "data/s3", classification: "changed-both" },
      ],
      vmOnly: ["data/stale"],
    };
    expect(formatPushPlan(plan)).toBe(
      [
        "✓ 0 file(s) in sync",
        "",
        "Create on VM (1):",
        "  • data/new",
        "",
        "Replace on VM (1):",
        "  • data/repl",
        "",
        "Refused — the VM copy changed since the last sync; pull, re-apply, push again (3):",
        "  • data/r1  (only local changed)",
        "  • data/r2  (only the VM changed — pull first)",
        "  • data/r3  (changed on both sides or never synced — pull first)",
        "",
        "Not pushed — differs from the VM; name it with --overwrite to replace (3):",
        "  • data/s1  (only local changed)",
        "  • data/s2  (only the VM changed — pull first)",
        "  • data/s3  (changed on both sides or never synced — pull first)",
        "",
        "VM only — never deleted (1):",
        "  • data/stale",
      ].join("\n"),
    );
  });
});

describe("localStamp", () => {
  it("formats local time as YYYYMMDD-HHMMSS", () => {
    expect(localStamp(new Date(2026, 8, 22, 9, 5, 3))).toBe("20260922-090503");
  });
});
