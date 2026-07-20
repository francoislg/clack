# plugin-sdk-boundary Specification

## Purpose

Defines the three-layer plugin architecture (plugins / plugins-sdk / plugins-core), the one-surface import rule for plugin code, the SDK façade and test-helper surfaces, and the static enforcement (guard test + partial oxlint rule) that makes boundary drift impossible.

## Requirements

### Requirement: Three-Layer Plugin Architecture

The plugin subsystem SHALL be laid out in three sibling directories: `src/plugins/` contains ONLY plugin directories (plus `CLAUDE.md`); `src/plugins-sdk/` is the plugin-facing SDK — its top-level files are the importable surface (`sdk.ts` façade, `testHelpers.ts` test surface, and the leaf modules `toolResults.ts`, `zodResult.ts`, `imageSearchResult.ts`), while `plugins-sdk/internal/` holds the implementation (`factory.ts`, `cron.ts`, `messaging.ts`, `users.ts`, `memory.ts`) that plugins can never import; `src/plugins-core/` holds the core-facing plugin loader (`registry.ts`, `state.ts`) and the boundary guard.

#### Scenario: plugins/ holds only plugins

- **WHEN** a `.ts` file is placed directly in `src/plugins/` (not inside a plugin directory)
- **THEN** the boundary guard test fails, directing SDK code to `src/plugins-sdk/` and loading infra to `src/plugins-core/`

### Requirement: One-Surface Import Rule for Plugin Code

A file under `src/plugins/<name>/**` (where `<name>` is any directory of `src/plugins/`) SHALL only import from or re-export from: (1) files inside its own plugin directory, (2) top-level files of `src/plugins-sdk/`, (3) npm packages, and (4) node builtins. Within the SDK surface, `plugins-sdk/testHelpers.js` is importable only from test files (`*.test.ts`), and `plugins-sdk/internal/**` is never importable from a plugin. Files matching `*.integration.test.ts` are exempt from this rule entirely.

#### Scenario: Plugin production file imports core

- **WHEN** a file under `src/plugins/trivia/**` imports a specifier that resolves to `src/tools/helpers.js`
- **THEN** the boundary guard test fails, naming the file, the specifier, and the fix (use the plugins-sdk surface, or grow it)

#### Scenario: Plugin file imports another plugin

- **WHEN** a file under `src/plugins/idler/**` imports a specifier resolving inside `src/plugins/trivia/`
- **THEN** the boundary guard test fails

#### Scenario: Plugin file imports the SDK implementation

- **WHEN** a file under `src/plugins/<name>/**` imports a specifier resolving inside `src/plugins-sdk/internal/`
- **THEN** the boundary guard test fails (and the oxlint boundary override reports it in-editor)

#### Scenario: Plugin file imports the plugin loader

- **WHEN** a file under `src/plugins/<name>/**` imports a specifier resolving inside `src/plugins-core/`
- **THEN** the boundary guard test fails (and the oxlint boundary override reports it in-editor)

#### Scenario: Prod file imports the test surface

- **WHEN** a production file (not matching `*.test.ts`) under `src/plugins/<name>/**` imports `src/plugins-sdk/testHelpers.js`
- **THEN** the boundary guard test fails

#### Scenario: Allowed imports pass

- **WHEN** a file under `src/plugins/<name>/**` imports only own-plugin files, top-level `plugins-sdk` files (`testHelpers.js` from a `*.test.ts` file only), npm packages, and node builtins
- **THEN** the boundary guard test passes for that file

#### Scenario: Integration tests keep the escape hatch

- **WHEN** a `*.integration.test.ts` file under `src/plugins/<name>/**` imports a core module (e.g. `src/plugins-core/state.js` or `src/mcp.js`)
- **THEN** the boundary guard test does not flag it

### Requirement: Static Boundary Guard Test

The repository SHALL contain a guard test (`src/plugins-core/pluginBoundary.guard.test.ts`) that statically enforces the one-surface rule by extracting every import/export-from/dynamic-import specifier from every `*.ts` file under `src/plugins/<name>/**` and resolving relative specifiers against the importing file's location. The guard SHALL have an empty exception list and SHALL NOT provide any per-file exemption mechanism beyond the two structural rules (integration-test exemption, plugins-sdk surface definition). The guard runs as part of `npm test`, which the pre-commit hook executes — a violation is uncommittable.

#### Scenario: Guard resolves rather than pattern-matches

- **WHEN** a plugin file escapes the boundary through an unusual relative depth that still resolves inside the repo
- **THEN** the guard resolves the specifier and fails, regardless of the textual shape of the path

#### Scenario: Clean tree passes

- **WHEN** the guard runs against a tree where every plugin file honors the one-surface rule
- **THEN** the guard passes with zero findings

### Requirement: In-Editor Boundary Lint (partial, non-authoritative)

The oxlint config SHALL carry a `no-restricted-imports` override scoped to `src/plugins/**/*.ts` banning specifier patterns `**/plugins-sdk/internal/**` and `**/plugins-core/**`, with messages pointing at the guard and the grow-the-surface remedy, and `*.integration.test.ts` files exempt (existing override ordering). This is in-editor feedback only for the two textually-unambiguous cases; the guard test is the authority, because general escape detection is resolution-dependent (a text pattern cannot distinguish a plugin's own `tools/` or `slack.ts` from core directories of the same name).

#### Scenario: Lint flags an internal import as you type

- **WHEN** a plugin file imports `../../plugins-sdk/internal/factory.js`
- **THEN** `npx oxlint` reports a `no-restricted-imports` error with the boundary message

### Requirement: SDK Surface Layout and Leaf Discipline

`src/plugins-sdk/` SHALL expose the plugin-facing surface at its top level: the `sdk.ts` façade, the `testHelpers.ts` test surface, and the pure leaf modules. Leaf modules (`toolResults.ts`, `zodResult.ts`, `imageSearchResult.ts`) SHALL import nothing that resolves inside `src/` (npm packages and node builtins only), enforced by the guard (which also fails if its leaf list names a missing file). Everything in `plugins-sdk/internal/` is bridge code and MAY import bot core.

Despite being the surface's anchor, `sdk.ts` SHALL remain **import-time light**: only `import type` declarations and pure modules (leaves, zod-schema-level Slack block tooling), never a value import that evaluates the bot-core module graph — this is what makes value-importing the façade safe from any plugin file. The SDK implementation (`createClackSdk` and its core wiring) lives in `plugins-sdk/internal/factory.ts` and is consumed by core (`plugins-core/registry.ts`), never by plugins.

#### Scenario: Leaf gains a core import

- **WHEN** `src/plugins-sdk/toolResults.ts` is edited to import `src/logger.js`
- **THEN** the boundary guard test fails, identifying the file as a leaf that must stay dependency-free

#### Scenario: Internal bridge imports core

- **WHEN** `src/plugins-sdk/internal/factory.ts` imports `src/config.js`
- **THEN** the guard does not flag it (internal is the sanctioned core-facing layer)

### Requirement: SDK Façade Module Surface

`src/plugins-sdk/sdk.ts` SHALL export, at module level, every pure helper and type that plugin code legitimately needs, so a plugin developer can get everything from one import. The façade SHALL include at minimum: `textResult`, `errorResult`, `MAX_TOOL_OUTPUT_CHARS` (from `toolResults.ts`); `zodErrorToResult` + `Result` (from `zodResult.ts`); the image-search result contract (from `imageSearchResult.ts`); the block tooling `BlockSchema`, `ALLOWED_BLOCK_TYPES`, `validateBlocks`, `postStructuredMessage`, `notificationText`, plus the `Block` and `SlackBlocks` types (from `src/slack/`); and the cron persistence types `CronJob`, `SkipDate`, `CreateCronJobParams`, `UpdateCronJobParams` (type re-exports from `src/cronJobs.ts`, used by plugin tests to type fake cron deps). Re-exports SHALL preserve the original public names and signatures.

#### Scenario: Plugin builds a tool result via the façade

- **WHEN** a plugin tool imports `textResult` from the façade and returns `textResult({ ok: true })`
- **THEN** the produced envelope is byte-identical to one built by core code using `src/tools/helpers.js`

#### Scenario: Plugin validates and posts blocks via the façade

- **WHEN** a plugin imports `BlockSchema`, `validateBlocks`, and `postStructuredMessage` from the façade and posts using a client obtained from `sdk.getSlackClient()`
- **THEN** validation and posting behave identically to the pre-change direct imports from `src/slack/`

#### Scenario: Façade removal is a compile error

- **WHEN** a façade export that a plugin consumes is removed from `sdk.ts`
- **THEN** `npx tsc` fails at the plugin's import site

### Requirement: Single Implementation for Shared Helpers

`textResult`/`errorResult`/`MAX_TOOL_OUTPUT_CHARS` SHALL have exactly one implementation, in `src/plugins-sdk/toolResults.ts`; `src/tools/helpers.ts` SHALL delegate to it (re-export) so existing core call sites are unchanged. Likewise `parseToolResult`/`toolResultText` SHALL have exactly one implementation, in `src/plugins-sdk/testHelpers.ts`, with `src/tools/testHelpers.ts` delegating. The per-plugin duplicate copies of `textResult`/`errorResult` (formerly in `src/plugins/casual-talk/helpers.ts` and `src/plugins/idler/helpers.ts`) SHALL be removed, with their call sites switched to the SDK surface.

#### Scenario: Core and plugin share one envelope implementation

- **WHEN** the envelope format in `src/plugins-sdk/toolResults.ts` is changed
- **THEN** both core tools (via `src/tools/helpers.js`) and plugin tools (via the façade) observe the change, with no second implementation to drift

#### Scenario: Duplicated plugin copies are gone

- **WHEN** the repository is searched for `export function textResult`
- **THEN** exactly one definition exists (`src/plugins-sdk/toolResults.ts`)

### Requirement: Test-Helper Surface

`src/plugins-sdk/testHelpers.ts` SHALL be the import surface for plugin test files needing plugin-agnostic test affordances: `parseToolResult` and `toolResultText` (implemented here), plus `createClackSdk` and `createMemorySurface` (passthroughs from `internal/`, for tests that construct a real SDK over a temp data dir). It is bridge-class (MAY import core) but SHALL only be importable from `*.test.ts` files under plugin directories, enforced by the boundary guard.

#### Scenario: Plugin unit test parses a tool result

- **WHEN** a plugin `*.test.ts` file imports `parseToolResult` from `plugins-sdk/testHelpers.js` and parses a `textResult(...)` envelope
- **THEN** parsing behaves identically to the pre-change import from `src/tools/testHelpers.js`

### Requirement: Documented Boundary With Sanctioned Façade Exception

`src/plugins/CLAUDE.md` SHALL state the one-surface rule in its hard-rules section, name the guard test as the enforcement mechanism (replacing the "a future lint/check may enforce these rules" wording), and document that the façade's export block in `plugins-sdk/sdk.ts` is the single sanctioned exception to the repository's no-re-export rule. The documented remedy for a missing capability SHALL be growing the SDK surface (module export if pure, instance member wired through `internal/factory.ts` if stateful), never adding a guard exception.

#### Scenario: Docs match enforcement

- **WHEN** a developer reads the hard-rules section of `src/plugins/CLAUDE.md`
- **THEN** the stated import rule matches exactly what `pluginBoundary.guard.test.ts` enforces, and the stated remedy for gaps is expanding the SDK surface
