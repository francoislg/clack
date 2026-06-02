# Design

## Context

The visual-trivia feature decoupled image sourcing from trivia: trivia contains zero image-source code, and any installed plugin exposing a conforming MCP tool becomes a source. The original contract made the **tool name** the discovery key ("name contains `image_search`"). That key is broken in practice (plugin names are hyphenated; the substring is underscored) and brittle in principle.

## Decision: discover by described capability, not by a magic substring (direction B)

The visual-research subflow's step (c) changes from:

> scan your available tools for any whose NAME contains `image_search`

to:

> survey your available tools and use any whose **description** identifies it as a trivia image source — i.e. it takes a subject query and returns an image inline plus a `{ source, subjectId, title, imageUrl, … }` metadata block. Pick the one whose description best fits the rolled category. If none of your tools is such an image source, abort the visual path and generate a text question for the same `answersFormat × questionType`.

The name stops being functionally load-bearing. Plugin authors are still encouraged to name their tools recognizably (e.g. `*-image-search`), but the binding contract is the **description** plus the return/error shape.

### Why not just fix the string (direction A)

Changing `image_search` → `image-search` (or `image[-_]search`) would unbreak it tonight but keeps the magic-substring coupling: the next plugin whose name doesn't fit the pattern silently fails the same way, and the contract keeps asserting a name shape the SDK doesn't guarantee. Rejected as papering over the smell.

### Why not a first-class SDK capability (direction C)

A deterministic alternative: add an SDK affordance (e.g. `sdk.registerImageSource(...)` or a tagged tool group) so trivia code could ask "are any image sources installed?" and inject their names into the prompt — making the gate code-level and exact. This is the most robust option but it is a real SDK surface change touching the plugin contract for every plugin, and it re-introduces a trivia-side notion of "image source" that the original design deliberately kept out of trivia. Out of scope for a bug fix; revisit if more capability-typed plugins appear.

## Trade-off: the fallback guarantee softens

| | Today (substring) | Direction B (description) |
|---|---|---|
| Discovery | literal name match (broken) | Claude reads descriptions |
| "No source installed → text" | substring count == 0 (a prompt instruction, also fuzzy) | Claude judges "I have no image source" |
| Brittleness | high — one rename re-breaks | low — no name coupling |
| Determinism of fallback | nominally crisp, actually prompt-driven | prompt-driven |

The "deterministic" guarantee we give up was never truly code-enforced — it was always a prompt instruction asking Claude to count substring matches. Direction B replaces a fuzzy-instruction-over-a-broken-key with a fuzzy-instruction-over-a-correct-signal (the description Claude already reads to pick a tool). Net: strictly less brittle, same class of enforcement.

The zero-config promise ("no image plugin installed → behaves exactly like text-only trivia") holds: with no conforming tool in the list, the subflow aborts to text. The default `promptMedium` weight for image is `0`, so the subflow doesn't even run unless an admin opts in.

## Out of scope

- Any SDK capability/registration change (direction C).
- Renaming the image-search plugins or their MCP servers.
- Rewriting the in-flight plugin proposals (`add-*-image-search-plugin`) — they're reconciled when next worked on; this change only flags them.
