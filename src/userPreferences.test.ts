import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  loadPreferences,
  savePreferences,
  getUserPreference,
  setUserPreference,
  getReactionDelivery,
  clearPreferencesCache,
  setUserPreferencesDeps,
  type UserPreferencesDeps,
} from "./userPreferences.js";

// ---------------------------------------------------------------------------
// Mock deps
// ---------------------------------------------------------------------------

const mockReadFile = mock.fn<(path: string, encoding: string) => Promise<string>>();
const mockWriteFile = mock.fn<(path: string, data: string) => Promise<void>>();
const mockMkdir =
  mock.fn<(path: string, opts?: { recursive: boolean }) => Promise<string | undefined>>();
const mockFileExists = mock.fn<(path: string) => Promise<boolean>>();

function makeDeps(): UserPreferencesDeps {
  return {
    readFile: mockReadFile as never,
    writeFile: mockWriteFile as never,
    mkdir: mockMkdir as never,
    fileExists: mockFileExists as never,
  };
}

// ---------------------------------------------------------------------------
// loadPreferences
// ---------------------------------------------------------------------------

describe("loadPreferences", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockMkdir.mock.resetCalls();
    mockFileExists.mock.resetCalls();
    setUserPreferencesDeps(makeDeps());
  });

  it("returns {} when file doesn't exist", async () => {
    mockFileExists.mock.mockImplementation(async () => false);

    const result = await loadPreferences();

    assert.deepEqual(result, {});
  });

  it("reads and parses JSON when file exists", async () => {
    const stored = { U123: { reactionDelivery: "thread" } };
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify(stored));

    const result = await loadPreferences();

    assert.deepEqual(result, stored);
    assert.equal(mockReadFile.mock.callCount(), 1);
  });

  it("returns cached result on second call (readFile not called again)", async () => {
    const stored = { U456: { notifyOnResponse: true } };
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify(stored));

    const first = await loadPreferences();
    const second = await loadPreferences();

    assert.deepEqual(first, stored);
    assert.equal(first, second); // same reference
    assert.equal(mockReadFile.mock.callCount(), 1);
  });

  it("returns {} on parse error", async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => "not valid json {{{");

    const result = await loadPreferences();

    assert.deepEqual(result, {});
  });
});

// ---------------------------------------------------------------------------
// savePreferences
// ---------------------------------------------------------------------------

describe("savePreferences", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockMkdir.mock.resetCalls();
    mockFileExists.mock.resetCalls();
    setUserPreferencesDeps(makeDeps());
  });

  it("creates state dir if it doesn't exist", async () => {
    // First call checks state dir existence, return false
    mockFileExists.mock.mockImplementation(async () => false);
    mockMkdir.mock.mockImplementation(async () => undefined);
    mockWriteFile.mock.mockImplementation(async () => {});

    await savePreferences({ U1: { reactionDelivery: "thread" } });

    assert.equal(mockMkdir.mock.callCount(), 1);
    const mkdirArgs = mockMkdir.mock.calls[0].arguments;
    assert.ok((mkdirArgs[0] as string).endsWith("data/state"));
    assert.deepEqual(mkdirArgs[1], { recursive: true });
  });

  it("writes JSON and updates cache", async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockWriteFile.mock.mockImplementation(async () => {});

    const prefs = { U1: { notifyOnResponse: true as const } };
    await savePreferences(prefs);

    assert.equal(mockWriteFile.mock.callCount(), 1);
    const writeArgs = mockWriteFile.mock.calls[0].arguments;
    assert.equal(writeArgs[1], JSON.stringify(prefs, null, 2));

    // Cache should be updated — next loadPreferences should not read from disk
    mockReadFile.mock.resetCalls();
    const loaded = await loadPreferences();
    assert.deepEqual(loaded, prefs);
    assert.equal(mockReadFile.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// getUserPreference
// ---------------------------------------------------------------------------

describe("getUserPreference", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockMkdir.mock.resetCalls();
    mockFileExists.mock.resetCalls();
    setUserPreferencesDeps(makeDeps());
  });

  it("returns stored value for known user", async () => {
    const stored = { U1: { reactionDelivery: "thread" } };
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify(stored));

    const result = await getUserPreference("U1", "reactionDelivery");

    assert.equal(result, "thread");
  });

  it("returns default for unknown user", async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify({}));

    const delivery = await getUserPreference("UNKNOWN", "reactionDelivery");
    assert.equal(delivery, "dm");

    clearPreferencesCache();
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify({}));

    const notify = await getUserPreference("UNKNOWN", "notifyOnResponse");
    assert.equal(notify, false);
  });

  it("returns default for known user missing that key", async () => {
    const stored = { U1: { reactionDelivery: "thread" } };
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify(stored));

    const result = await getUserPreference("U1", "notifyOnResponse");

    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// setUserPreference
// ---------------------------------------------------------------------------

describe("setUserPreference", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockMkdir.mock.resetCalls();
    mockFileExists.mock.resetCalls();
    setUserPreferencesDeps(makeDeps());
  });

  it("creates user entry if none exists", async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify({}));
    mockWriteFile.mock.mockImplementation(async () => {});

    await setUserPreference("U_NEW", "reactionDelivery", "thread");

    assert.equal(mockWriteFile.mock.callCount(), 1);
    const written = JSON.parse(mockWriteFile.mock.calls[0].arguments[1] as string);
    assert.deepEqual(written, { U_NEW: { reactionDelivery: "thread" } });
  });

  it("updates existing user entry", async () => {
    const stored = { U1: { reactionDelivery: "dm" } };
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify(stored));
    mockWriteFile.mock.mockImplementation(async () => {});

    await setUserPreference("U1", "notifyOnResponse", true);

    assert.equal(mockWriteFile.mock.callCount(), 1);
    const written = JSON.parse(mockWriteFile.mock.calls[0].arguments[1] as string);
    assert.deepEqual(written, {
      U1: { reactionDelivery: "dm", notifyOnResponse: true },
    });
  });
});

// ---------------------------------------------------------------------------
// getReactionDelivery
// ---------------------------------------------------------------------------

describe("getReactionDelivery", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockMkdir.mock.resetCalls();
    mockFileExists.mock.resetCalls();
    setUserPreferencesDeps(makeDeps());
  });

  it("returns stored value", async () => {
    const stored = { U1: { reactionDelivery: "thread" } };
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify(stored));

    const result = await getReactionDelivery("U1");

    assert.equal(result, "thread");
  });

  it('returns "dm" as default', async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify({}));

    const result = await getReactionDelivery("UNKNOWN");

    assert.equal(result, "dm");
  });
});

// ---------------------------------------------------------------------------
// clearPreferencesCache
// ---------------------------------------------------------------------------

describe("clearPreferencesCache", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mock.resetCalls();
    mockWriteFile.mock.resetCalls();
    mockMkdir.mock.resetCalls();
    mockFileExists.mock.resetCalls();
    setUserPreferencesDeps(makeDeps());
  });

  it("forces next load from disk", async () => {
    // First load: populate cache
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () =>
      JSON.stringify({ U1: { reactionDelivery: "thread" } }),
    );
    await loadPreferences();
    assert.equal(mockReadFile.mock.callCount(), 1);

    // Clear cache
    clearPreferencesCache();

    // Second load: should read from disk again
    mockReadFile.mock.mockImplementation(async () =>
      JSON.stringify({ U2: { notifyOnResponse: true } }),
    );
    const result = await loadPreferences();
    assert.equal(mockReadFile.mock.callCount(), 2);
    assert.deepEqual(result, { U2: { notifyOnResponse: true } });
  });
});
