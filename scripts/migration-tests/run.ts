#!/usr/bin/env node
/**
 * Migration test runner.
 *
 * Runs two kinds of tests:
 *   1. Individual migration tests — each migration's test cases in isolation
 *   2. Full migration path — version 0 config migrated through every migration to latest
 *
 * Usage:
 *   npx tsx scripts/migration-tests/run.ts              # run all
 *   npx tsx scripts/migration-tests/run.ts --only 1     # run only migration 1 tests
 *   npx tsx scripts/migration-tests/run.ts --full-only  # run only full-path test
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { executeMigration } from "../../src/migrations/engine.js";
import { getPendingMigrations } from "../../src/migrations/engine.js";
import { migrations } from "../../src/migrations/index.js";
import type { MigrationTest } from "./types.js";

// --- Import individual migration tests ---
import { test as test001 } from "./001.js";

const allTests: MigrationTest[] = [test001];

// --- Config ---

const TEST_DIR = resolve(process.cwd(), ".test-migrations");

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
  return JSON.parse(readFileSync(path, "utf-8"));
}

// --- Individual migration tests ---

async function runIndividualTests(
  migrationTest: MigrationTest
): Promise<{ passed: number; failed: number }> {
  const migration = migrations.find((m) => m.version === migrationTest.version);
  if (!migration) {
    console.error(`  No migration found for version ${migrationTest.version}`);
    return { passed: 0, failed: migrationTest.cases.length };
  }

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < migrationTest.cases.length; i++) {
    const testCase = migrationTest.cases[i];
    const testDir = join(TEST_DIR, `v${migrationTest.version}-case-${i}`);
    const configPath = writeTestConfig(testDir, testCase.input);

    console.log(`  [${i + 1}/${migrationTest.cases.length}] ${testCase.name}`);

    // Point the migration at the test config
    const testMigration = { ...migration, files: [configPath] };

    try {
      await executeMigration(testMigration);

      const output = readTestConfig(configPath);
      const error = testCase.validate(output);

      if (error) {
        console.error(`    FAIL: ${error}`);
        console.error(`    Output: ${JSON.stringify(output.repositories, null, 2)}`);
        failed++;
      } else {
        console.log(`    PASS`);
        passed++;
      }
    } catch (error) {
      console.error(`    FAIL: Migration threw: ${error}`);
      failed++;
    }
  }

  return { passed, failed };
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
  sessions: { timeoutMinutes: 1440, cleanupIntervalMinutes: 5 },
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

  console.log(`  Starting config: ${configPath}`);
  console.log(`  Migrations to run: ${migrations.length}\n`);

  // Run all pending migrations in order (simulating boot from version 0)
  const pending = getPendingMigrations(0, migrations);

  for (const migration of pending) {
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

  console.log(`\n  PASS — migrated from v0 to v${pending[pending.length - 1].version}`);
  return true;
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyVersion = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : null;
  const fullOnly = args.includes("--full-only");

  console.log("=== Migration Test Runner ===\n");

  setup();

  let totalPassed = 0;
  let totalFailed = 0;

  // 1. Individual migration tests
  if (!fullOnly) {
    const testsToRun = onlyVersion
      ? allTests.filter((t) => t.version === onlyVersion)
      : allTests;

    if (testsToRun.length === 0 && onlyVersion) {
      console.error(`No test file found for migration version ${onlyVersion}`);
      cleanup();
      process.exit(1);
    }

    for (const migrationTest of testsToRun) {
      console.log(`\n--- Migration v${migrationTest.version} ---\n`);
      const { passed, failed } = await runIndividualTests(migrationTest);
      totalPassed += passed;
      totalFailed += failed;
    }
  }

  // 2. Full path test
  if (!onlyVersion) {
    const fullPassed = await runFullPathTest();
    if (fullPassed) totalPassed++;
    else totalFailed++;
  }

  cleanup();

  console.log(`\n=== Results: ${totalPassed} passed, ${totalFailed} failed ===`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
