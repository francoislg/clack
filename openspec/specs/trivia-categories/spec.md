# Trivia Categories

## Purpose

Management of the trivia question category pool, including seeding, administration, and discovery tools.

## Requirements

### Requirement: Category pool seeding
The system SHALL seed `categories.json` with 50 hardcoded categories on first plugin load when the file is missing or empty.

#### Scenario: First load with no categories file
- **WHEN** the trivia plugin loads and `categories.json` does not exist
- **THEN** the system creates `categories.json` with 50 unique categories

#### Scenario: First load with empty categories file
- **WHEN** the trivia plugin loads and `categories.json` exists but is an empty array
- **THEN** the system populates it with 50 unique categories

#### Scenario: Subsequent load with existing categories
- **WHEN** the trivia plugin loads and `categories.json` contains categories
- **THEN** the system does not modify the file

### Requirement: Add categories tool
The system SHALL provide an `add_categories` MCP tool (dev+ role) that appends categories to the pool, deduplicating against existing entries.

#### Scenario: Add new categories
- **WHEN** `add_categories` is called with `["Quantum Physics", "Origami"]` and neither exists in the pool
- **THEN** both categories are appended to `categories.json`

#### Scenario: Add duplicate category
- **WHEN** `add_categories` is called with `["Science"]` and "Science" already exists in the pool
- **THEN** the duplicate is skipped and a result indicates it was already present

#### Scenario: Insufficient role
- **WHEN** a member-role user calls `add_categories`
- **THEN** the tool is not available (gated by SDK role system)

### Requirement: Remove categories tool
The system SHALL provide a `remove_categories` MCP tool (dev+ role) that removes categories from the pool by exact match.

#### Scenario: Remove existing category
- **WHEN** `remove_categories` is called with `["Sports"]` and "Sports" exists in the pool
- **THEN** "Sports" is removed from `categories.json`

#### Scenario: Remove non-existent category
- **WHEN** `remove_categories` is called with `["Nonexistent"]`
- **THEN** the tool succeeds with a result indicating the category was not found

### Requirement: Get ideas tool
The system SHALL provide a `get_ideas` MCP tool (member role) that returns 5 random categories from the pool, excluding categories used in the last 10 questions.

#### Scenario: Sufficient pool with recent exclusions
- **WHEN** `get_ideas` is called, the pool has 50 categories, and the last 10 questions used categories A through J
- **THEN** the tool returns 5 random categories, none of which are A through J

#### Scenario: Pool smaller than exclusion window
- **WHEN** `get_ideas` is called and fewer than 5 categories remain after exclusions
- **THEN** the tool returns all remaining eligible categories (fewer than 5)

### Requirement: save_question validates category
The `save_question` tool SHALL reject questions whose category is not in `categories.json`.

#### Scenario: Valid category
- **WHEN** `save_question` is called with `category: "Marine Biology"` and "Marine Biology" exists in the pool
- **THEN** the question is saved

#### Scenario: Invalid category
- **WHEN** `save_question` is called with `category: "Unknown Topic"` and it does not exist in the pool
- **THEN** the tool returns an error suggesting the use of `add_categories`
