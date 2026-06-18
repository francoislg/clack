## Context

Memory entries are keyed by stable, namespaced ids (`clack-pr:pr-4499`, `asana:asana-1214…`, `note:<slug>`). The `recall` tool already keyword-matches ids and reference recipes, and a core-owned daily review (`src/memory/dailyReview.ts`) already walks every entry. What's missing is any signal IN the system prompt about what memory holds, so Claude rarely consults it proactively. The store is read through `loadMemoryStore()` (cached after first read); `buildSystemPrompt` is synchronous.

## Goals / Non-Goals

**Goals:**
- Tell Claude, every session, which KINDS of things memory currently tracks — derived live so any new namespace appears with zero code change.
- Nudge Claude to recall an item's context before continuing prior work on it.
- Let any role use the memory tools.

**Non-Goals:**
- No per-item index in the prompt (kinds only; specifics come from `recall`).
- No counts.
- No guaranteed auto-join between a fetched PR/session and its memory entry (a possible future hardening, explicitly deferred).
- No new cron, no persisted derived file.

## Decisions

**Derive at prompt-build time, not via a cron-written file.** The set of tracked kinds is a pure projection of the store. Computing it when the system prompt is assembled is always fresh and free (the store is cached); a periodically-written file would only ever be a staler copy and would couple a core behavior to whatever cron writes it. Rejected: having the daily review emit a `tracked-memory-items.md`.

**A "kind" is the id namespace — the segment before the first `:`.** This is already the entry-id convention (`<namespace>:<local-id>`), so grouping by it needs no new field and directly realizes "remember anything under a new namespace and it shows up as its own kind." Ids without a `:` carry no namespace and are skipped. Rejected: grouping by `references[].kind` (absent on note-style entries; an entry can carry several).

**Thread the rendered block through `PromptOptions`, keep `buildSystemPrompt` synchronous.** Reading the store is async; rather than make the prompt builder async (it has multiple sync callers), the async derivation happens in `buildQuerySetup` (already async) and the rendered string is passed in as `PromptOptions.trackedMemoryKinds` — the same pattern already used for `mcpRegistry`, `userSkills`, etc. Absent option → no section.

**Gate the injection where the memory faculty exists.** The block is only useful where `recall` is available. Since the faculty now spans all roles, the block is computed for every query session; the empty-store case renders nothing, so zero-memory deployments see no change.

**Open the faculty to everyone (member+).** Memory is framed as "remember anything"; gating writes to dev+ contradicts that. `canAccessMemory` widens to `member`. The internal `system` cron actor still passes `meetsMinimumRole`.

## Risks / Trade-offs

- [Members can now write/forget/archive memory, including entries other roles rely on] → Memory is single-store and already trusted to the daily review and any dev; the faculty has no destructive blast radius beyond its own store, and `forget`/`archive` honor pre-expire vetoes. Accepted for the stated goal.
- [Prompt growth as namespaces proliferate] → Only distinct kinds are listed, not items; the set is small and bounded by how many namespaces exist, not by entry count.
- [Naming a kind reveals a namespace exists to any user] → Kinds are coarse labels (`note`, `clack-pr`), not contents; `recall` already governs access to specifics and is unchanged.
