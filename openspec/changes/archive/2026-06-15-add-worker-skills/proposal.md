## Why

The Changes Workflow worker performs git-heavy procedures (rebasing, conflict resolution, splitting commits) with no codified, reusable guidance — every run re-derives the steps, and there's no way to ship a vetted procedure with the app or to tune it per repository. The motivating case is teaching Clack a reliable `rebase` procedure that ships built-in yet stays overridable.

The codebase already has the right primitive hiding in plain sight: an instruction file is "always in context," a topic file is "in context when attached," and a skill is just "trigger in context, body loaded on demand." We can express worker skills as **lazy instruction files** — reusing the two-tier `default_configuration/` (git-committed) → `configuration/` (runtime override) resolution, the config watcher's hot-reload, and the existing `{repo}/...` path convention — instead of standing up a parallel store.

## What Changes

- Introduce **worker skills**: `SKILL.md` files (frontmatter `description` = trigger, body = procedure) resolved through the existing two-tier instruction chain.
  - **Built-in / global**: `skills/<slug>/SKILL.md` (ships in `default_configuration/`, overridable in `configuration/`).
  - **Per-repo**: `{repo}/skills/<slug>/SKILL.md` (same two tiers), masking the global skill of the same slug. Per-repo scoping is **path-based** — no metadata field.
- The worker execution system prompt gains a **WORKER SKILLS** catalog block (one `- <slug> — <description>` line per resolved skill) when at least one skill resolves for the run's repo.
- `load_skill` becomes available in **worker mode** to fetch a skill body on demand, mtime-cached so edits hot-reload mid-run. Worker skills load via a dedicated source (not the `user-skills` pack).
- Ship a built-in **`rebase`** skill (`default_configuration/skills/rebase/SKILL.md`) carrying the branch-rebase procedure.
- **Scope (initial):** consumption is **worker-mode only**. Query mode already has its own lazy-skill surface (`lazy-skill-loading` + `user-created-skills`); extending there is deferred and is a trivial follow-up.
- **Non-goals:** no member-authored CRUD (`propose_skill_*`), no ownership/`editableByAnyone`/disable metadata, no Home Tab UI. Worker skills are operator-managed via file edits (git or the `configuration/` override), matching the trust model for autonomous code-writing.

## Capabilities

### New Capabilities
- `worker-skills`: built-in, overridable, lazily-loaded procedure skills resolved from the two-tier config directories (global + per-repo), surfaced to the Changes Workflow worker via a prompt catalog and an on-demand `load_skill`, plus the shipped `rebase` skill.

### Modified Capabilities
<!-- None. worker-tools' existing requirements are unchanged; the new load_skill-in-worker requirement is owned by the worker-skills capability. -->

## Impact

- **New code:** `src/changes/workerSkills.ts` (discovery + body resolution across global/per-repo two-tier), a worker-skills catalog builder, a worker `load_skill` tool (`src/tools/worker/`), an mtime body cache.
- **Edits:** `src/changes/execution.ts` (append catalog to `EXECUTION_SYSTEM_PROMPT`), `src/tools/server.ts` `buildWorkerTools` (register the tool), reuse exported `parseFrontmatter`/`extractBody`/`validateSlug` from `src/userSkills.ts`.
- **Shipped content:** `data/default_configuration/skills/rebase/SKILL.md`.
- **No config schema change** is strictly required (resolution is path-based), and no change to query-mode behavior. Strings stay English (worker is the via-Claude/autonomous path).
