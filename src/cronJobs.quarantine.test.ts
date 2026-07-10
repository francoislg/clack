import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getJobs,
  getEnabledJobs,
  toggleJob,
  createJob,
  clearCronJobsCache,
  isCronPersistenceFrozen,
  getQuarantinedJobSummaries,
  retryQuarantinedJob,
  deleteQuarantinedJob,
  setCronQuarantineNotifier,
  type CronQuarantineReport,
} from "./cronJobs.js";

interface SeededJob {
  id: string;
  cronExpression: string;
  prompt: string;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
  timezone: string;
}

// A structurally valid persisted job (all `cronJobZod`-required fields present).
function validJob(id: string): SeededJob {
  return {
    id,
    cronExpression: "0 9 * * *",
    prompt: "do a thing",
    createdBy: "U1",
    createdAt: "2026-01-01T00:00:00.000Z",
    enabled: true,
    timezone: "America/Montreal",
  };
}

const originalCwd = process.cwd;

describe("cronJobs quarantine + persistence freeze", () => {
  let tempDir: string;
  let reports: CronQuarantineReport[];

  function statePath(): string {
    return resolve(tempDir, "data", "state", "cron-jobs.json");
  }

  async function writeState(content: string): Promise<void> {
    await writeFile(statePath(), content);
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cron-quar-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    reports = [];
    setCronQuarantineNotifier((r) => reports.push(r));
    clearCronJobsCache();
  });

  afterEach(async () => {
    setCronQuarantineNotifier(null);
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  // The OLD loader whole-collection safeParse returned [] for this fixture, wiping every job.
  it("loads the valid jobs and quarantines the invalid one instead of wiping the collection", async () => {
    const invalid = {
      id: "bad",
      cronExpression: "0 9 * * *",
      prompt: "p",
      createdBy: "U1",
      createdAt: "2026-01-01T00:00:00.000Z",
      enabled: true,
    }; // missing timezone
    await writeState(JSON.stringify({ jobs: [validJob("a"), validJob("b"), invalid] }));

    const jobs = await getJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(jobs.find((j) => j.id === "bad")).toBeUndefined();

    const summaries = await getQuarantinedJobSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe("bad");
    expect(summaries[0].field).toBe("timezone");

    expect(reports).toHaveLength(1);
    expect(reports[0].quarantined).toHaveLength(1);
    expect(reports[0].frozen).toBeUndefined();
  });

  it("never returns a quarantined job from scheduler-facing queries", async () => {
    await writeState(JSON.stringify({ jobs: [validJob("a"), { id: "bad" }] }));
    const enabled = await getEnabledJobs();
    expect(enabled.map((j) => j.id)).toEqual(["a"]);
  });

  it("quarantines multiple invalid jobs at different positions, preserving order", async () => {
    await writeState(
      JSON.stringify({
        jobs: [{ id: "bad1" }, validJob("a"), { id: "bad2", cronExpression: 9 }, validJob("b")],
      }),
    );
    const jobs = await getJobs();
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);

    const summaries = await getQuarantinedJobSummaries();
    expect(summaries.map((s) => s.id)).toEqual(["bad1", "bad2"]);
  });

  it("does not re-notify the owner for the same quarantine on a later load", async () => {
    await writeState(JSON.stringify({ jobs: [validJob("a"), { id: "bad" }] }));
    await getJobs();
    expect(reports).toHaveLength(1);

    // The invalid job was persisted into quarantinedJobs on the first load, so a fresh load
    // (e.g. a restart) carries it silently instead of re-quarantining + re-DMing.
    clearCronJobsCache();
    await getJobs();
    expect(reports).toHaveLength(1);
  });

  it("resumes normal writes after the freeze clears on a repaired file", async () => {
    await writeState("still not json");
    await getJobs();
    expect(isCronPersistenceFrozen()).toBe(true);

    await writeState(JSON.stringify({ jobs: [validJob("a")] }));
    clearCronJobsCache();
    await getJobs();
    expect(isCronPersistenceFrozen()).toBe(false);

    await toggleJob("a");
    const onDisk = JSON.parse(await readFile(statePath(), "utf-8"));
    expect(onDisk.jobs[0].enabled).toBe(false);
  });

  it("round-trips quarantinedJobs through an unrelated save", async () => {
    await writeState(JSON.stringify({ jobs: [validJob("a"), { id: "bad" }] }));
    await getJobs();

    await toggleJob("a"); // unrelated save (like a plugin reconcile) — must NOT drop the quarantine

    const onDisk = JSON.parse(await readFile(statePath(), "utf-8"));
    expect(onDisk.jobs.map((j: { id: string }) => j.id)).toEqual(["a"]);
    expect(onDisk.quarantinedJobs).toHaveLength(1);
    expect(onDisk.quarantinedJobs[0].id).toBe("bad");
  });

  it("omits quarantinedJobs from clean files", async () => {
    await writeState(JSON.stringify({ jobs: [validJob("a")] }));
    await getJobs();
    await toggleJob("a");

    const onDisk = JSON.parse(await readFile(statePath(), "utf-8"));
    expect(onDisk).not.toHaveProperty("quarantinedJobs");
  });

  it("freezes persistence on a total parse failure without overwriting the original", async () => {
    await writeState("{ this is not valid json");

    const jobs = await getJobs();
    expect(jobs).toHaveLength(0);
    expect(isCronPersistenceFrozen()).toBe(true);

    // A corrupt snapshot was written…
    const files = await readdir(resolve(tempDir, "data", "state"));
    expect(files.some((f) => f.startsWith("cron-jobs.corrupt-"))).toBe(true);

    // …the owner was notified of the freeze…
    expect(reports.some((r) => r.frozen)).toBe(true);

    // …and a save attempt while frozen leaves the original file byte-for-byte intact.
    await createJob({
      name: "n",
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "p",
      createdBy: "U1",
      timezone: "America/Montreal",
    });
    expect(await readFile(statePath(), "utf-8")).toBe("{ this is not valid json");
  });

  it("re-arms the freeze across a restart while the file stays corrupt, then clears it on a clean load", async () => {
    await writeState("not json");
    await getJobs();
    expect(isCronPersistenceFrozen()).toBe(true);

    // Simulate a process restart: cache + freeze reset, file still corrupt → re-freeze.
    clearCronJobsCache();
    expect(isCronPersistenceFrozen()).toBe(false);
    await getJobs();
    expect(isCronPersistenceFrozen()).toBe(true);
    expect(await readFile(statePath(), "utf-8")).toBe("not json");

    // Repair the file and reload → freeze clears, writes resume.
    await writeState(JSON.stringify({ jobs: [validJob("a")] }));
    clearCronJobsCache();
    const jobs = await getJobs();
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
    expect(isCronPersistenceFrozen()).toBe(false);
  });

  it("retry restores a repaired quarantined job into the live set", async () => {
    // Seed a job directly in quarantinedJobs that now passes validation (schema loosened / hand-repaired).
    await writeState(
      JSON.stringify({ jobs: [validJob("a")], quarantinedJobs: [validJob("fixed")] }),
    );
    await getJobs();

    const result = await retryQuarantinedJob(0);
    expect(result.ok).toBe(true);

    const jobs = await getJobs();
    expect(jobs.map((j) => j.id).sort()).toEqual(["a", "fixed"]);
    expect(await getQuarantinedJobSummaries()).toHaveLength(0);

    const onDisk = JSON.parse(await readFile(statePath(), "utf-8"));
    expect(onDisk).not.toHaveProperty("quarantinedJobs");
  });

  it("retry keeps an unrepairable job quarantined and surfaces the error", async () => {
    await writeState(JSON.stringify({ jobs: [validJob("a")], quarantinedJobs: [{ id: "bad" }] }));
    await getJobs();

    const result = await retryQuarantinedJob(0);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(await getQuarantinedJobSummaries()).toHaveLength(1);
  });

  it("removes a quarantined job only via an explicit action and persists the result", async () => {
    await writeState(JSON.stringify({ jobs: [validJob("a")], quarantinedJobs: [{ id: "bad" }] }));
    await getJobs();

    expect(await deleteQuarantinedJob(0)).toBe(true);
    expect(await getQuarantinedJobSummaries()).toHaveLength(0);

    const onDisk = JSON.parse(await readFile(statePath(), "utf-8"));
    expect(onDisk).not.toHaveProperty("quarantinedJobs");
    expect(onDisk.jobs.map((j: { id: string }) => j.id)).toEqual(["a"]);
  });
});
