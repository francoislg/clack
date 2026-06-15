## 1. Shared parser exports

- [x] 1.1 Export `parseFrontmatter`, `extractBody`, and `validateSlug` from `src/userSkills.ts` (they are currently module-private); leave existing behavior unchanged.
- [x] 1.2 Add/adjust unit tests confirming the exported helpers parse frontmatter that also carries extra keys (e.g. `argument-hint`, `allowed-tools`), extract only the `description` field, and strip the frontmatter block from the body.

## 2. Discovery + resolution

- [x] 2.1 Create `src/changes/workerSkills.ts` with `discoverWorkerSkills(repoName): WorkerSkill[]` — enumerate global `skills/<slug>/SKILL.md` and per-repo `{repo}/skills/<slug>/SKILL.md` across both config tiers (`configuration` overrides `default_configuration`), derive slug from directory name, parse `description` + body via the shared helpers, skip invalid/description-less entries with a debug log (never throw).
- [x] 2.2 Implement per-repo-masks-global and `configuration`-masks-`default_configuration` precedence (dedup by slug, most-specific wins).
- [x] 2.3 Add `readWorkerSkillBody(repoName, slug): { ok: true; body } | { ok: false }` resolving a single slug with the same precedence, for the load tool. Return `{ ok: false }` when the slug is unknown or the file is unreadable; never throw (debug-log read failures).
- [x] 2.4 Unit tests: built-in resolves; override masks default; per-repo masks global; missing description skipped; invalid slug skipped; empty result when no skills; extra frontmatter keys ignored.

## 3. Body cache

- [x] 3.1 Create `src/changes/workerSkillsBodyCache.ts` — process-level mtime-keyed cache mirroring `userSkillsBodyCache.ts`, keyed by `(repoName, slug)`, re-reading on mtime mismatch.
- [x] 3.2 Unit tests: first read populates cache; unchanged mtime returns cached; changed mtime re-reads; unknown slug returns not-found.

## 4. Catalog builder

- [x] 4.1 Create `src/changes/workerSkillsCatalog.ts` exporting `buildWorkerSkillsCatalog(skills: WorkerSkill[]): string` that renders the `WORKER SKILLS` block (alphabetized `- <slug> — <description>` lines + `load_skill({ skill })` directive), returning empty string when no skills resolve.
- [x] 4.2 Unit tests: block rendered when ≥1 skill; alphabetized; empty string when none.

## 5. Worker load_skill tool

- [x] 5.1 Create `src/tools/worker/loadSkill.ts` — `load_skill({ skill })` worker tool that resolves via `readWorkerSkillBody(ctx.repoName, skill)` through the mtime cache, returns body with a preamble, and returns a catalog-pointing error on unknown skill. No `pack` argument.
- [x] 5.2 Register the tool in `buildWorkerTools()` in `src/tools/server.ts`.
- [x] 5.3 Unit tests: returns body with preamble; hot-reload on mtime change; per-repo body wins; unknown skill returns an error that names the skill and directs Claude to the `WORKER SKILLS` catalog.

## 6. Wire into execution

- [x] 6.1 In `src/changes/execution.ts`, after the `changes_instructions.md` append, call discovery for `worktree.repoName` and append the catalog block to `EXECUTION_SYSTEM_PROMPT` only when ≥1 skill resolves.
- [x] 6.2 Unit test: prompt gains the block when a skill resolves; prompt byte-identical when none resolve.

## 7. Ship the built-in rebase skill

- [x] 7.1 Create `data/default_configuration/skills/rebase/SKILL.md` with frontmatter `description` (rebase the current branch) and the branch-rebase procedure body (detect target/default branch, ensure not on target, fetch, check necessity, rebase, resolve conflicts or stop-and-ask on ambiguity, report). Rewrite the body without `$ARGUMENTS` — worker skills have no argument substitution, so phrase the target-branch step as "if the user named a target branch, use it; otherwise detect the default". Slash-command-only frontmatter keys (`argument-hint`, `allowed-tools`) are harmlessly ignored by discovery and need not be carried.
- [x] 7.2 Add a test asserting the shipped `rebase` skill is discovered by default and loadable.

## 8. Verify

- [x] 8.1 `npx tsc` clean; `npx oxlint` and `npx oxfmt --check` clean on touched files.
- [x] 8.2 `npm test` green.
- [x] 8.3 `openspec validate add-worker-skills --strict` passes.
- [x] 8.4 Run `graphify update .` to regenerate the knowledge graph, and stage the updated `graphify-out/` so it is committed alongside the code (graphify-out is tracked).
