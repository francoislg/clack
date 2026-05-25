## ADDED Requirements

### Requirement: parallel visual category pool

The system SHALL maintain `data/plugins/trivia/visualCategories.json` as a flat `string[]` of visual-eligible categories, sibling to the existing `data/plugins/trivia/categories.json`. The visual pool SHALL be independent — categories MAY appear in both pools, in only one, or in neither. The visual pool SHALL be global (shared across all games), matching the scope of the general categories pool.

When the file is missing on first read, the system SHALL seed it from `SEED_VISUAL_CATEGORIES` and write the seed to disk. The seed list SHALL cover the breadth of the multi-source registry: people, landmarks, animals, plants, birds, insects, paintings, sculpture, art history, flags, world capitals, movies, TV series, anime, anime characters, manga characters, album covers, music albums, book covers, video games, space, astronomy, planets, currency, vehicles, cuisine. Categories that hit copyright walls on every free source (brand logos, comics covers/panels) SHALL NOT be in the seed — they're listed as non-goals in this change's design (a future change with a licensed source can add them).

#### Scenario: First read seeds the visual pool

- **GIVEN** `visualCategories.json` does not exist on disk
- **WHEN** the visual pool is read for the first time
- **THEN** the seed list is returned AND written to disk for subsequent reads

#### Scenario: Visual pool is global, not per-game

- **WHEN** any game reads or writes the visual category pool
- **THEN** all games observe the same list

### Requirement: add_categories and remove_categories accept a pool argument

Both `add_categories` and `remove_categories` tools SHALL accept an optional `pool: "default" | "visual" | "both"` argument (default `"default"`). The argument routes the operation:

- `"default"` → applies to `categories.json` only (today's behavior).
- `"visual"` → applies to `visualCategories.json` only.
- `"both"` → applies to both pools.

The tool description SHALL explain the argument and the practical use case (categories that are usable both as text-prompted and as image-prompted topics, e.g., "Animal Kingdom", belong in `"both"`).

#### Scenario: Add to visual pool only

- **WHEN** `add_categories({ categories: ["Album Covers"], pool: "visual" })` is called
- **THEN** "Album Covers" is added to `visualCategories.json` only; `categories.json` is unchanged

#### Scenario: Add to both pools

- **WHEN** `add_categories({ categories: ["Famous People"], pool: "both" })` is called
- **THEN** "Famous People" is added to both `categories.json` and `visualCategories.json`

#### Scenario: Default pool is "default"

- **WHEN** `add_categories({ categories: ["Cryptography"] })` is called without a pool argument
- **THEN** "Cryptography" is added to `categories.json` only (backward compatible)

## MODIFIED Requirements

### Requirement: get_ideas returns category ideas drawn from the active pool

The `get_ideas` tool SHALL return `categories.ideas: string[]` of up to 5 recently-unused categories. The active source pool SHALL be selected as follows:

1. When `suggestedPromptMedium === "image"` AND the visual pool is non-empty: draw from the visual pool, intersected with the season's `categories` when seasons are enabled (else the full visual pool).
2. When `suggestedPromptMedium === "text"` (or absent): draw from the general pool, applying the existing season/slot categories cascade.

The recent-category exclusion window SHALL apply to whichever pool is active. When the active pool is the visual pool and it is empty, the system SHALL fall back per the visual-questions capability's empty-pool rule (re-roll to `text`).

#### Scenario: Image medium draws from visual pool

- **GIVEN** the visual pool is `["Famous People", "Landmarks", "Animals"]`
- **AND** the general pool is the standard seeded list
- **WHEN** `get_ideas` rolls `suggestedPromptMedium: "image"`
- **THEN** every entry in `categories.ideas` is one of the visual-pool categories

#### Scenario: Text medium draws from general pool (unchanged behavior)

- **GIVEN** the general pool and visual pool both have many entries
- **WHEN** `get_ideas` rolls `suggestedPromptMedium: "text"`
- **THEN** `categories.ideas` is drawn from the general pool (the visual pool is not consulted)

#### Scenario: Visual pool intersected with season categories yields no overlap

- **GIVEN** the visual pool is `["Famous People", "Landmarks"]`
- **AND** the active season's `categories` is `["Chemistry", "Modern History"]` (no overlap)
- **WHEN** `get_ideas` rolls `suggestedPromptMedium: "image"`
- **THEN** the intersection is empty and the system applies the empty-visual-pool fallback: re-rolls `suggestedPromptMedium` to `"text"` and draws from the general pool filtered by the season's categories
