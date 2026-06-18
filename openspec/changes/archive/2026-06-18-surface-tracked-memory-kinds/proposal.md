## Why

Clack's memory is a strong recall surface, but Claude only consults it if it happens to choose to — nothing in the system prompt tells it WHAT kinds of things are currently tracked, so "continue work on PR X" or "what did we say about that Asana ticket" frequently skip memory entirely. And because memory is dev+ gated, a plain member can't even ask Clack to remember a fact, which is at odds with memory being framed as a general "remember anything" faculty.

## What Changes

- Inject a short, dynamically-derived block into the system prompt naming the KINDS of things currently in memory — the distinct id namespaces present in the store (e.g. `clack-pr`, `asana`, `fun`, `note`). The list is computed live from the store at prompt-build time (when the system prompt is assembled), so any new namespace a caller remembers under (`fun:dad-joke`, `incident:...`) surfaces automatically with no code change. It names kinds only — Claude uses `recall` to fetch the specific items on demand.
- Add a baseline instruction telling Claude to `recall` an item's prior context (and `nextSteps`) before continuing, resuming, or following up on an existing PR, branch, issue, ticket, or thread.
- **BREAKING** (relative to the current spec): make the memory tools (`remember`, `recall`, `forget`, `archive`, `get_archived`, `prune_archive`) available to ALL roles (member+), not dev+. Anyone can ask Clack to remember or recall a fact.

## Capabilities

### New Capabilities
- `tracked-memory-kinds`: The system prompt advertises which memory namespaces are currently populated and instructs Claude to recall an item's context before continuing prior work. Covers the live namespace derivation, the prompt-build-time injection (gated to sessions where the memory faculty is available), and the empty-store omission.

### Modified Capabilities
- `memory-faculty`: The memory tools' role gate widens from dev+ to all roles (member+). The "Member role cannot write memory" behavior is removed.

## Impact

- `src/permissions.ts` — `canAccessMemory` widens to `member`.
- `src/tools/server.ts` — gating comment (no behavior change beyond the widened predicate).
- `src/memory/trackedKinds.ts` (new) — live namespace derivation + prompt block builder.
- `src/claude/promptBuilder.ts` — new `PromptOptions.trackedMemoryKinds` injected into the assembled system prompt.
- `src/claude/index.ts` — compute the block in `buildQuerySetup` and pass it through.
- `data/default_configuration/user/memory.md` (new baseline instruction) — recall-before-continue guidance.
- No data migration: derives entirely from the existing `memory.json` store; absent/empty store yields no injected section.
