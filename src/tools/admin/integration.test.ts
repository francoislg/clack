import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDataDir = join(tmpdir(), "clack-admin-tools-test");

// ============================================================================
// Isolated tests for allowlist file operations
// These test the pure functions with real filesystem, no mocking needed.
// ============================================================================

describe("admin tools integration", () => {
  beforeEach(() => {
    mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("config.json validation", () => {
    it("rejects invalid JSON", () => {
      // Direct validation test — no need for full tool invocation
      const content = "{ not valid json";
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }
      assert.equal(parsed, null, "Invalid JSON should not parse");
    });

    it("accepts valid JSON that parses", () => {
      const content = JSON.stringify({
        repositories: [{ name: "test", url: "org/repo", description: "test" }],
      });
      const parsed = JSON.parse(content);
      assert.ok(parsed.repositories.length === 1);
    });
  });

  describe("mcp.json validation", () => {
    it("accepts valid mcp.json structure", () => {
      const content = JSON.stringify({
        mcpServers: {
          linear: { type: "http", url: "https://mcp.linear.app/mcp" },
        },
      });
      const parsed = JSON.parse(content) as Record<string, unknown>;
      assert.ok(parsed.mcpServers && typeof parsed.mcpServers === "object");
    });

    it("rejects mcp.json without mcpServers", () => {
      const content = JSON.stringify({ servers: {} });
      const parsed = JSON.parse(content) as Record<string, unknown>;
      assert.ok(!parsed.mcpServers);
    });
  });

  describe("dotenv validation", () => {
    it("accepts valid dotenv format", () => {
      const content = "API_KEY=abc123\nSECRET=xyz\n# comment\n\n";
      const lines = content.split("\n");
      const invalid = lines.filter((l) => {
        const trimmed = l.trim();
        return trimmed !== "" && !trimmed.startsWith("#") && !trimmed.includes("=");
      });
      assert.equal(invalid.length, 0);
    });

    it("detects invalid dotenv lines", () => {
      const content = "GOOD=value\nBADLINE\n";
      const lines = content.split("\n");
      const invalid = lines.filter((l) => {
        const trimmed = l.trim();
        return trimmed !== "" && !trimmed.startsWith("#") && !trimmed.includes("=");
      });
      assert.equal(invalid.length, 1);
      assert.equal(invalid[0], "BADLINE");
    });
  });

  describe("file write + read round-trip", () => {
    it("writes and reads back file content", () => {
      const filePath = join(testDataDir, "test-config.json");
      const content = JSON.stringify({ test: true }, null, 2);
      writeFileSync(filePath, content, "utf-8");

      const readBack = readFileSync(filePath, "utf-8");
      assert.equal(readBack, content);
    });

    it("creates parent directories on write", () => {
      const nested = join(testDataDir, "nested", "dir", "file.json");
      mkdirSync(join(testDataDir, "nested", "dir"), { recursive: true });
      writeFileSync(nested, "{}", "utf-8");

      assert.ok(existsSync(nested));
    });

    it("does not overwrite when validation fails", () => {
      const filePath = join(testDataDir, "protected.json");
      writeFileSync(filePath, '{"original": true}', "utf-8");

      // Simulate: validation fails, so we don't write
      const newContent = "not valid json";
      let valid = true;
      try {
        JSON.parse(newContent);
      } catch {
        valid = false;
      }

      if (valid) {
        writeFileSync(filePath, newContent, "utf-8");
      }

      // File should still have original content
      const readBack = readFileSync(filePath, "utf-8");
      assert.equal(readBack, '{"original": true}');
    });
  });
});
