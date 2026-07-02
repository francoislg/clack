# repo-setup-memory Specification (delta)

## ADDED Requirements

### Requirement: Recall tool in worker and tester toolbelts

The system SHALL include the `recall` memory-search tool in both the worker toolbelt (`buildWorkerTools`) and the tester toolbelt (`buildTesterTools`), alongside the already-present `remember` tool, so worker-mode and tester-mode Claude can read memory as well as write it.

#### Scenario: Worker toolbelt includes recall

- **WHEN** the worker toolbelt is built for an implement-kind change
- **THEN** the tool list includes both `remember` and `recall`

#### Scenario: Tester toolbelt includes recall

- **WHEN** the tester toolbelt is built (`kind: "test"`)
- **THEN** the tool list includes both `remember` and `recall`

### Requirement: Keyed setup memory entries

The system SHALL use one living memory entry per repository per run kind to hold learned setup knowledge, keyed `worker-setup:<repo>` for worker runs and `tester-setup:<repo>` for tester runs. The entry SHALL be maintained with replace semantics — re-remembering the id rewrites the entry to the current full recipe — and SHALL NOT carry a `staleAfter.date`, so it is never auto-pruned. The entry's `what` SHALL be free-text markdown structured by prompt convention (Services catalog, Prerequisites, Doc sources, Quirks); no schema change to the memory registry is made.

#### Scenario: Entry converges instead of accumulating

- **GIVEN** a `tester-setup:<repo>` entry exists from a previous run
- **WHEN** a tester run discovers that a recorded step no longer applies and new prerequisites exist
- **THEN** the run re-remembers the same id with the corrected, current full recipe
- **AND** the entry reads as a single clean recipe, not a run-by-run history

#### Scenario: Setup entries are never auto-pruned

- **GIVEN** a `worker-setup:<repo>` entry written months ago
- **WHEN** the daily memory review prunes expired entries
- **THEN** the setup entry survives, because it carries no `staleAfter.date`

#### Scenario: Concurrent runs race on the same entry

- **GIVEN** two runs of the same kind on the same repo both rewrite the keyed entry
- **WHEN** both `remember` calls complete
- **THEN** the entry holds one run's complete recipe (last-writer-wins on the whole entry, per the memory store's serialized writes), never a partial merge
- **AND** this is acceptable for advisory content — no additional coordination is required

### Requirement: Deterministic learned-notes injection

The system SHALL look up the run kind's keyed setup entry server-side at prompt-build time (`getMemory`) and inject its content into the system prompt as a clearly-labeled notes-from-previous-runs section — for worker runs in the execution prompt assembly, and for tester runs in the tester system prompt (fetched by the caller and passed into the pure prompt builder). When no entry exists, or the lookup fails, the section SHALL be omitted entirely and the run proceeds as a normal cold run — never an error.

#### Scenario: Notes injected when an entry exists

- **GIVEN** `tester-setup:acme-app` exists in memory
- **WHEN** a tester run is launched for repo `acme-app`
- **THEN** the tester system prompt contains a notes-from-previous-runs section with the entry's content
- **AND** no tool call is required for the notes to be present

#### Scenario: Cold run on a repo with no entry

- **GIVEN** no `worker-setup:acme-app` entry exists
- **WHEN** a worker run is launched for repo `acme-app`
- **THEN** the system prompt contains no notes section
- **AND** the run proceeds normally

#### Scenario: Memory store failure degrades to cold run

- **GIVEN** the memory store lookup throws or returns null
- **WHEN** the prompt is assembled
- **THEN** the prompt is built without the notes section and the run is not aborted

### Requirement: Record, verify, and rewrite directive

The worker and tester system prompts SHALL instruct Claude to (1) start from the injected learned notes when present, (2) treat them as advisory descriptions of the repo *as last seen* — when a noted step fails or conflicts with the repository's actual state, trust the repository, and (3) at the end of the run, if setup knowledge changed (additions, corrections, or removals), rewrite the keyed entry via `remember` with the current full recipe rather than appending deltas. The directive SHALL suggest cross-linking the sibling entry for the same repo via `linkedMemories`.

#### Scenario: Repo evolved past the notes

- **GIVEN** the injected notes say the app boots on port 3000
- **WHEN** the tester finds the repo's config now uses port 4123
- **THEN** the tester follows the repository's actual state
- **AND** rewrites `tester-setup:<repo>` with the corrected port at end of run

#### Scenario: Nothing changed

- **GIVEN** the injected notes match reality and the run learns nothing new
- **WHEN** the run ends
- **THEN** no `remember` rewrite is required

#### Scenario: Memory write failure at end of run is non-fatal

- **GIVEN** setup knowledge changed during the run
- **WHEN** the end-of-run `remember` call fails (store error, disk issue)
- **THEN** the run's deliverable (PR work or recording/report) is unaffected — the failure only means the notes are not updated for the next run

### Requirement: Docs-as-provenance convention

The setup memory convention SHALL store both the recipe (exact steps — the fast path) and the repository documentation sources the recipe was derived from (e.g. README, CONTRIBUTING, docs/, workspace manifests). The prompt directive SHALL instruct that when a recipe step fails, Claude re-reads the recorded doc sources to repair the recipe, then rewrites the entry with both the corrected steps and updated pointers.

#### Scenario: Recipe step fails, docs heal it

- **GIVEN** the notes record `boot: pnpm dev` derived from `apps/web/README.md`
- **WHEN** that command fails because the repo switched to `pnpm start:dev`
- **THEN** Claude re-reads `apps/web/README.md`, uses the documented command
- **AND** the rewritten entry carries the corrected step and its doc source

### Requirement: Tester discovery phase

The tester system prompt WORKFLOW SHALL begin with a discovery phase ahead of boot: (1) determine which service(s) the change under test requires by intersecting the branch diff with the repo's service catalog (from the injected notes when present, otherwise discovered from repository documentation and workspace manifests), (2) map and set up the prerequisites for those services (env files, dependent services such as databases, build-first packages), and (3) boot the required subset. The memory entry SHALL hold the per-repo service catalog (names, boot commands, ports, dependencies, doc sources); the choice of which subset to launch SHALL be re-derived every run from the diff and never memorized.

#### Scenario: Monorepo run with a warm catalog

- **GIVEN** `tester-setup:<repo>` holds a catalog of services web/api/worker with web depending on api and a database
- **WHEN** a tester run's diff touches only the web package
- **THEN** the tester boots web plus its dependencies (api, database) and not the unrelated worker service

#### Scenario: First run builds the catalog

- **GIVEN** no setup entry exists for a monorepo
- **WHEN** the tester run starts
- **THEN** it discovers the service layout from repo documentation and manifests before booting
- **AND** records the discovered catalog (with doc sources) in `tester-setup:<repo>` at end of run

#### Scenario: Discovery finds no usable documentation

- **GIVEN** no setup entry exists and the repo has no or ambiguous setup documentation
- **WHEN** the tester run starts
- **THEN** discovery proceeds best-effort from the repository's contents (manifests, scripts, config files)
- **AND** if the app still cannot be booted, the existing boot-failure path applies (report the failure via `report_status` and stop)
- **AND** whatever partial catalog was learned is still recorded for the next run

#### Scenario: Subset decision is per-run

- **GIVEN** a previous run booted only the web service
- **WHEN** a new run's diff touches the api package
- **THEN** the subset is re-derived from the new diff (api and its dependencies), not replayed from memory

### Requirement: Learned notes are advisory under blessed instructions

Operator-authored instruction files (`test_instructions.md`, `tester_data_setup_instructions.md`, `changes_instructions.md`) SHALL remain authoritative: the prompt SHALL instruct that injected learned notes fill gaps the blessed files do not cover and yield to them on conflict. The system SHALL NOT auto-write learned content into any instruction file; folding stabilized notes into a blessed file remains a manual admin action through the existing `propose_config_update` flow.

#### Scenario: Blessed file wins on conflict

- **GIVEN** `test_instructions.md` specifies a seed command and the learned notes record a different one
- **WHEN** the tester runs
- **THEN** the blessed file's command is followed
- **AND** the end-of-run rewrite corrects the notes to match reality (dropping or amending the conflicting step) so the entry converges toward the blessed state

#### Scenario: No automatic graduation

- **WHEN** a run rewrites its setup memory entry
- **THEN** no instruction file on disk is created or modified by the system
