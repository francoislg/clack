export interface TestCase {
  name: string;
  /** Input config to write before running the migration */
  input: Record<string, unknown>;
  /** Return null if passed, error string if failed */
  validate: (output: Record<string, unknown>) => string | null;
}

export interface MigrationTest {
  /** Which migration version this tests */
  version: number;
  /** Test cases for this migration */
  cases: TestCase[];
}
