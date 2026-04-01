## Context

The admin-tools feature (just shipped) includes `auth/.env` in the `admin_read_file`/`admin_write_file` allowlist. This means Claude sees API tokens in its conversation context when an admin reads the file. Even though access is admin-only, this is a security concern — tokens in conversation context could be logged, cached, or exposed through session persistence.

The existing `configWatcher.ts` already watches `auth/.env` and reloads env vars on change, so new env values take effect on the next session without a full restart.

## Goals / Non-Goals

**Goals:**
- Admins can manage environment variables without seeing existing secret values
- Admins can check which env vars are configured (keys only)
- Setting an empty value removes the key (no separate delete tool)

**Non-Goals:**
- No env var validation beyond key format — values are opaque strings
- No "get value" capability, ever — this is the core security constraint
- No changes to the config watcher or dotenv reload behavior

## Decisions

### 1. Two tools instead of modifying admin_write_file

`admin_set_env(key, value?)` and `admin_list_env()` are separate tools rather than adding env support to `admin_write_file`. Reason: the write-file tool returns the full file content on success and takes full file content as input — both fundamentally incompatible with the "never expose values" constraint.

### 2. Set with empty value = delete

`admin_set_env("FOO", "")` or `admin_set_env("FOO")` (value omitted) removes the key from `.env`. This avoids a third tool (`admin_delete_env`) for a rare operation. The tool reports whether it set or deleted.

### 3. Atomic file operations

`admin_set_env` reads the current `.env`, modifies the target line, and writes the entire file back. This preserves comments and ordering. No partial writes or append-only — the full file is rewritten with the single key changed.

### 4. Key format validation

Keys must match `[A-Z][A-Z0-9_]*` — standard env var naming. This prevents injection (e.g., a key containing `=` or newlines).

## Risks / Trade-offs

- **[Value never validated]** → An admin could set a malformed token. This is acceptable — env var values are opaque strings, and validation would require knowing each service's token format.
- **[File rewrite atomicity]** → The read-modify-write on `.env` is not atomic. A concurrent `admin_set_env` call could overwrite another's changes. Mitigated by: admin operations are rare, and the concurrency guard on `restartAll()` prevents overlapping restarts. The set_env tool itself could add a simple file-level guard if needed.
