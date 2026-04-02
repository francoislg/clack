/** Result type for individual files returned by a static transform */
export type StaticFileResult = string | { delete: true };

export interface Migration {
  /** Target version after this migration completes */
  version: number;
  /** Human-readable name */
  name: string;
  /** blocking = must complete before boot; enhancement = runs async after boot */
  priority: "blocking" | "enhancement";
  /** Prompt for Claude to execute the migration. Optional when `static` is defined. */
  prompt?: string;
  /** Files the migration can read/write (scoped access) */
  files: string[];
  /**
   * Static transform that runs without invoking Claude.
   * Receives file contents keyed by path (null if file doesn't exist).
   * Returns a map of files to write/delete. Keys absent from the return are untouched.
   */
  static?: (files: Record<string, string | null>) => Record<string, StaticFileResult>;
  /** Files to delete after the migration completes successfully (relative to cwd) */
  deleteAfter?: string[];
  /** Post-LLM dedup: maps output files to their default counterparts. If the output matches the default (ignoring whitespace), the output is deleted. */
  dedupAgainst?: Record<string, string>;
}

export interface MigrationState {
  version: number;
}

export interface MigrationError {
  migrationName: string;
  version: number;
  error: string;
  timestamp: number;
}
