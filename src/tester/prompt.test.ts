import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  buildTesterCorrectivePrompt,
  buildTesterSystemPrompt,
  buildTesterUserPrompt,
} from "./prompt.js";
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

  it("starts the workflow with the discovery phase", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("DISCOVER what to run"));
    assert.ok(prompt.includes("the subset is decided per run from THIS diff"));
  });

  it("splits driving into a verify phase and a recorded demo take", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("VERIFY — throwaway browser session"));
    assert.ok(prompt.includes("RECORD — the demo take"));
    assert.ok(prompt.includes("Reopening the browser starts a fresh recording"));
    assert.ok(prompt.includes("do NOT restart it between phases"));
    assert.ok(!prompt.includes("the session is being recorded"));
  });

  it("tells Claude the newest recording is the demo and video_file is the override", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("It picks the newest recording"));
    assert.ok(prompt.includes("video_file"));
  });

  it("injects learned notes and the tester-keyed rewrite directive when provided", () => {
    const prompt = buildTesterSystemPrompt({
      ...makeOpts(),
      learnedNotes: "## Services\n- web: pnpm dev, port 3000",
    });
    assert.ok(prompt.includes("NOTES FROM PREVIOUS RUNS (advisory"));
    assert.ok(prompt.includes("## Services\n- web: pnpm dev, port 3000"));
    assert.ok(prompt.includes('"tester-setup:my-repo"'));
  });

  it("omits the notes section on a cold run but keeps the directive", () => {
    const prompt = buildTesterSystemPrompt({ ...makeOpts(), learnedNotes: null });
    assert.ok(!prompt.includes("NOTES FROM PREVIOUS RUNS (advisory"));
    assert.ok(prompt.includes("REPO SETUP MEMORY"));
    assert.ok(prompt.includes('"tester-setup:my-repo"'));
  });

  it("renders the TEST SERVICES section when services were provisioned", () => {
    const prompt = buildTesterSystemPrompt({
      ...makeOpts(),
      services: [
        {
          name: "mysql",
          host: "clack-svc-my-repo-mysql",
          port: 3306,
          image: "mysql:8",
          tmpfs: true,
        },
        {
          name: "redis",
          host: "clack-svc-my-repo-redis",
          port: 6379,
          image: "redis:7",
          tmpfs: false,
        },
      ],
    });
    assert.ok(prompt.includes("TEST SERVICES (already running, fresh and empty"));
    assert.ok(
      prompt.includes('- mysql → host "clack-svc-my-repo-mysql", port 3306 (mysql:8, tmpfs)'),
    );
    assert.ok(prompt.includes('- redis → host "clack-svc-my-repo-redis", port 6379 (redis:7)'));
    assert.ok(prompt.includes("Do not start your own service containers"));
  });

  it("is byte-identical to the no-services prompt when services are absent or empty", () => {
    const withoutField = buildTesterSystemPrompt(makeOpts());
    const withEmpty = buildTesterSystemPrompt({ ...makeOpts(), services: [] });
    assert.equal(withEmpty, withoutField);
    assert.ok(!withoutField.includes("TEST SERVICES"));
  });
});

describe("turn-end hard rule", () => {
  beforeEach(() => {
    resolveInstructionFileMock.mockReturnValue(null);
  });

  it("is present in every assembled system prompt", () => {
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("Your run TERMINATES the instant you stop calling tools"));
    assert.ok(prompt.includes("NEVER end your turn"));
    assert.ok(prompt.includes("poll it with Bash"));
  });

  it("survives repo-specific instruction overrides", () => {
    const instructionsPath = join(tmpBase, "test_instructions.md");
    writeFileSync(instructionsPath, "Always test on staging.");
    resolveInstructionFileMock.mockImplementation((filename: string) =>
      filename.endsWith("test_instructions.md") ? instructionsPath : null,
    );
    const prompt = buildTesterSystemPrompt(makeOpts());
    assert.ok(prompt.includes("Your run TERMINATES the instant you stop calling tools"));
    assert.ok(prompt.includes("Always test on staging."));
  });
});

describe("buildTesterCorrectivePrompt", () => {
  it("instructs finish-now delivery of both deliverable tools", () => {
    const prompt = buildTesterCorrectivePrompt({ repoName: "my-repo", includeSetupRewrite: false });
    assert.ok(prompt.includes("record_and_upload"));
    assert.ok(prompt.includes("report_status"));
    assert.ok(prompt.includes("Close the browser session"));
    assert.ok(prompt.includes("Nothing will wake you"));
  });

  it("includes the setup rewrite step when the entry was not rewritten", () => {
    const prompt = buildTesterCorrectivePrompt({ repoName: "my-repo", includeSetupRewrite: true });
    assert.ok(prompt.includes('"tester-setup:my-repo"'));
    assert.ok(prompt.includes("REPO SETUP MEMORY"));
    assert.ok(prompt.includes("remember tool"));
  });

  it("omits the setup rewrite step when the entry was rewritten mid-run", () => {
    const prompt = buildTesterCorrectivePrompt({ repoName: "my-repo", includeSetupRewrite: false });
    assert.ok(!prompt.includes("tester-setup:my-repo"));
    assert.ok(!prompt.includes("REPO SETUP MEMORY"));
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
