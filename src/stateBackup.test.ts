import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  stat,
  chmod,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runStateBackup,
  maybeBackupOnBoot,
  computeNextBackupTime,
  startStateBackupScheduler,
  stopStateBackupScheduler,
  type StateBackupDeps,
  type BackupLogger,
} from "./stateBackup.js";
import type { BackupConfig } from "./config.js";

interface CapturingLogger {
  info: Mock;
  warn: Mock;
  error: Mock;
}

function makeLogger(): CapturingLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let root: string;

function makeDeps(cfg: Partial<BackupConfig>, nowIso: string, log = makeLogger()): StateBackupDeps {
  const dataDir = join(root, "data");
  return {
    getBackupConfig: () => ({
      enabled: true,
      folders: ["state"],
      timezone: "America/Montreal",
      ...cfg,
    }),
    dataDir,
    backupsDir: join(dataDir, "backups"),
    now: () => new Date(nowIso),
    logger: log as BackupLogger,
  };
}

async function seedState(files: Record<string, string>, mode?: number): Promise<void> {
  const stateDir = join(root, "data", "state");
  await mkdir(stateDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const p = join(stateDir, name);
    await writeFile(p, content);
    if (mode !== undefined) await chmod(p, mode);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "state-backup-"));
});

afterEach(async () => {
  stopStateBackupScheduler();
  await rm(root, { recursive: true, force: true });
});

describe("runStateBackup", () => {
  it("writes a dated snapshot with identical content, leaving the source untouched", async () => {
    await seedState({ "roles.json": '{"a":1}', "cron-jobs.json": "[]" });
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");

    await runStateBackup(deps);

    const backedRoles = join(deps.backupsDir, "2026-07-10", "state", "roles.json");
    expect(await readFile(backedRoles, "utf-8")).toBe('{"a":1}');
    expect(
      await readFile(join(deps.backupsDir, "2026-07-10", "state", "cron-jobs.json"), "utf-8"),
    ).toBe("[]");
    expect(await readFile(join(root, "data", "state", "roles.json"), "utf-8")).toBe('{"a":1}');
  });

  it("preserves source file mode (600 stays 600) and creates dirs 0o700; never chown", async () => {
    await seedState({ "roles.json": "{}" }, 0o600);
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");

    await runStateBackup(deps);

    const fileMode =
      (await stat(join(deps.backupsDir, "2026-07-10", "state", "roles.json"))).mode & 0o777;
    const dirMode = (await stat(join(deps.backupsDir, "2026-07-10", "state"))).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it("does not follow symlinks and skips them; regular files still copied", async () => {
    await seedState({ "roles.json": "{}" });
    await writeFile(join(root, "data", "outside.txt"), "secret");
    await symlink(join(root, "data", "outside.txt"), join(root, "data", "state", "link.json"));
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");

    await runStateBackup(deps);

    const backedState = join(deps.backupsDir, "2026-07-10", "state");
    expect(await readdir(backedState)).toEqual(["roles.json"]);
  });

  it("skips a configured folder that does not exist, with a warning, and still succeeds", async () => {
    await seedState({ "roles.json": "{}" });
    const log = makeLogger();
    const deps = makeDeps(
      { folders: ["state", "configuration"] },
      "2026-07-10T12:00:00-04:00",
      log,
    );

    await runStateBackup(deps);

    expect(await exists(join(deps.backupsDir, "2026-07-10", "state", "roles.json"))).toBe(true);
    expect(await exists(join(deps.backupsDir, "2026-07-10", "configuration"))).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("configuration"));
  });

  it("reproduces multiple configured folders under the dated dir", async () => {
    await seedState({ "roles.json": "{}" });
    await mkdir(join(root, "data", "configuration"), { recursive: true });
    await writeFile(join(root, "data", "configuration", "x.md"), "hi");
    const deps = makeDeps({ folders: ["state", "configuration"] }, "2026-07-10T12:00:00-04:00");

    await runStateBackup(deps);

    expect(await exists(join(deps.backupsDir, "2026-07-10", "state", "roles.json"))).toBe(true);
    expect(
      await readFile(join(deps.backupsDir, "2026-07-10", "configuration", "x.md"), "utf-8"),
    ).toBe("hi");
  });

  it("is a no-op when disabled", async () => {
    await seedState({ "roles.json": "{}" });
    const deps = makeDeps({ enabled: false }, "2026-07-10T12:00:00-04:00");

    await runStateBackup(deps);

    expect(await exists(deps.backupsDir)).toBe(false);
  });
});

describe("atomicity + additivity", () => {
  it("removes a stale same-day .partial before staging (no merge)", async () => {
    await seedState({ "roles.json": '{"v":2}' });
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");
    const stale = join(deps.backupsDir, ".2026-07-10.partial", "state");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "ghost.json"), "stale");

    await runStateBackup(deps);

    const finalState = join(deps.backupsDir, "2026-07-10", "state");
    expect(await readdir(finalState)).toEqual(["roles.json"]);
    expect(await exists(join(deps.backupsDir, ".2026-07-10.partial"))).toBe(false);
  });

  it("replaces an existing same-day dir with a fresh complete copy", async () => {
    await seedState({ "roles.json": '{"v":"new"}' });
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");
    const finalState = join(deps.backupsDir, "2026-07-10", "state");
    await mkdir(finalState, { recursive: true });
    await writeFile(join(finalState, "old.json"), "old");

    await runStateBackup(deps);

    expect(await readdir(finalState)).toEqual(["roles.json"]);
    expect(await readFile(join(finalState, "roles.json"), "utf-8")).toBe('{"v":"new"}');
  });

  it("leaves a prior day's backup intact (never prunes)", async () => {
    await seedState({ "roles.json": "{}" });
    const yesterday = join(root, "data", "backups", "2026-07-09", "state");
    await mkdir(yesterday, { recursive: true });
    await writeFile(join(yesterday, "roles.json"), "yesterday");

    await runStateBackup(makeDeps({}, "2026-07-10T12:00:00-04:00"));

    expect(await readFile(join(yesterday, "roles.json"), "utf-8")).toBe("yesterday");
    expect(await exists(join(root, "data", "backups", "2026-07-10", "state"))).toBe(true);
  });
});

describe("failure isolation", () => {
  it("a copy error leaves no complete dated dir and is logged", async () => {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "state"), "not-a-dir");
    const log = makeLogger();
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00", log);

    await runStateBackup(deps);

    expect(await exists(join(deps.backupsDir, "2026-07-10"))).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("an invalid timezone is caught and skips the run", async () => {
    await seedState({ "roles.json": "{}" });
    const log = makeLogger();
    const deps = makeDeps({ timezone: "Not/AZone" }, "2026-07-10T12:00:00-04:00", log);

    await runStateBackup(deps);

    expect(await exists(deps.backupsDir)).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("maybeBackupOnBoot", () => {
  it("runs a backup when today's snapshot is missing", async () => {
    await seedState({ "roles.json": "{}" });
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");

    await maybeBackupOnBoot(deps);

    expect(await exists(join(deps.backupsDir, "2026-07-10", "state", "roles.json"))).toBe(true);
  });

  it("does not run when today's snapshot already exists", async () => {
    await seedState({ "roles.json": "fresh" });
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");
    const finalState = join(deps.backupsDir, "2026-07-10", "state");
    await mkdir(finalState, { recursive: true });
    await writeFile(join(finalState, "sentinel.json"), "kept");

    await maybeBackupOnBoot(deps);

    expect(await readdir(finalState)).toEqual(["sentinel.json"]);
  });
});

describe("computeNextBackupTime", () => {
  it("returns the next local midnight strictly after the given instant", () => {
    const next = computeNextBackupTime(new Date("2026-07-10T12:00:00-04:00"), "America/Montreal");
    expect(next.toISOString()).toBe(new Date("2026-07-11T00:00:00-04:00").toISOString());
  });

  it("fires once across a spring-forward DST day (no missed/duplicate midnight)", () => {
    const beforeDst = computeNextBackupTime(
      new Date("2026-03-07T12:00:00-05:00"),
      "America/Montreal",
    );
    expect(beforeDst.toISOString()).toBe(new Date("2026-03-08T00:00:00-05:00").toISOString());
    const afterMidnight = computeNextBackupTime(beforeDst, "America/Montreal");
    expect(afterMidnight.toISOString()).toBe(new Date("2026-03-09T00:00:00-04:00").toISOString());
  });

  it("fires once across a fall-back DST day (no missed/duplicate midnight)", () => {
    // Montreal fall-back: 2026-11-01 02:00 -> 01:00. Midnight is unaffected; the day is 25h.
    const beforeFallback = computeNextBackupTime(
      new Date("2026-10-31T12:00:00-04:00"),
      "America/Montreal",
    );
    expect(beforeFallback.toISOString()).toBe(new Date("2026-11-01T00:00:00-04:00").toISOString());
    const afterMidnight = computeNextBackupTime(beforeFallback, "America/Montreal");
    expect(afterMidnight.toISOString()).toBe(new Date("2026-11-02T00:00:00-05:00").toISOString());
  });
});

describe("run-in-flight guard", () => {
  it("skips a concurrent run with a warning and produces exactly one backup", async () => {
    await seedState({ "roles.json": "{}" });
    const log = makeLogger();
    const deps = makeDeps({}, "2026-07-10T12:00:00-04:00", log);

    // Two concurrent boot catch-ups: both pass the missing-dir check, but the second reaches
    // runGuarded while the first is still in flight, so it is skipped.
    await Promise.all([maybeBackupOnBoot(deps), maybeBackupOnBoot(deps)]);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("already in flight"));
    expect(await exists(join(deps.backupsDir, "2026-07-10", "state", "roles.json"))).toBe(true);
  });
});

describe("scheduler wiring", () => {
  it("arms a single timer when enabled and clears it on stop", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-10T12:00:00-04:00"));
      const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");
      // Pre-create today's dir so the background boot catch-up is a fast no-op.
      await mkdir(join(deps.backupsDir, "2026-07-10"), { recursive: true });
      deps.now = () => new Date();

      startStateBackupScheduler(deps);
      // The next-midnight timer is armed synchronously (boot catch-up runs independently).
      expect(vi.getTimerCount()).toBe(1);

      stopStateBackupScheduler();
      expect(vi.getTimerCount()).toBe(0);
      // Flush the background catch-up promise so it settles before teardown.
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm a timer when disabled", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-10T12:00:00-04:00"));
      const deps = makeDeps({ enabled: false }, "2026-07-10T12:00:00-04:00");
      startStateBackupScheduler(deps);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a double-start does not leak a timer (idempotent)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-10T12:00:00-04:00"));
      const deps = makeDeps({}, "2026-07-10T12:00:00-04:00");
      await mkdir(join(deps.backupsDir, "2026-07-10"), { recursive: true });
      deps.now = () => new Date();

      startStateBackupScheduler(deps);
      startStateBackupScheduler(deps);
      expect(vi.getTimerCount()).toBe(1);

      stopStateBackupScheduler();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm a timer when the timezone is invalid, and logs an error", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-10T12:00:00-04:00"));
      const log = makeLogger();
      const deps = makeDeps({ timezone: "Not/AZone" }, "2026-07-10T12:00:00-04:00", log);
      deps.now = () => new Date();

      startStateBackupScheduler(deps);
      expect(vi.getTimerCount()).toBe(0);
      expect(log.error).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
