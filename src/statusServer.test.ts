import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildStatus, createStatusHandler, type StatusDeps } from "./statusServer.js";

function makeDeps(overrides: Partial<StatusDeps> = {}): StatusDeps {
  return {
    activeRuns: () => ({ count: 0, runs: [] }),
    runningChanges: () => ({ active: 0, changes: [] }),
    uptimeSec: () => 0,
    version: "9.9.9",
    ...overrides,
  };
}

/** Capture a handler's response without binding a socket. */
function invoke(handler: ReturnType<typeof createStatusHandler>, method: string, url: string) {
  let status = 0;
  let body = "";
  handler(
    { method, url },
    {
      writeHead: (s) => {
        status = s;
      },
      end: (b) => {
        body = b;
      },
    },
  );
  return { status, body };
}

describe("buildStatus", () => {
  it("reports not busy when nothing is in flight", () => {
    const s = buildStatus(makeDeps());
    assert.equal(s.busy, false);
    assert.equal(s.activeRuns.count, 0);
    assert.equal(s.workers.active, 0);
    assert.equal(s.version, "9.9.9");
  });

  it("is busy when a query run is active", () => {
    const s = buildStatus(
      makeDeps({
        activeRuns: () => ({
          count: 1,
          runs: [{ channel: "C1", thread: "T1", status: "running", ageMs: 1200 }],
        }),
      }),
    );
    assert.equal(s.busy, true);
    assert.equal(s.activeRuns.runs[0].ageMs, 1200);
  });

  it("is busy when a Changes-Workflow run is executing", () => {
    const s = buildStatus(
      makeDeps({
        runningChanges: () => ({
          active: 1,
          changes: [{ repo: "org/repo", branch: "feat/x", status: "executing", ageMs: 500 }],
        }),
      }),
    );
    assert.equal(s.busy, true);
    assert.equal(s.workers.active, 1);
  });

  it("is busy when both a query run and a change are active", () => {
    const s = buildStatus(
      makeDeps({
        activeRuns: () => ({
          count: 1,
          runs: [{ channel: "C1", thread: "T1", status: "running", ageMs: 10 }],
        }),
        runningChanges: () => ({
          active: 1,
          changes: [{ repo: "org/repo", branch: "feat/x", status: "executing", ageMs: 20 }],
        }),
      }),
    );
    assert.equal(s.busy, true);
    assert.equal(s.activeRuns.count, 1);
    assert.equal(s.workers.active, 1);
  });

  it("floors uptimeSec", () => {
    assert.equal(buildStatus(makeDeps({ uptimeSec: () => 12.9 })).uptimeSec, 12);
  });
});

describe("status handler routing", () => {
  it("serves GET /status as JSON", () => {
    const handler = createStatusHandler(makeDeps());
    const res = invoke(handler, "GET", "/status");
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.busy, false);
    assert.equal(parsed.version, "9.9.9");
  });

  it("ignores the query string on /status", () => {
    const handler = createStatusHandler(makeDeps());
    assert.equal(invoke(handler, "GET", "/status?pretty=1").status, 200);
  });

  it("404s other paths", () => {
    const handler = createStatusHandler(makeDeps());
    assert.equal(invoke(handler, "GET", "/").status, 404);
    assert.equal(invoke(handler, "GET", "/health").status, 404);
  });

  it("404s non-GET methods on /status", () => {
    const handler = createStatusHandler(makeDeps());
    assert.equal(invoke(handler, "POST", "/status").status, 404);
  });

  it("recomputes per request", () => {
    let count = 2;
    const handler = createStatusHandler(makeDeps({ activeRuns: () => ({ count, runs: [] }) }));
    assert.equal(JSON.parse(invoke(handler, "GET", "/status").body).busy, true);
    count = 0;
    assert.equal(JSON.parse(invoke(handler, "GET", "/status").body).busy, false);
  });
});
