## Context

The Changes Workflow worker (`executeChange()` in `src/changes/execution.ts`) builds its own `EXECUTION_SYSTEM_PROMPT` plus the per-repo `{repo}/changes_instructions.md`, and gets a small worker tool set from `buildWorkerTools()` in `src/tools/server.ts`. It has no skill catalog and no `load_skill` — both live only on the query path (`src/claude/index.ts`, gated on `ctx.skillsManager`).

Three skill-like surfaces already exist: SDK skill **packs** (`lazy-skill-loading`, plugin dirs), member-authored **user skills** (`user-created-skills`, `data/user-skills/`, runtime/gitignored), and the **instruction system** (`default_configuration/` → `configuration/` two-tier, role-keyed cascade, plus non-role per-repo files resolved by `resolveInstructionFile`). None ships a built-in, overridable, lazily-loaded procedure for the worker.

## Goals / Non-Goals

**Goals:**
- Ship a built-in, overridable `rebase` procedure the worker loads on demand.
- Reuse the two-tier config resolution (git-committed default + runtime override) and hot-reload rather than a parallel store.
- Support global and per-repo worker skills with path-based scoping.
- Keep the worker prompt lean: triggers always present, bodies lazy.

**Non-Goals:**
- Query-mode consumption (deferred; query already has lazy-skill surfaces).
- Member-authored CRUD, ownership/`editableByAnyone`/disable metadata, Home Tab UI.
- A config-schema flag — discovery is presence-driven; no skills ⇒ no behavior change.
- Unifying `user-created-skills` onto this primitive (possible later refactor).

## Decisions

### D1 — Worker skills are lazy instruction files, resolved two-tier
A worker skill is a `SKILL.md` (frontmatter `description` = always-in-context trigger; body = the procedure) resolved through the existing chain: `configuration/<path>` overrides `default_configuration/<path>`.
- **Global:** `skills/<slug>/SKILL.md`
- **Per-repo:** `{repo}/skills/<slug>/SKILL.md`

*Why over alternatives:* extending `user-created-skills` with `worker`/`repository` attributes can't ship a **built-in** (its store is gitignored/runtime) and carries a member-authored trust model wrong for autonomous code-writing. A dedicated `worker-skills/` dir reinvents the two-tier default→override resolution the config dirs already provide. The instruction chain gives git-committed defaults, runtime override, hot-reload, and a proven non-role path convention (`changes_instructions.md`) for free.

### D2 — Slug from directory; only `description` frontmatter is required
The slug is the directory name (validated by the existing `validateSlug`). Discovery reuses `parseFrontmatter`/`extractBody` (exported from `src/userSkills.ts` so there's one parser). Only `description` is read for the catalog; other frontmatter keys (e.g. the pasted `argument-hint`, `allowed-tools`) are ignored harmlessly. A skill missing a `description` or with an invalid slug is skipped (logged), never fatal — matching the graceful on-disk-read philosophy.

### D3 — Per-repo masks global by slug
When a slug resolves in both the global and per-repo scopes for a run, the per-repo skill wins (more specific). Within each scope, `configuration/` masks `default_configuration/`. This is the same "most-specific tier wins" model the rest of the config system uses.

### D4 — A dedicated worker `load_skill` tool, not the query tool reused
Register `load_skill({ skill })` in `buildWorkerTools()`. Single source ⇒ no `pack` argument. The query `load_skill` couples to `QueryToolContext`, `skillsManager`, and the `user-skills` pack; reusing it would drag that coupling into worker mode. A small worker tool reading worker-skill bodies (via an mtime-keyed cache mirroring `userSkillsBodyCache`) is cleaner. The worker context already carries `repoName`, so per-repo resolution works. MCP `mcp__clack__*` tools are auto-allowed, so no `allowedTools` edit is needed.

### D5 — Catalog injected into the execution prompt
After the `changes_instructions.md` append in `execution.ts`, append a `WORKER SKILLS` block (one `- <slug> — <description>` line per resolved skill, alphabetized) **only** when ≥1 skill resolves for the run's repo, plus a directive to call `load_skill({ skill })`. Absent skills ⇒ no block ⇒ byte-identical prompt to today.

### D6 — Strings stay English
The worker is the autonomous/via-Claude path; the catalog, tool description, and the shipped `rebase` body are Claude-facing, not direct-to-Slack — no `t()`.

## Risks / Trade-offs

- **`load_skill` name overlaps the query tool** → Acceptable: the two never coexist in one session (mode-separated). Documented in the tool description; signatures differ (`{ skill }` vs `{ pack, skill }`).
- **Frontmatter parser drift between user-skills and worker-skills** → Mitigated by exporting and sharing the single `parseFrontmatter`/`extractBody`/`validateSlug`.
- **Catalog grows with many skills** → Only trigger lines are always-present; bodies stay lazy. Same scaling profile as the user-skills catalog.
- **A bad built-in `rebase` body could mis-resolve conflicts** → The body itself instructs Claude to stop and ask on ambiguous conflicts and to surface `git rebase --abort`; not a system-level risk, and operators can override the file.
- **Per-repo path is in the config tree, not the repo checkout** → Intentional (consistent with `changes_instructions.md`); avoids letting target-repo contents steer the worker prompt.

## Migration Plan

Purely additive. Deploy ships `default_configuration/skills/rebase/SKILL.md` and the new code; with no other skills present, only `rebase` appears in the catalog. Rollback = remove the shipped skill file(s) and the worker `load_skill` registration; nothing persisted, no data migration.

## Open Questions

- Should query mode eventually surface the same built-in skills? Deferred; trivial to add a second catalog/consumer once the primitive exists.
- Do we want an operator kill-switch (config flag) to disable worker skills wholesale? Current decision: no — deleting/over­riding the file is sufficient.
