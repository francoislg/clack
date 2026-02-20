export interface TestCase {
  name: string;
  /** Input config to write before running the migration */
  input: Record<string, unknown>;
  /** Return null if passed, error string if failed */
  validate: (output: Record<string, unknown>) => string | null;
}

/** Test case for file-based migrations (markdown, etc.) */
export interface FileTestCase {
  name: string;
  /** Input files to write before running (path suffix → content). Paths are relative to the test dir. */
  inputFiles: Record<string, string>;
  /** Return null if passed, error string if failed. Receives path suffix → content after migration. */
  validateFiles: (outputFiles: Record<string, string>) => string | null;
}

export interface MigrationTest {
  /** Which migration version this tests */
  version: number;
  /** Test cases for JSON config migrations */
  cases?: TestCase[];
  /** Test cases for file-based migrations */
  fileCases?: FileTestCase[];
}
