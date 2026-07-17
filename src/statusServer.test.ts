import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  buildStatus,
  createStatusHandler,
  type PromptRenderParams,
  type StatusDeps,
} from "./statusServer.js";

function makeDeps(overrides: Partial<StatusDeps> = {}): StatusDeps {
  return {
    activeRuns: () => ({ count: 0, runs: [] }),
    runningChanges: () => ({ active: 0, changes: [] }),
    uptimeSec: () => 0,
    version: "9.9.9",
    renderSystemPrompt: vi.fn(() => "RENDERED PROMPT"),
    ...overrides,
  };
}

/** Capture a handler's response without binding a socket. */
function invoke(
  handler: ReturnType<typeof createStatusHandler>,
  method: string,
  url: string,
  headers?: Record<string, string>,
) {
  let status = 0;
  let body = "";
  handler(
    { method, url, headers },
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

const TOKEN = "s3cret";
const AUTH = { "x-status-token": TOKEN };

describe("prompt inspection endpoint", () => {
  it("serves GET /prompt as plain text with defaults (member, nothing enabled)", () => {
    const renderSystemPrompt = vi.fn((_params: PromptRenderParams) => "RENDERED PROMPT");
    const handler = createStatusHandler(makeDeps({ renderSystemPrompt }), TOKEN);
    const res = invoke(handler, "GET", "/prompt", AUTH);
    assert.equal(res.status, 200);
    assert.equal(res.body, "RENDERED PROMPT");
    assert.deepEqual(renderSystemPrompt.mock.calls[0]![0], {
      role: "member",
      changesWorkflowEnabled: false,
      workMode: false,
      preAttachedTopics: [],
    });
  });

  it("threads role, flags, and comma-separated topics from the query string", () => {
    const renderSystemPrompt = vi.fn((_params: PromptRenderParams) => "P");
    const handler = createStatusHandler(makeDeps({ renderSystemPrompt }), TOKEN);
    const res = invoke(
      handler,
      "GET",
      "/prompt?role=admin&changesWorkflow=1&workMode=1&topics=idler,%20trivia,",
      AUTH,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(renderSystemPrompt.mock.calls[0]![0], {
      role: "admin",
      changesWorkflowEnabled: true,
      workMode: true,
      preAttachedTopics: ["idler", "trivia"],
    });
  });

  it("400s an invalid role without rendering", () => {
    const renderSystemPrompt = vi.fn(() => "P");
    const handler = createStatusHandler(makeDeps({ renderSystemPrompt }), TOKEN);
    const res = invoke(handler, "GET", "/prompt?role=superuser", AUTH);
    assert.equal(res.status, 400);
    assert.match(JSON.parse(res.body).error, /invalid role/);
    assert.equal(renderSystemPrompt.mock.calls.length, 0);
  });

  it("500s with the error message when rendering throws", () => {
    const handler = createStatusHandler(
      makeDeps({
        renderSystemPrompt: () => {
          throw new Error("config not loaded");
        },
      }),
      TOKEN,
    );
    const res = invoke(handler, "GET", "/prompt", AUTH);
    assert.equal(res.status, 500);
    assert.match(JSON.parse(res.body).error, /config not loaded/);
  });

  it("404s non-GET methods on /prompt", () => {
    const handler = createStatusHandler(makeDeps(), TOKEN);
    assert.equal(invoke(handler, "POST", "/prompt", AUTH).status, 404);
  });
});

describe("prompt endpoint token gate", () => {
  it("is unavailable (404) when no token is configured", () => {
    const handler = createStatusHandler(makeDeps());
    const res = invoke(handler, "GET", "/prompt");
    assert.equal(res.status, 404);
    assert.match(JSON.parse(res.body).error, /STATUS_TOKEN/);
  });

  it("an empty configured token also disables it", () => {
    const handler = createStatusHandler(makeDeps(), "");
    assert.equal(invoke(handler, "GET", "/prompt").status, 404);
  });

  it("401s a missing or wrong token when one is configured", () => {
    const handler = createStatusHandler(makeDeps(), TOKEN);
    assert.equal(invoke(handler, "GET", "/prompt").status, 401);
    assert.equal(invoke(handler, "GET", "/prompt", { authorization: "Bearer nope" }).status, 401);
    assert.equal(invoke(handler, "GET", "/prompt", { "x-status-token": "nope" }).status, 401);
  });

  it("accepts Authorization: Bearer", () => {
    const handler = createStatusHandler(makeDeps(), TOKEN);
    const res = invoke(handler, "GET", "/prompt", { authorization: `Bearer ${TOKEN}` });
    assert.equal(res.status, 200);
    assert.equal(res.body, "RENDERED PROMPT");
  });

  it("/status stays open regardless of token config (deploy drain polling)", () => {
    for (const token of [undefined, TOKEN]) {
      const handler = createStatusHandler(makeDeps(), token);
      assert.equal(invoke(handler, "GET", "/status").status, 200);
    }
  });
});
