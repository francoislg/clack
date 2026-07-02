import { z } from "zod";

/**
 * Single source of truth for the editable per-repository instruction files;
 * the schema enum and the `list_config_files` listing both derive from it.
 * Excludes `worktree_dirty_ignore.txt` — a non-markdown globs file.
 */
export const REPO_INSTRUCTION_FILES = [
  "changes_instructions.md",
  "worktree_setup_instructions.md",
  "worktree_install_instructions.md",
  "test_instructions.md",
  "tester_data_setup_instructions.md",
] as const;

export type RepoInstructionFile = (typeof REPO_INSTRUCTION_FILES)[number];

export const REPO_FILE_ENUM = z.enum(REPO_INSTRUCTION_FILES);
