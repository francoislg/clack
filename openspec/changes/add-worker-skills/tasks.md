## 1. Shared parser exports

- [ ] 1.1 Export `parseFrontmatter`, `extractBody`, and `validateSlug` from `src/userSkills.ts` (they are currently module-private); leave existing behavior unchanged.
- [ ] 1.2 Add/adjust unit tests confirming the exported helpers parse a `description`-only frontmatter and strip the frontmatter block from the body.

## 2. Discovery + resolution

- [ ] 2.1 Create `src/changes/workerSkills.ts` with `discoverWorkerSkills(repoName): WorkerSkill[]` — enumerate global `skills/<slug>/SKILL.md` and per-repo `{repo}/skills/<slug>/SKILL.md` across both config tiers (`configuration` overrides `default_configuration`), derive slug from directory name, parse `description` + body via the shared helpers, skip invalid/description-less entries with a debug log (never throw).
- [ ] 2.2 Implement per-repo-masks-global and `configuration`-masks-`default_configuration` precedence (dedup by slug, most-specific wins).
- [ ] 2.3 Add `readWorkerSkillBody(repoName, slug): { ok: true; body } | { ok: false }` resolving a single slug with the same precedence, for the load tool.
- [ ] 2.4 Unit tests: built-in resolves; override masks default; per-repo masks global; missing description skipped; invalid slug skipped; empty result when no skills; extra frontmatter keys ignored.

## 3. Body cache

- [ ] 3.1 Create `src/changes/workerSkillsBodyCache.ts` — process-level mtime-keyed cache mirroring `userSkillsBodyCache.ts`, keyed by `(repoName, slug)`, re-reading on mtime mismatch.
- [ ] 3.2 Unit tests: first read populates cache; unchanged mtime returns cached; changed mtime re-reads; unknown slug returns not-found.

## 4. Catalog builder

- [ ] 4.1 Create a worker-skills catalog builder that renders the `WORKER SKILLS` block (alphabetized `- <slug> — <description>` lines + `load_skill({ skill })` directive), returning empty string when no skills resolve.
- [ ] 4.2 Unit tests: block rendered when ≥1 skill; alphabetized; empty string when none.

## 5. Worker load_skill tool

- [ ] 5.1 Create `src/tools/worker/loadSkill.ts` — `load_skill({ skill })` worker tool that resolves via `readWorkerSkillBody(ctx.repoName, skill)` through the mtime cache, returns body with a preamble, and returns a catalog-pointing error on unknown skill. No `pack` argument.
- [ ] 5.2 Register the tool in `buildWorkerTools()` in `src/tools/server.ts`.
- [ ] 5.3 Unit tests: returns body with preamble; hot-reload on mtime change; per-repo body wins; unknown skill error.

## 6. Wire into execution

- [ ] 6.1 In `src/changes/execution.ts`, after the `changes_instructions.md` append, call discovery for `worktree.repoName` and append the catalog block to `EXECUTION_SYSTEM_PROMPT` only when ≥1 skill resolves.
- [ ] 6.2 Unit test: prompt gains the block when a skill resolves; prompt byte-identical when none resolve.

## 7. Ship the built-in rebase skill

- [ ] 7.1 Create `data/default_configuration/skills/rebase/SKILL.md` with frontmatter `description` (rebase the current branch) and the branch-rebase procedure body (detect target/default branch, ensure not on target, fetch, check necessity, rebase, resolve conflicts or stop-and-ask on ambiguity, report). Drop the slash-command-only keys (`argument-hint`, `allowed-tools`) and `$ARGUMENTS` phrasing; write it as a procedure for Claude with its existing Bash access.
- [ ] 7.2 Add a test asserting the shipped `rebase` skill is discovered by default and loadable.

## 8. Verify

- [ ] 8.1 `npx tsc` clean; `npx oxlint` and `npx oxfmt --check` clean on touched files.
- [ ] 8.2 `npm test` green.
- [ ] 8.3 `openspec validate add-worker-skills --strict` passes.
- [ ] 8.4 Run `graphify update .` to keep the graph in sync with the new files.
