import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import {
  readUsageLimits,
  recordUsageLimit,
  setUsageLimitsDeps,
  resetUsageLimitsDeps,
  type UsageLimitsDeps,
  type UsageLimitsState,
} from "./usageLimits.js";

const mockReadFile = vi.fn<(path: string, encoding: "utf-8") => Promise<string>>();
const mockWriteFile = vi.fn<(path: string, data: string) => Promise<void>>();
const mockMkdir = vi.fn<(path: string, opts: { recursive: boolean }) => Promise<void>>();
const mockFileExists = vi.fn<(path: string) => Promise<boolean>>();

function makeDeps(): UsageLimitsDeps {
  return {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    fileExists: mockFileExists,
  };
}

/** The parsed state handed to the most recent writeFile call. */
function lastWritten(): UsageLimitsState {
  const call = mockWriteFile.mock.calls.at(-1);
  assert.ok(call, "expected a writeFile call");
  const parsed: UsageLimitsState = JSON.parse(call[1]);
  return parsed;
}

/** Make the reader observe an existing on-disk state. */
function givenFile(state: UsageLimitsState): void {
  mockFileExists.mockImplementation(async () => true);
  mockReadFile.mockImplementation(async () => JSON.stringify(state));
}

beforeEach(() => {
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockMkdir.mockReset();
  mockFileExists.mockReset();

  mockFileExists.mockImplementation(async () => false);
  mockReadFile.mockImplementation(async () => "{}");
  mockWriteFile.mockImplementation(async () => {});
  mockMkdir.mockImplementation(async () => {});

  resetUsageLimitsDeps();
  setUsageLimitsDeps(makeDeps());
});

afterEach(() => {
  resetUsageLimitsDeps();
});

function info(overrides: Partial<SDKRateLimitInfo> = {}): SDKRateLimitInfo {
  return { status: "allowed", ...overrides };
}

const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z").getTime();

describe("readUsageLimits", () => {
  it("returns {} when the file is absent", async () => {
    assert.deepEqual(await readUsageLimits(), {});
  });

  it("returns {} and does not throw on malformed JSON", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => "not json {");
    assert.deepEqual(await readUsageLimits(), {});
  });

  it("returns {} on a shape that fails validation", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () =>
      JSON.stringify({ five_hour: { utilization: "lots" } }),
    );
    assert.deepEqual(await readUsageLimits(), {});
  });

  it("round-trips a valid stored state", async () => {
    givenFile({ five_hour: { status: "allowed", utilization: 0.5, resetsAt: 100, observedAt: 5 } });
    const state = await readUsageLimits();
    assert.deepEqual(state.five_hour, {
      status: "allowed",
      utilization: 0.5,
      resetsAt: 100,
      observedAt: 5,
    });
  });

  it("retains an entry missing observedAt", async () => {
    givenFile({ seven_day: { status: "allowed", utilization: 0.2, resetsAt: 999 } });
    const state = await readUsageLimits();
    assert.deepEqual(state.seven_day, { status: "allowed", utilization: 0.2, resetsAt: 999 });
  });
});

describe("recordUsageLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps observedAt at write time", async () => {
    await recordUsageLimit(info({ rateLimitType: "five_hour", utilization: 0.3, resetsAt: 42 }));
    assert.equal(lastWritten().five_hour?.observedAt, FIXED_NOW);
  });

  it("ignores a snapshot with no rateLimitType (no window identity)", async () => {
    await recordUsageLimit(info({ utilization: 0.9 }));
    assert.equal(mockWriteFile.mock.calls.length, 0);
  });

  it("preserves other windows when recording a new one", async () => {
    givenFile({ five_hour: { status: "allowed", utilization: 0.5, observedAt: 1 } });
    await recordUsageLimit(info({ rateLimitType: "seven_day", utilization: 0.1, resetsAt: 7 }));
    const written = lastWritten();
    assert.ok(written.five_hour, "existing five_hour window survives");
    assert.ok(written.seven_day, "new seven_day window is added");
  });

  it("serializes concurrent writes so both windows survive", async () => {
    await Promise.all([
      recordUsageLimit(info({ rateLimitType: "five_hour", utilization: 0.3 })),
      recordUsageLimit(info({ rateLimitType: "seven_day", utilization: 0.6 })),
    ]);
    const written = lastWritten();
    assert.ok(written.five_hour, "five_hour survives the interleaving");
    assert.ok(written.seven_day, "seven_day survives the interleaving");
  });

  it("replaces the same window with a newer reading", async () => {
    givenFile({ five_hour: { status: "allowed", utilization: 0.2, observedAt: 1 } });
    await recordUsageLimit(info({ rateLimitType: "five_hour", utilization: 0.8, resetsAt: 55 }));
    const written = lastWritten();
    assert.equal(written.five_hour?.utilization, 0.8);
    assert.equal(written.five_hour?.resetsAt, 55);
  });

  it("persists overage fields when present", async () => {
    await recordUsageLimit(
      info({
        rateLimitType: "overage",
        status: "allowed_warning",
        overageStatus: "allowed_warning",
        isUsingOverage: true,
      }),
    );
    assert.deepEqual(lastWritten().overage, {
      status: "allowed_warning",
      observedAt: FIXED_NOW,
      overageStatus: "allowed_warning",
      isUsingOverage: true,
    });
  });
});
