import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildTesterSystemPrompt, buildTesterUserPrompt } from "./prompt.js";
import type { TesterConfig } from "../config.js";

const tmpBase = resolve(tmpdir(), `tester-prompt-${process.pid}`);

const resolveInstructionFileMock = vi.hoisted(() => vi.fn());
vi.mock("../instructions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../instructions.js")>();
  return {
    ...original,
    resolveInstructionFile: (filename: string) => resolveInstructionFileMock(filename),
  };
});

function makeTester(overrides?: Partial<TesterConfig>): TesterConfig {
  return {
    enabled: true,
    sidecarUrl: "http://sidecar/mcp",
    recordingsDir: "/recordings",
    ...overrides,
  };
}

function makeOpts(tester = makeTester()) {
  return {
    description: "exercise the login flow",
    branchName: "feature/login",
    repoName: "my-repo",
    requester: "Frank",
    tester,
  };
}

describe("buildTesterSystemPrompt", () => {
  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
    resolveInstructionFileMock.mockReturnValue(null);
  });

  it("substitutes the configured appHost into the drive URL", () => {
    const prompt = buildTesterSystemPrompt(
      makeOpts(makeTester({ appHost: "host.docker.internal" })),
    );
    assert.ok(prompt.includes("http://host.docker.internal:<port>"));
    assert.ok(!prompt.includes("{APP_HOST}"));
  });

  it("defaults appHost to 'clack'", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("http://clack:<port>"));
  });

  it("omits the DATA SETUP section when no per-repo file exists", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(!prompt.includes("DATA SETUP (run after the app boots"));
  });

  it("inlines per-repo data setup and test instructions when present", () => {
    const setupPath = join(tmpBase, "tester_data_setup_instructions.md");
    const testPath = join(tmpBase, "test_instructions.md");
    writeFileSync(setupPath, "Seed the demo tenant.");
    writeFileSync(testPath, "Always log in as demo@example.com first.");
    resolveInstructionFileMock.mockImplementation((filename: string) => {
      if (filename.endsWith("tester_data_setup_instructions.md")) return setupPath;
      if (filename.endsWith("test_instructions.md")) return testPath;
      return null;
    });

    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("Seed the demo tenant."));
    assert.ok(prompt.includes("Always log in as demo@example.com first."));
  });

  it("degrades gracefully when an instruction file cannot be read", () => {
    resolveInstructionFileMock.mockReturnValue(join(tmpBase, "does-not-exist.md"));
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(!prompt.includes("DATA SETUP (run after the app boots"));
    assert.ok(!prompt.includes("Repository-Specific Test Instructions"));
  });

  it("keeps the read-only and teardown contract in the prompt", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("NEVER run `git commit`"));
    assert.ok(prompt.includes(".clack-tester-app.json"));
    assert.ok(prompt.includes("0.0.0.0"));
  });
});

describe("buildTesterUserPrompt", () => {
  it("carries the test focus, requester, and branch", () => {
    const prompt = buildTesterUserPrompt(makeOpts());
    assert.ok(prompt.includes("exercise the login flow"));
    assert.ok(prompt.includes("Frank"));
    assert.ok(prompt.includes("feature/login"));
  });
});
