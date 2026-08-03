import { describe, it, beforeEach, vi } from "vitest";
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

const mockReadFile = vi.fn<(path: string, encoding: string) => Promise<string>>();
const mockWriteFile = vi.fn<(path: string, data: string) => Promise<void>>();
const mockMkdir =
  vi.fn<(path: string, opts?: { recursive: boolean }) => Promise<string | undefined>>();
const mockFileExists = vi.fn<(path: string) => Promise<boolean>>();

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
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockFileExists.mockClear();
    setUserPreferencesDeps(makeDeps());
  });

  it("returns {} when file doesn't exist", async () => {
    mockFileExists.mockImplementation(async () => false);

    const result = await loadPreferences();

    assert.deepEqual(result, {});
  });

  it("reads and parses JSON when file exists", async () => {
    const stored = { U123: { reactionDelivery: "thread" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await loadPreferences();

    assert.deepEqual(result, stored);
    assert.equal(mockReadFile.mock.calls.length, 1);
  });

  it("returns cached result on second call (readFile not called again)", async () => {
    const stored = { U456: { notifyOnResponse: true } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const first = await loadPreferences();
    const second = await loadPreferences();

    assert.deepEqual(first, stored);
    assert.equal(first, second); // same reference
    assert.equal(mockReadFile.mock.calls.length, 1);
  });

  it("returns {} on parse error", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => "not valid json {{{");

    const result = await loadPreferences();

    assert.deepEqual(result, {});
  });

  it("strips the deprecated dmOptOut field on load", async () => {
    const stored = { U1: { dmOptOut: true, reactionDelivery: "thread" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await loadPreferences();

    // dmOptOut is accepted on disk but not surfaced into the runtime map.
    assert.deepEqual(result, { U1: { reactionDelivery: "thread" } });
  });

  it("returns {} when the stored shape is invalid", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () =>
      JSON.stringify({ U1: { reactionDelivery: "carrier-pigeon" } }),
    );

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
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockFileExists.mockClear();
    setUserPreferencesDeps(makeDeps());
  });

  it("creates state dir if it doesn't exist", async () => {
    // First call checks state dir existence, return false
    mockFileExists.mockImplementation(async () => false);
    mockMkdir.mockImplementation(async () => undefined);
    mockWriteFile.mockImplementation(async () => {});

    await savePreferences({ U1: { reactionDelivery: "thread" } });

    assert.equal(mockMkdir.mock.calls.length, 1);
    const mkdirArgs = mockMkdir.mock.calls[0];
    assert.match(mkdirArgs[0] as string, /[\\/]data[\\/]state$/);
    assert.deepEqual(mkdirArgs[1], { recursive: true });
  });

  it("writes JSON and updates cache", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => "{}");
    mockWriteFile.mockImplementation(async () => {});

    const prefs = { U1: { notifyOnResponse: true as const } };
    await savePreferences(prefs);

    assert.equal(mockWriteFile.mock.calls.length, 1);
    const writeArgs = mockWriteFile.mock.calls[0];
    assert.equal(writeArgs[1], JSON.stringify({ entries: prefs }, null, 2));

    // Cache should be updated — next loadPreferences should not read from disk
    mockReadFile.mockClear();
    const loaded = await loadPreferences();
    assert.deepEqual(loaded, prefs);
    assert.equal(mockReadFile.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// getUserPreference
// ---------------------------------------------------------------------------

describe("getUserPreference", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockFileExists.mockClear();
    setUserPreferencesDeps(makeDeps());
  });

  it("returns stored value for known user", async () => {
    const stored = { U1: { reactionDelivery: "thread" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await getUserPreference("U1", "reactionDelivery");

    assert.equal(result, "thread");
  });

  it("returns default for unknown user", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));

    const delivery = await getUserPreference("UNKNOWN", "reactionDelivery");
    assert.equal(delivery, "dm");

    clearPreferencesCache();
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));

    const notify = await getUserPreference("UNKNOWN", "notifyOnResponse");
    assert.equal(notify, false);
  });

  it("returns default for known user missing that key", async () => {
    const stored = { U1: { reactionDelivery: "thread" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await getUserPreference("U1", "notifyOnResponse");

    assert.equal(result, false);
  });

  it("returns default false for investigationTag when unset", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));

    const result = await getUserPreference("UNKNOWN", "investigationTag");

    assert.equal(result, false);
  });

  it("returns default 'silent' for investigationBreadcrumb when unset", async () => {
    clearPreferencesCache();
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));

    const result = await getUserPreference("UNKNOWN", "investigationBreadcrumb");

    assert.equal(result, "silent");
  });

  it("returns stored investigationTag value", async () => {
    const stored = { U1: { investigationTag: true } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await getUserPreference("U1", "investigationTag");

    assert.equal(result, true);
  });

  it("returns stored investigationBreadcrumb value", async () => {
    const stored = { U1: { investigationBreadcrumb: "explicit" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await getUserPreference("U1", "investigationBreadcrumb");

    assert.equal(result, "explicit");
  });
});

// ---------------------------------------------------------------------------
// setUserPreference
// ---------------------------------------------------------------------------

describe("setUserPreference", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockFileExists.mockClear();
    setUserPreferencesDeps(makeDeps());
  });

  it("creates user entry if none exists", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));
    mockWriteFile.mockImplementation(async () => {});

    await setUserPreference("U_NEW", "reactionDelivery", "thread");

    assert.equal(mockWriteFile.mock.calls.length, 1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    assert.deepEqual(written, { entries: { U_NEW: { reactionDelivery: "thread" } } });
  });

  it("updates existing user entry", async () => {
    const stored = { U1: { reactionDelivery: "dm" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));
    mockWriteFile.mockImplementation(async () => {});

    await setUserPreference("U1", "notifyOnResponse", true);

    assert.equal(mockWriteFile.mock.calls.length, 1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    assert.deepEqual(written, {
      entries: { U1: { reactionDelivery: "dm", notifyOnResponse: true } },
    });
  });

  it("round-trip: investigationTag can be set and retrieved", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));
    mockWriteFile.mockImplementation(async () => {});

    await setUserPreference("U_NEW", "investigationTag", true);

    assert.equal(mockWriteFile.mock.calls.length, 1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    assert.deepEqual(written, { entries: { U_NEW: { investigationTag: true } } });
  });

  it("round-trip: investigationBreadcrumb can be set and retrieved", async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));
    mockWriteFile.mockImplementation(async () => {});

    await setUserPreference("U_NEW", "investigationBreadcrumb", "explicit");

    assert.equal(mockWriteFile.mock.calls.length, 1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    assert.deepEqual(written, { entries: { U_NEW: { investigationBreadcrumb: "explicit" } } });
  });
});

// ---------------------------------------------------------------------------
// getReactionDelivery
// ---------------------------------------------------------------------------

describe("getReactionDelivery", () => {
  beforeEach(() => {
    clearPreferencesCache();
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockFileExists.mockClear();
    setUserPreferencesDeps(makeDeps());
  });

  it("returns stored value", async () => {
    const stored = { U1: { reactionDelivery: "thread" } };
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify(stored));

    const result = await getReactionDelivery("U1");

    assert.equal(result, "thread");
  });

  it('returns "dm" as default', async () => {
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () => JSON.stringify({}));

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
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockFileExists.mockClear();
    setUserPreferencesDeps(makeDeps());
  });

  it("forces next load from disk", async () => {
    // First load: populate cache
    mockFileExists.mockImplementation(async () => true);
    mockReadFile.mockImplementation(async () =>
      JSON.stringify({ U1: { reactionDelivery: "thread" } }),
    );
    await loadPreferences();
    assert.equal(mockReadFile.mock.calls.length, 1);

    // Clear cache
    clearPreferencesCache();

    // Second load: should read from disk again
    mockReadFile.mockImplementation(async () => JSON.stringify({ U2: { notifyOnResponse: true } }));
    const result = await loadPreferences();
    assert.equal(mockReadFile.mock.calls.length, 2);
    assert.deepEqual(result, { U2: { notifyOnResponse: true } });
  });
});
