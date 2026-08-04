import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deriveReminderCron } from "./deriveReminderCron.js";
import { setTriviaLogger, _resetTriviaLogger } from "../core/pluginLogger.js";
import type { PluginLogger } from "../../../plugins-sdk/sdk.js";

describe("deriveReminderCron", () => {
  let mockLogger: PluginLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    setTriviaLogger(mockLogger);
  });

  afterEach(() => {
    _resetTriviaLogger();
  });

  it("shifts a single-digit hour back by 1", () => {
    const result = deriveReminderCron("0 5 * * *");
    expect(result).toBe("0 4 * * *");
  });

  it("shifts a double-digit hour back by 1", () => {
    const result = deriveReminderCron("0 18 * * 1-5");
    expect(result).toBe("0 17 * * 1-5");
  });

  it("preserves minute, dom, mon, dow fields verbatim", () => {
    const result = deriveReminderCron("30 14 15 6 3");
    expect(result).toBe("30 13 15 6 3");
  });

  it("rejects hour field 0 and returns null with warning", () => {
    const result = deriveReminderCron("30 0 * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("hour field 0 is outside valid range 1-23"),
    );
  });

  it("rejects hour field > 23 and returns null with warning", () => {
    const result = deriveReminderCron("0 24 * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("hour field 24 is outside valid range 1-23"),
    );
  });

  it("rejects wildcard hour field and returns null with warning", () => {
    const result = deriveReminderCron("0 * * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('hour field "*" is not a single integer'),
    );
  });

  it("rejects list hour field and returns null with warning", () => {
    const result = deriveReminderCron("0 9,17 * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('hour field "9,17" is not a single integer'),
    );
  });

  it("rejects range hour field and returns null with warning", () => {
    const result = deriveReminderCron("0 8-10 * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('hour field "8-10" is not a single integer'),
    );
  });

  it("rejects step hour field and returns null with warning", () => {
    const result = deriveReminderCron("0 */2 * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('hour field "*/2" is not a single integer'),
    );
  });

  it("rejects malformed cron with too few fields and returns null with warning", () => {
    const result = deriveReminderCron("0 10 * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("expected 5 cron fields"));
  });

  it("rejects malformed cron with too many fields and returns null with warning", () => {
    const result = deriveReminderCron("0 10 * * * *");
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("expected 5 cron fields"));
  });

  it("handles leading/trailing whitespace and multiple spaces between fields", () => {
    const result = deriveReminderCron("  0   10   *   *   *  ");
    expect(result).toBe("0 9 * * *");
  });

  it("shifts hour 23 to 22", () => {
    const result = deriveReminderCron("0 23 * * 0");
    expect(result).toBe("0 22 * * 0");
  });

  it("shifts hour 1 to 0", () => {
    const result = deriveReminderCron("0 1 * * *");
    expect(result).toBe("0 0 * * *");
  });
});
