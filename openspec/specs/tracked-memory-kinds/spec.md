# tracked-memory-kinds Specification

## Purpose
TBD - created by archiving change surface-tracked-memory-kinds. Update Purpose after archive.
## Requirements
### Requirement: System prompt advertises currently-tracked memory kinds

The system SHALL inject into the assembled system prompt a section naming the distinct KINDS of things currently held in memory, derived live from the memory store at prompt-build time (not from a persisted or periodically-written file). A "kind" SHALL be the namespace of an entry `id` — the substring before its first `:` (`clack-pr:pr-4499` → `clack-pr`, `fun:dad-joke-1` → `fun`). Entry ids with no `:` carry no namespace and SHALL be excluded. The section SHALL list the distinct namespaces only (sorted, de-duplicated) — not individual entries and not counts — so that any new namespace a caller remembers under surfaces automatically with no code change. When the store holds no namespaced entries, NO section SHALL be injected (the prompt is unchanged).

#### Scenario: Distinct namespaces are surfaced

- **GIVEN** memory holds entries `clack-pr:pr-4499`, `clack-pr:pr-4468`, `asana:asana-1214`, and `fun:dad-joke-1`
- **WHEN** the system prompt is assembled
- **THEN** the injected section lists the kinds `asana`, `clack-pr`, and `fun` once each, sorted and de-duplicated
- **AND** it lists no per-entry ids and no counts

#### Scenario: A newly-introduced namespace appears with no code change

- **GIVEN** a user asks Clack to remember a fact under a brand-new namespace `incident:2026-06-18-outage`
- **WHEN** a later session assembles its system prompt
- **THEN** `incident` appears among the tracked kinds

#### Scenario: Ids without a namespace are ignored

- **GIVEN** memory holds an entry whose `id` contains no `:`
- **WHEN** the tracked-kinds section is built
- **THEN** that entry contributes no kind

#### Scenario: Empty store injects nothing

- **GIVEN** the memory store holds no namespaced entries
- **WHEN** the system prompt is assembled
- **THEN** no tracked-kinds section is injected and the prompt is otherwise unchanged

### Requirement: Recall before continuing prior work

Clack's baseline instructions SHALL direct it to call `recall` for an item's prior context — and prefer its recorded `nextSteps` — before continuing, resuming, or following up on an existing PR, branch, issue, ticket, or thread, and to proceed with its default handling for the request when `recall` returns nothing.

#### Scenario: Continue-work request consults memory first

- **GIVEN** memory holds an entry for an existing PR with recorded `nextSteps`
- **WHEN** a user asks Clack to continue work on that PR
- **THEN** Clack's instructions direct it to recall the entry and honor its `nextSteps` before acting

#### Scenario: No prior memory does not block

- **GIVEN** a user asks Clack to continue work on something with no memory entry
- **WHEN** Clack recalls and finds nothing
- **THEN** it proceeds normally without error

