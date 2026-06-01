## ADDED Requirements

### Requirement: find_previous_questions surfaces promptMedium and media

`find_previous_questions` SHALL include `promptMedium` and `media` on each returned row whenever the underlying record carries them, so that a posting run reading the staged pool (`posted: false`) has everything it needs to rebuild an image-medium question's `image` block. Specifically:

- `promptMedium?: "text" | "image"` — present iff the record has a `promptMedium`. Absent on legacy and text-medium rows.
- `media?: { kind: "image"; url: string; altText: string; subjectId: string; title: string; license?: string; attribution?: string }` — present iff the record has `media` (i.e. image-medium questions). Optional `license`/`attribution` are included only when set.

Without these fields, a prep→post split could not render staged image questions: the post run would not see that a staged question is image-medium, nor have the `media.url` to build the block.

`get_question_history` SHALL likewise include `promptMedium` and `media` (same shape, same presence rules) for consistency when inspecting a single question.

#### Scenario: Image-medium staged question exposes promptMedium and media

- **GIVEN** a staged (`posted: false`) question with `promptMedium: "image"` and a populated `media`
- **WHEN** `find_previous_questions` returns it
- **THEN** the row carries `promptMedium: "image"` and a `media` object with `kind`, `url`, `altText`, `subjectId`, and `title` (plus `license`/`attribution` when set)

#### Scenario: Text-medium question omits promptMedium and media

- **WHEN** `find_previous_questions` returns a text-medium (or legacy) question
- **THEN** the row carries neither `promptMedium` nor `media`
