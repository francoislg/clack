export interface Migration {
  /** Target version after this migration completes */
  version: number;
  /** Human-readable name */
  name: string;
  /** blocking = must complete before boot; enhancement = runs async after boot */
  priority: "blocking" | "enhancement";
  /** Prompt for Claude to execute the migration */
  prompt: string;
  /** Files Claude can read/write (scoped access) */
  files: string[];
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
