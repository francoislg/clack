## Context

Every migration currently invokes Claude (Sonnet) via the Agent SDK, regardless of complexity. Simple JSON transforms — adding a boolean field, renaming a key — go through the full LLM pipeline: system prompt assembly, scoped tool access, up to 10 turns of conversation. This costs time (seconds per migration) and API credits for operations that are fully deterministic.

The migration system has 11 migrations. Of these, 4 are pure JSON transforms (001, 006, 009, 011) and 7 involve markdown merging that benefits from Claude's judgment. The 4 JSON migrations are candidates for static execution.

## Goals / Non-Goals

**Goals:**
- Allow migrations to define a TypeScript function (`static`) that transforms files without invoking Claude
- Support static-only, prompt-only, and mixed (static + prompt) migrations
- Convert existing JSON-only migrations (001, 006, 009, 011) to static
- Maintain full backward compatibility — existing tests pass without modification
- Fall back to Claude when a static transform fails and a prompt is available
- Update the `/create-migration` skill to scaffold static migrations

**Non-Goals:**
- Converting markdown-based migrations to static (they genuinely need Claude for merging into user-customized overrides)
- Changing the migration version tracking, ordering, or priority system
- Changing the test runner infrastructure or test case format

## Decisions

### 1. Static function signature

```typescript
type StaticFileResult = string | { delete: true };

static?: (files: Record<string, string | null>) => Record<string, StaticFileResult>;
```

The function receives file contents keyed by path (`null` if the file doesn't exist). It returns a map of files to write — keys present in the return get written, keys absent are untouched, `{ delete: true }` deletes the file.

**Why this over per-file transforms:** Migrations like 006 touch multiple files (config.json + user-preferences.json) with interdependent logic. A single function with access to all files is simpler than coordinating multiple per-file transforms.

**Why path-keyed:** The test runner rewrites file paths to point at temp directories. The static function identifies files by suffix (e.g., `path.endsWith("config.json")`), making it transparent to path remapping.

### 2. Prompt becomes optional

```typescript
prompt?: string;  // was required
```

Static-only migrations set `prompt` to `undefined`. The engine skips the Claude invocation entirely. This is the main performance win.

**Alternative considered:** Keep `prompt` required as documentation. Rejected because the migration `name` + the static function code already serve as documentation, and a vestigial prompt that never runs is confusing.

### 3. Execution order: static before Claude

When a migration has both `static` and `prompt`, the static transform runs first. Claude then sees the already-transformed files. This supports a "prepare data statically, then let Claude handle the nuanced parts" pattern.

**Why not the reverse:** Static transforms are deterministic and fast. Running them first means Claude works with cleaner data. Running Claude first would mean the static transform can't rely on the file state.

### 4. Error fallback: static failure → Claude with error context

If `static` throws and a `prompt` exists, the engine catches the error and runs Claude with the original prompt plus an appended error message:

```
The static transform for this migration failed with: <error message>.
Please complete the migration manually by following the original instructions.
```

If `static` throws and no `prompt` exists, the migration fails (same as a Claude failure today).

**Why:** Static transforms operate on user-editable JSON files. Malformed JSON, unexpected schema, or missing fields could cause failures. Claude can often handle these edge cases more gracefully.

### 5. No changes to test infrastructure

The test runner calls `executeMigration()` which now handles both paths internally. Test cases define inputs and validators — they don't care whether the migration used static or Claude. The 4 converted migrations must produce identical outputs.

## Risks / Trade-offs

**[Static transform correctness]** → Mitigated by existing tests. Each converted migration has test cases that validate outputs. Running the test suite after conversion confirms identical behavior.

**[Edge cases in user-edited JSON]** → Mitigated by Claude fallback. If `JSON.parse` fails on a corrupted config.json, the fallback path lets Claude attempt recovery. For static-only migrations without a prompt, the migration fails — but this is the same behavior as today when Claude encounters unrecoverable errors.

**[Maintaining two code paths]** → Acceptable complexity. The engine change is ~20 lines. The two paths (static vs Claude) are clearly separated and independently testable.
