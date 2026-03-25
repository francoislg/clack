#!/usr/bin/env node
/**
 * Migration test runner.
 *
 * Runs two kinds of tests:
 *   1. Individual migration tests — each migration's test cases in isolation (parallelized)
 *   2. Full migration path — version 0 config migrated through every migration to latest
 *
 * Usage:
 *   npx tsx scripts/migration-tests/run.ts              # run all
 *   npx tsx scripts/migration-tests/run.ts --only 1     # run only migration 1 tests
 *   npx tsx scripts/migration-tests/run.ts --full-only  # run only full-path test
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { executeMigration } from "../../src/migrations/engine.js";
import { getPendingMigrations } from "../../src/migrations/engine.js";
import { migrations } from "../../src/migrations/index.js";
import type { MigrationTest } from "./types.js";

// --- Import individual migration tests ---
import { test as test001 } from "./001.js";
import { test as test002 } from "./002.js";
import { test as test003 } from "./003.js";
import { test as test004 } from "./004.js";
import { test as test005 } from "./005.js";
import { test as test007 } from "./007.js";
import { test as test008 } from "./008.js";
import { test as test009 } from "./009.js";

const allTests: MigrationTest[] = [test001, test002, test003, test004, test005, test007, test008, test009];

// --- Config ---

const TEST_DIR = resolve(process.cwd(), ".test-migrations");
const CONCURRENCY = 4;

// --- Helpers ---

function setup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

function writeTestConfig(dir: string, config: Record<string, unknown>): string {
  const configPath = join(dir, "data", "config.json");
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function readTestConfig(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse test config at ${path}: ${err}`);
  }
}

/** Recursively find all .md files in a directory, returning paths relative to baseDir. */
function scanMdFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...scanMdFiles(full, baseDir));
    } else if (entry.endsWith(".md")) {
      results.push(relative(baseDir, full));
    }
  }
  return results;
}

/** Run async tasks with bounded concurrency. */
async function parallel<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// --- Test case types ---

interface TestResult {
  name: string;
  version: number;
  passed: boolean;
  error?: string;
}

// --- Build individual test tasks ---

function buildTestTasks(testsToRun: MigrationTest[]): (() => Promise<TestResult>)[] {
  const tasks: (() => Promise<TestResult>)[] = [];

  for (const migrationTest of testsToRun) {
    const migration = migrations.find((m) => m.version === migrationTest.version);
    if (!migration) continue;

    // JSON config cases
    if (migrationTest.cases) {
      for (let i = 0; i < migrationTest.cases.length; i++) {
        const testCase = migrationTest.cases[i];
        const version = migrationTest.version;

        tasks.push(async () => {
          const testDir = join(TEST_DIR, `v${version}-case-${i}`);
          const configPath = writeTestConfig(testDir, testCase.input);
          const testMigration = { ...migration, files: [configPath] };

          try {
            await executeMigration(testMigration);
            const output = readTestConfig(configPath);
            const error = testCase.validate(output);
            return { name: testCase.name, version, passed: !error, error: error ?? undefined };
          } catch (err) {
            return { name: testCase.name, version, passed: false, error: `Migration threw: ${err}` };
          }
        });
      }
    }

    // File-based cases
    if (migrationTest.fileCases) {
      for (let i = 0; i < migrationTest.fileCases.length; i++) {
        const testCase = migrationTest.fileCases[i];
        const version = migrationTest.version;

        tasks.push(async () => {
          const testDir = join(TEST_DIR, `v${version}-file-case-${i}`);
          mkdirSync(testDir, { recursive: true });

          // Write input files
          for (const [relPath, content] of Object.entries(testCase.inputFiles)) {
            const fullPath = join(testDir, relPath);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, content);
          }

          // Map ALL migration file paths to the test directory
          const testFiles = migration.files.map((f) => join(testDir, f));

          const dedupAgainst = migration.dedupAgainst
            ? Object.fromEntries(
                Object.entries(migration.dedupAgainst).map(([output, def]) => [
                  join(testDir, output),
                  def, // default files stay at their real paths
                ])
              )
            : undefined;

          const testMigration = {
            ...migration,
            files: testFiles,
            deleteAfter: migration.deleteAfter?.map((f) => join(testDir, f)),
            dedupAgainst,
          };

          try {
            await executeMigration(testMigration);

            const outputFiles: Record<string, string> = {};
            const pathsToRead = new Set([
              ...Object.keys(testCase.inputFiles),
              ...(testCase.additionalOutputPaths ?? []),
            ]);
            // Scan directories for dynamically-created files
            if (testCase.scanDirs) {
              for (const scanDir of testCase.scanDirs) {
                for (const found of scanMdFiles(join(testDir, scanDir), testDir)) {
                  pathsToRead.add(found);
                }
              }
            }
            for (const relPath of pathsToRead) {
              const fullPath = join(testDir, relPath);
              if (existsSync(fullPath)) {
                outputFiles[relPath] = readFileSync(fullPath, "utf-8");
              }
            }

            const error = testCase.validateFiles(outputFiles);
            return { name: testCase.name, version, passed: !error, error: error ?? undefined };
          } catch (err) {
            return { name: testCase.name, version, passed: false, error: `Migration threw: ${err}` };
          }
        });
      }
    }
  }

  return tasks;
}

// --- Full migration path test (version 0 → latest) ---

/**
 * A version-0 config: the oldest supported format.
 * Uses supportsChanges (pre-migration-001).
 * As new migrations are added, this config should represent the starting state.
 */
const VERSION_0_CONFIG: Record<string, unknown> = {
  repositories: [
    {
      name: "main-app",
      url: "org/main-app",
      description: "Primary application",
      branch: "main",
      supportsChanges: true,
    },
    {
      name: "docs",
      url: "org/docs",
      description: "Documentation site",
      supportsChanges: false,
    },
  ],
  git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
  sessions: { cleanupIntervalMinutes: 5 },
  claudeCode: { model: "sonnet" },
};

/**
 * Validate the final state after all migrations have run.
 * Update this when adding new migrations.
 */
function validateFinalState(config: Record<string, unknown>): string | null {
  const repos = config.repositories as Record<string, unknown>[];
  if (!repos || repos.length !== 2) return `Expected 2 repos, got ${repos?.length}`;

  // After migration 001: supportsChanges → access
  for (const repo of repos) {
    if ("supportsChanges" in repo) {
      return `Repository "${repo.name}" still has supportsChanges`;
    }
    if (!repo.access) {
      return `Repository "${repo.name}" missing access property`;
    }
  }

  const mainApp = repos.find((r) => r.name === "main-app");
  const mainAccess = mainApp?.access as Record<string, string>;
  if (mainAccess?.write !== "dev") return `main-app should have write: "dev"`;

  const docs = repos.find((r) => r.name === "docs");
  const docsAccess = docs?.access as Record<string, string>;
  if ("write" in docsAccess) return `docs should not have write access`;

  // After migration 009: autoRespond added with enabled: false
  const ar = config.autoRespond as Record<string, unknown> | undefined;
  if (!ar) return "autoRespond field missing after migration 009";
  if (ar.enabled !== false) return `autoRespond.enabled should be false, got: ${ar.enabled}`;

  return null;
}

async function runFullPathTest(): Promise<boolean> {
  console.log(`\n=== Full Migration Path: v0 → v${migrations[migrations.length - 1]?.version ?? 0} ===\n`);

  if (migrations.length === 0) {
    console.log("  No migrations registered. Skipping.");
    return true;
  }

  const testDir = join(TEST_DIR, "full-path");
  const configPath = writeTestConfig(testDir, VERSION_0_CONFIG);

  // Only run config-based migrations in the full path (file-based ones operate
  // on user override files that don't exist in a fresh install)
  const configMigrations = getPendingMigrations(0, migrations).filter((m) =>
    m.files.some((f) => f.endsWith("config.json"))
  );

  console.log(`  Starting config: ${configPath}`);
  console.log(`  Config migrations to run: ${configMigrations.length}\n`);

  for (const migration of configMigrations) {
    console.log(`  Running v${migration.version}: ${migration.name}...`);

    const testMigration = { ...migration, files: [configPath] };

    try {
      await executeMigration(testMigration);
      console.log(`    Done`);
    } catch (error) {
      console.error(`    FAIL: ${error}`);
      return false;
    }
  }

  // Validate final state
  const finalConfig = readTestConfig(configPath);
  console.log(`\n  Final config:\n${JSON.stringify(finalConfig.repositories, null, 2)}`);

  const error = validateFinalState(finalConfig);
  if (error) {
    console.error(`\n  FAIL: ${error}`);
    return false;
  }

  console.log(`\n  PASS — migrated from v0 to v${configMigrations[configMigrations.length - 1].version}`);
  return true;
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyVersion = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : null;
  const fullOnly = args.includes("--full-only");

  const startTime = Date.now();

  console.log("=== Migration Test Runner ===\n");

  setup();

  let totalPassed = 0;
  let totalFailed = 0;

  // 1. Individual migration tests (parallelized)
  if (!fullOnly) {
    const testsToRun = onlyVersion
      ? allTests.filter((t) => t.version === onlyVersion)
      : allTests;

    if (testsToRun.length === 0 && onlyVersion) {
      console.error(`No test file found for migration version ${onlyVersion}`);
      cleanup();
      process.exit(1);
    }

    const tasks = buildTestTasks(testsToRun);
    console.log(`Running ${tasks.length} test cases (concurrency: ${CONCURRENCY})...\n`);

    const results = await parallel(tasks, CONCURRENCY);

    // Group results by version for display
    const byVersion = new Map<number, TestResult[]>();
    for (const result of results) {
      const list = byVersion.get(result.version) ?? [];
      list.push(result);
      byVersion.set(result.version, list);
    }

    for (const [version, versionResults] of [...byVersion.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`--- Migration v${version} ---\n`);
      for (const result of versionResults) {
        if (result.passed) {
          console.log(`  PASS  ${result.name}`);
          totalPassed++;
        } else {
          console.error(`  FAIL  ${result.name}`);
          console.error(`        ${result.error}`);
          totalFailed++;
        }
      }
      console.log();
    }
  }

  // 2. Full path test
  if (!onlyVersion) {
    const fullPassed = await runFullPathTest();
    if (fullPassed) totalPassed++;
    else totalFailed++;
  }

  cleanup();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Results: ${totalPassed} passed, ${totalFailed} failed (${elapsed}s) ===`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
