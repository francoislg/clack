import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BlockSchema } from "../slack/blockSchema.js";

// ============================================================================
// MCP schema serialization safety
// ============================================================================
//
// `@anthropic-ai/claude-agent-sdk` serializes every tool's Zod input schema to
// JSON Schema for the MCP `tools/list` payload. Any Zod construct that lacks a
// static schema representation (notably `z.custom`) crashes the conversion and
// silently drops the entire Clack tool registry — every clack__* tool fails,
// not just the offending one.
//
// We protect against this in two ways:
//   1. Runtime — round-trip BlockSchema through `z.toJSONSchema` to catch any
//      future construct that breaks serialization, regardless of what it is.
//   2. Static — refuse to merge `z.custom(` anywhere in the tool/schema source
//      files. The runtime check would catch z.custom too, but a focused
//      grep gives a clearer error and prevents introducing the pattern at all.
// ============================================================================

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = dirname(TEST_DIR);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("MCP schema serialization safety", () => {
  it("BlockSchema serializes cleanly to JSON Schema", () => {
    // BlockSchema is the input schema of submit_response (and post_to action
    // blocks). If it can't be converted to JSON Schema, the agent SDK's
    // tools/list response is malformed and the entire MCP server breaks.
    assert.doesNotThrow(() => z.toJSONSchema(z.array(BlockSchema)));
  });

  it("does not use `z.custom` anywhere under src/tools or src/slack", () => {
    // `z.custom` has no static JSON Schema representation — only a runtime
    // predicate. Using it in any Zod schema that flows into an MCP tool
    // input crashes JSON Schema generation and silently drops every
    // clack__* tool. Use `z.looseObject({ type: z.string() })` (or another
    // structural schema) when you need a passthrough validator.
    const targetDirs = [join(SRC_ROOT, "tools"), join(SRC_ROOT, "slack")];
    const offenders: string[] = [];
    for (const dir of targetDirs) {
      for (const file of walk(dir)) {
        if (!file.endsWith(".ts")) continue;
        if (file.endsWith(".test.ts")) continue;
        const src = readFileSync(file, "utf8");
        if (/\bz\.custom\s*\(/.test(src)) {
          offenders.push(file.slice(SRC_ROOT.length + 1));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `z.custom() is forbidden in MCP-bound schemas — found in: ${offenders.join(", ")}`,
    );
  });
});
