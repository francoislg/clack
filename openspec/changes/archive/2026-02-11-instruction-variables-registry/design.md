## Context

Instruction variables (`{REPOSITORIES_LIST}`, `{CHANGE_REQUEST_BLOCK}`, etc.) are currently defined in two disconnected places:
1. **Code**: `buildSystemPrompt()` in `claude.ts` builds the `variables` record ad-hoc
2. **Docs**: `admin_instructions.md` has a hardcoded table listing available variables

Adding a new variable requires updating both locations manually. The Home Tab admin UI (planned in `admin-edit-instructions`) will also need to display available variables — a third location to keep in sync.

## Goals / Non-Goals

**Goals:**
- Single source of truth for all instruction variables (name, description, availability)
- Auto-generate the admin variable reference table from the registry
- Export registry metadata for the Home Tab admin UI
- Keep `buildSystemPrompt()` as the owner of variable _values_ (runtime data)

**Non-Goals:**
- Changing how variables are interpolated (the `interpolateVariables()` function stays as-is)
- Adding new variables (this change only centralizes existing ones)
- Building the Home Tab UI itself (that's the `admin-edit-instructions` change)

## Decisions

### D1: Registry as a typed array of definitions

The registry is a simple exported array of `VariableDefinition` objects in `src/instructionVariables.ts`. Each definition has:
- `name`: The variable key (e.g. `"REPOSITORIES_LIST"`)
- `description`: Human-readable description
- `availability`: `"always"` | `"dev-admin"` — controls which instruction files can meaningfully use it

**Why**: A flat array is easy to iterate, filter, and extend. No need for a Map or class — these are static definitions, not runtime state.

### D2: Registry owns metadata, `buildSystemPrompt()` owns values

The registry defines _what variables exist_ and their descriptions. The `buildSystemPrompt()` function continues to build the actual _values_ at runtime using the same logic it has today.

The registry does **not** contain value-builder functions — it's purely declarative metadata.

**Why**: Variable values depend on runtime context (config, options, repos) that flows through `buildSystemPrompt()`. Extracting value builders would over-engineer things and add indirection for no real benefit. The registry's job is documentation and UI, not execution.

### D3: `AVAILABLE_VARIABLES` meta-variable generated from registry

A new helper function `buildAvailableVariablesTable()` generates the markdown table currently hardcoded in `admin_instructions.md`. This output is injected as the `{AVAILABLE_VARIABLES}` variable during interpolation.

**Why**: This keeps the admin docs always in sync with the registry. When a new variable is added to the registry, it automatically appears in the admin reference.

### D4: Variable key validation at build time

`buildSystemPrompt()` will assert that every registry-defined variable has a corresponding key in the variables record. This catches drift between the registry and the code.

**Alternative considered**: Runtime validation in `interpolateVariables()` — rejected because it would require passing the registry into the interpolation layer, coupling two concerns.

## Risks / Trade-offs

- **Registry drift from code**: If someone adds a variable to the record in `buildSystemPrompt()` without adding it to the registry, it won't appear in admin docs. → Mitigated by D4's validation.
- **Minimal abstraction**: The registry is metadata-only, not a framework. This is intentional — we want a lookup table, not a plugin system.
