import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Helpers — capture console output
// ---------------------------------------------------------------------------

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

let captured: { method: string; args: unknown[] }[];

function captureConsole() {
  captured = [];
  console.log = (...args: unknown[]) => captured.push({ method: "log", args });
  console.warn = (...args: unknown[]) => captured.push({ method: "warn", args });
  console.error = (...args: unknown[]) => captured.push({ method: "error", args });
}

function restoreConsole() {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
}

// ---------------------------------------------------------------------------
// logger — tests assume the default LOG_LEVEL (info) at import time
//
// Because the logger module evaluates LOG_LEVEL once at module load time and
// module mocking can only be set up once per module, we test the behavior at
// the default level. At LOG_LEVEL=info, debug is suppressed and info/warn/error
// are emitted.
// ---------------------------------------------------------------------------

describe("logger", () => {
  let savedLogLevel: string | undefined;

  beforeEach(() => {
    savedLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    captureConsole();
  });

  afterEach(() => {
    restoreConsole();
    if (savedLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = savedLogLevel;
    }
  });

  it("info logs to console.log with [INFO] prefix", () => {
    logger.info("hello", "world");

    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "log");
    assert.equal(captured[0].args[0], "[INFO]");
    assert.equal(captured[0].args[1], "hello");
    assert.equal(captured[0].args[2], "world");
  });

  it("warn logs to console.warn with [WARN] prefix", () => {
    logger.warn("caution");

    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "warn");
    assert.equal(captured[0].args[0], "[WARN]");
    assert.equal(captured[0].args[1], "caution");
  });

  it("error logs to console.error with [ERROR] prefix", () => {
    logger.error("failure", { code: 500 });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "error");
    assert.equal(captured[0].args[0], "[ERROR]");
    assert.equal(captured[0].args[1], "failure");
    assert.deepEqual(captured[0].args[2], { code: 500 });
  });

  it("debug is suppressed at default LOG_LEVEL=info", () => {
    // debug (level 0) < info (level 1), so it should not emit
    logger.debug("should not appear");

    assert.equal(captured.length, 0);
  });

  it("startup always logs with an ISO timestamp prefix", () => {
    logger.startup("booting up");

    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "log");
    // First arg should be an ISO timestamp wrapped in brackets: [2024-01-01T...]
    assert.match(captured[0].args[0] as string, /^\[\d{4}-\d{2}-\d{2}T/);
    assert.equal(captured[0].args[1], "booting up");
  });

  it("startup timestamp ends with a closing bracket", () => {
    logger.startup("test");

    const ts = captured[0].args[0] as string;
    assert.ok(ts.startsWith("["));
    assert.ok(ts.endsWith("]"));
  });

  it("info accepts multiple arguments", () => {
    logger.info("a", "b", "c", 42);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].args.length, 5); // [INFO], a, b, c, 42
    assert.equal(captured[0].args[4], 42);
  });

  it("error accepts multiple arguments", () => {
    logger.error("err", new Error("boom"));

    assert.equal(captured.length, 1);
    assert.equal(captured[0].args.length, 3); // [ERROR], err, Error
    assert.ok(captured[0].args[2] instanceof Error);
  });
});
