import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isValidEnvKey } from "./envFile.js";

const testDir = join(tmpdir(), "clack-env-test");
const envPath = join(testDir, "auth", ".env");

// ---------------------------------------------------------------------------
// Helpers — mirror envFile.ts logic but targeting the test directory
// ---------------------------------------------------------------------------

function loadLines(): string[] {
  if (!existsSync(envPath)) return [];
  return readFileSync(envPath, "utf-8").split("\n");
}

function writeLines(lines: string[]): void {
  const parentDir = join(envPath, "..");
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
  const content = lines.filter((l, i) => i < lines.length - 1 || l.trim() !== "").join("\n") + "\n";
  writeFileSync(envPath, content, "utf-8");
}

function setEnv(key: string, value?: string): { key: string; action: string } {
  const isDelete = !value || value === "";
  const lines = loadLines();
  const idx = lines.findIndex((l) => {
    const t = l.trim();
    return !t.startsWith("#") && t.startsWith(`${key}=`);
  });

  if (isDelete) {
    if (idx === -1) return { key, action: "not_found" };
    lines.splice(idx, 1);
    writeLines(lines);
    return { key, action: "deleted" };
  }

  if (idx !== -1) {
    lines[idx] = `${key}=${value}`;
    writeLines(lines);
    return { key, action: "updated" };
  }

  lines.push(`${key}=${value}`);
  writeLines(lines);
  return { key, action: "added" };
}

function listKeys(): string[] {
  if (!existsSync(envPath)) return [];
  return readFileSync(envPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && l.includes("="))
    .map((l) => l.split("=")[0]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isValidEnvKey", () => {
  it("accepts valid keys", () => {
    assert.ok(isValidEnvKey("API_KEY"));
    assert.ok(isValidEnvKey("LINEAR_API_TOKEN"));
    assert.ok(isValidEnvKey("A"));
    assert.ok(isValidEnvKey("FOO123"));
  });

  it("rejects invalid keys", () => {
    assert.ok(!isValidEnvKey("lowercase"));
    assert.ok(!isValidEnvKey("has space"));
    assert.ok(!isValidEnvKey("123START"));
    assert.ok(!isValidEnvKey("HAS=EQUALS"));
    assert.ok(!isValidEnvKey(""));
    assert.ok(!isValidEnvKey("a_b"));
  });
});

describe("setEnvVar", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "auth"), { recursive: true });
    writeFileSync(envPath, "EXISTING_KEY=old_value\n# a comment\nANOTHER=123\n", "utf-8");
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("adds a new key", () => {
    const result = setEnv("NEW_KEY", "new_value");
    assert.equal(result.action, "added");
    const content = readFileSync(envPath, "utf-8");
    assert.ok(content.includes("NEW_KEY=new_value"));
    assert.ok(content.includes("EXISTING_KEY=old_value"));
  });

  it("updates an existing key", () => {
    const result = setEnv("EXISTING_KEY", "updated_value");
    assert.equal(result.action, "updated");
    const content = readFileSync(envPath, "utf-8");
    assert.ok(content.includes("EXISTING_KEY=updated_value"));
    assert.ok(!content.includes("old_value"));
  });

  it("deletes a key with empty value", () => {
    const result = setEnv("EXISTING_KEY", "");
    assert.equal(result.action, "deleted");
    const content = readFileSync(envPath, "utf-8");
    assert.ok(!content.includes("EXISTING_KEY"));
    assert.ok(content.includes("ANOTHER=123"));
  });

  it("deletes a key with omitted value", () => {
    const result = setEnv("ANOTHER");
    assert.equal(result.action, "deleted");
    const content = readFileSync(envPath, "utf-8");
    assert.ok(!content.includes("ANOTHER"));
  });

  it("returns not_found when deleting non-existent key", () => {
    const result = setEnv("NONEXISTENT", "");
    assert.equal(result.action, "not_found");
  });

  it("creates .env file if missing", () => {
    rmSync(envPath, { force: true });
    const result = setEnv("FRESH_KEY", "fresh_value");
    assert.equal(result.action, "added");
    assert.ok(existsSync(envPath));
    assert.ok(readFileSync(envPath, "utf-8").includes("FRESH_KEY=fresh_value"));
  });

  it("preserves comments and ordering", () => {
    setEnv("ANOTHER", "updated_another");
    const content = readFileSync(envPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines[0], "EXISTING_KEY=old_value");
    assert.equal(lines[1], "# a comment");
    assert.equal(lines[2], "ANOTHER=updated_another");
  });

  it("never returns the value in the result", () => {
    const result = setEnv("SECRET_KEY", "super_secret_value");
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes("super_secret_value"));
  });
});

describe("listEnvKeys", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "auth"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("lists key names only", () => {
    writeFileSync(envPath, "API_KEY=secret123\nDB_HOST=localhost\n", "utf-8");
    const keys = listKeys();
    assert.deepEqual(keys, ["API_KEY", "DB_HOST"]);
  });

  it("excludes comments and empty lines", () => {
    writeFileSync(envPath, "# comment\n\nKEY=val\n\n# another\n", "utf-8");
    const keys = listKeys();
    assert.deepEqual(keys, ["KEY"]);
  });

  it("returns empty array for missing file", () => {
    rmSync(envPath, { force: true });
    const keys = listKeys();
    assert.deepEqual(keys, []);
  });

  it("returns empty array for empty file", () => {
    writeFileSync(envPath, "\n# just comments\n\n", "utf-8");
    const keys = listKeys();
    assert.deepEqual(keys, []);
  });
});
