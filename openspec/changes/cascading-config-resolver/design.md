## Context

The current instruction system uses four flat files (`instructions.md`, `user_instructions.md`, `dev_instructions.md`, `admin_instructions.md`) resolved through a two-tier chain (custom override > shipped default). Prompt composition concatenates the base file with exactly one role file. This makes it impossible to override just one topic for a role level — customizing any aspect requires duplicating the entire role file.

The system is backed by:
- `src/instructions.ts` — `loadInstructions()` with hardcoded filenames and role selection logic
- `src/configurationFiles.ts` — `listInstructionFiles()` with a static `ROLE_INSTRUCTION_FILES` array
- MCP tools in `src/tools/` — `list_config_files`, `read_config_file`, `propose_config_update`
- Home Tab in `src/slack/homeTab.ts` — `buildConfigurationSection()` listing each file as a row

Per-repo instruction files (`{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`) are a separate concern consumed by `src/changes/execution.ts` and are not affected by this change.

## Goals / Non-Goals

**Goals:**
- Enable granular overriding of individual instruction topics per role level
- Allow drop-in custom files (no registry, no config update — just add a file)
- Provide admins visibility into resolved vs default instruction state
- Maintain the two-tier chain (shipped default vs user override) within the new structure
- Migrate existing deployments automatically

**Non-Goals:**
- Changing per-repo instruction files (`{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`)
- Adding a UI-based file editor in the Home Tab (editing stays via chat with Clack)
- Supporting non-markdown instruction files
- Conditional file inclusion beyond role cascading (e.g., per-channel or per-user instructions)

## Decisions

### 1. Role directories replace flat files

**Decision**: Replace `instructions.md` + `{role}_instructions.md` with `user/`, `dev/`, `admin/`, `owner/` directories containing topic-specific `.md` files.

**Rationale**: The base `instructions.md` content is effectively "what everyone gets" — that's the `user/` directory. Role-specific overlays become topic files in their role's directory. This gives 1:1 mapping between a topic and a file, making overrides surgical.

**Alternative considered**: Keep a `shared/` directory separate from `user/` for truly universal content. Rejected because it adds a concept that doesn't map to the role hierarchy — `user/` already means "everyone gets this."

### 2. CascadingConfigResolver takes an ordered `string[]`

**Decision**: The resolver is a pure function that takes `string[]` (e.g., `["user", "dev"]`). A separate `buildRoleChain()` function constructs the array based on role and `changesWorkflowEnabled`.

**Rationale**: Separating the resolver from the business logic of which roles apply makes the resolver testable and reusable. The `changesWorkflowEnabled` gating stays in `buildRoleChain()`:
- Dev layer is only included when changesWorkflow is enabled AND role is dev+
- Admin layer is always included when role is admin+ (admins keep config management powers even without changesWorkflow)
- This enables `["user", "admin"]` — admin without dev instructions

**Alternative considered**: Resolver takes `UserRole` + `changesWorkflowEnabled` directly. Rejected because it couples resolution logic to business rules, making it harder to test and extend.

### 3. Resolution order: interleaved role × tier

**Decision**: For each filename, the cascade checks in this order (last existing file wins):
```
default/user/{file} → custom/user/{file} → default/dev/{file} → custom/dev/{file} → ...
```

**Rationale**: This means a shipped `default/dev/changes.md` always beats a custom `configuration/user/changes.md`. The role cascade takes priority, and within each role level, custom overrides default. This matches the mental model: "dev instructions override user instructions, and my customizations override shipped defaults at each level."

**Alternative considered**: Resolve two-tier first (per file), then cascade. Rejected because it creates a confusing precedence where a user-level custom override could beat a shipped dev-level default.

### 4. Dynamic file discovery via directory scanning

**Decision**: Scan role directories at resolution time using `readdirSync`. No hardcoded file list or registry.

**Rationale**: Enables the "drop-in" UX — users create `configuration/user/company-context.md` and it's automatically discovered. The current `ROLE_INSTRUCTION_FILES` constant is eliminated. Custom files with no default counterpart are purely additive (no matching file at a higher role means no override).

**Alternative considered**: Maintain a manifest file listing known instruction files. Rejected because it adds friction and defeats the purpose of easy customization.

### 5. Empty files suppress instructions

**Decision**: An empty file (or whitespace-only) at a higher role level means "this instruction does not apply at this role." The content is excluded from the final prompt.

**Rationale**: The main use case is `user/changes.md` ("never suggest code changes") being overridden by `dev/changes.md` (which teaches how to propose changes). But sometimes the override is "just remove this restriction" with nothing to replace it. An empty file signals intent clearly.

### 6. Smart file placement for config updates

**Decision**: Claude's admin instructions teach it to analyze existing files before proposing config updates. Claude decides whether to merge into an existing file, create a new one, or ask the user when uncertain.

**Rationale**: The tool API stays simple (`propose_config_update` takes a path and content). The intelligence lives in the instructions, not the tool. This leverages Claude's ability to understand content semantics without building complex file-matching logic.

### 7. `read_config_file` returns both default and custom content

**Decision**: The tool returns `{ file, default_content, custom_content }` — no `resolved_content` since it's just `custom_content ?? default_content`.

**Rationale**: Admins need to compare what shipped vs what they've customized. Returning both enables Claude to diff and explain changes. The resolved value is trivially derivable and redundant.

### 8. Home Tab shows per-directory summaries

**Decision**: Replace per-file rows with one line per role directory showing file counts and customization status (e.g., `user/ — 5 default, 2 custom`).

**Rationale**: With dynamic file discovery, the number of files can grow. Per-directory summaries keep the Home Tab compact. Detailed file inspection happens via chat with Clack.

### 9. Default file split

**Decision**: Split the current shipped defaults into these topic files:

```
user/
├── identity.md          — product expert persona, tool access intro, MCP integrations
├── urls.md              — URL → MCP tool mapping (Sentry, GitHub patterns)
├── response-style.md    — how to respond, no hallucination, silent investigation
├── submit-response.md   — submit_response usage, actions by delivery context, length limits
└── changes.md           — "Information Only" restriction (no code changes)

dev/
├── github.md            — GitHub MCP tools, PR review checking
└── changes.md           — propose_change workflow, auto-execute rules

admin/
└── config-updates.md    — propose_config_update workflow, config management
```

**Rationale**: Each file covers one cohesive topic that might plausibly need role-specific overriding. The split avoids files that are too granular (one file per paragraph) or too coarse (defeats the purpose).

## Risks / Trade-offs

**[Risk] File ordering in concatenation is non-deterministic across platforms** → Mitigation: Sort filenames alphabetically before concatenation. Document that file naming affects prompt order. Consider numbered prefixes if ordering becomes critical later.

**[Risk] Migration splits user overrides incorrectly** → Mitigation: Claude-powered migration with clear section-matching instructions. Migration is blocking (runs before startup) so failures are caught immediately. Users can re-customize if the split is imperfect.

**[Risk] Directory scanning on every request adds I/O** → Mitigation: `readdirSync` on small directories (<20 files) is negligible. If needed later, add a file watcher or cache with TTL. Premature optimization not warranted.

**[Risk] Empty-file override semantics may confuse users** → Mitigation: Document the convention. The `read_config_file` tool can surface empty files as "suppressed" in its response so admins understand the effect.

**[Trade-off] Alphabetical file ordering means file names affect prompt structure** — Accepted. The alternative (explicit ordering via frontmatter or manifests) adds complexity for minimal benefit since Claude is insensitive to section ordering within a system prompt.

**[Trade-off] `user/` directory name vs "member" role name** — The directory is named `user/` (not `member/`) because it represents "instructions for all users," not just the member role. This is a slight naming mismatch with the role system but is more intuitive.

## Migration Plan

1. **Restructure shipped defaults** (in `data/default_configuration/`): Create `user/`, `dev/`, `admin/` directories with split files. Remove old flat files. This is a code change, not a runtime migration.
2. **Blocking boot migration**: Runs on first startup after upgrade. Claude reads existing `data/configuration/` overrides and splits them into the new directory structure using section-aware splitting. Old flat files are deleted after the new files are created (via the migration engine's `deleteAfter` mechanism).
3. **Rollback**: Since the migration is Claude-powered and content-preserving, the split files contain all original content. Manual restoration would require re-merging files, but this is unlikely since the split is a strict improvement.

## Open Questions

- Should file ordering use alphabetical sort or introduce numbered prefixes (e.g., `01-identity.md`)? Alphabetical is simpler but gives less control.
- Should the `owner/` directory be created empty by default, or omitted entirely until needed?
