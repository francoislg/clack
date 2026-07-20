# lazy-skill-loading — Delta

## MODIFIED Requirements

### Requirement: AVAILABLE SKILL PACKS Catalog in the Prompt

The user prompt builder SHALL render an `AVAILABLE SKILL PACKS` block when at least one lazy-tagged plugin exists in the registry, OR when `userSkills.enabled === true` and at least one enabled user skill exists. Each lazy-pack entry SHALL display the pack name, the operator-supplied description, and a directive instructing Claude to call `list_skill_pack_skills("<pack>")` to browse or `load_skill("<pack>", "<skill>")` to apply a specific skill. When user skills are enabled and present, a "USER SKILLS" subsection SHALL appear listing enabled user skills. The catalog SHALL be skipped entirely when no lazy packs are configured AND either user skills are disabled or no enabled skills exist.

The catalog (including its USER SKILLS subsection) SHALL additionally be omitted entirely for `scheduled`-trigger sessions fired by a **plugin-managed** cron job (`pluginManaged: true`) — ALL plugin-managed fires (casual-talk, trivia, idler, any future plugin), not a per-plugin list. Sessions for user-created schedules (created via `create_scheduled_message` / the cron tools — their job records carry no `pluginManaged` flag) and all interactive triggers SHALL render the catalog under the existing rules. The firing path SHALL pass the job's `pluginManaged` flag through the scheduled trigger context to the prompt-options supplier — no cron-job lookup at prompt-build time; when the flag is absent from the context the gate SHALL fail open (catalog rendered). The gate SHALL be applied at the prompt-options supplier (omitting the `skillPluginsRegistry` / `userSkills` options), not inside the prompt builder — the builder's absent-options behavior is unchanged. The AVAILABLE INTEGRATIONS catalog is NOT affected by this gate.

The gate removes catalog DISCOVERY only: the `load_skill` / `list_skill_pack_skills` tools remain available in gated sessions, so a skill referenced BY NAME in a plugin's instructions (e.g. the idler's fetch-instructions doc) remains loadable.

#### Scenario: Catalog rendered when a lazy pack exists

- **GIVEN** the registry has `marketingskills` tagged lazy with description "Marketing playbooks: CRO, copywriting, SEO"
- **WHEN** the prompt is built for a session
- **THEN** the prompt contains a section headed `AVAILABLE SKILL PACKS`
- **AND** the section lists `- marketingskills — Marketing playbooks: CRO, copywriting, SEO`
- **AND** the section ends with guidance instructing Claude to call `list_skill_pack_skills` or `load_skill` when a question matches a pack

#### Scenario: Catalog omitted when no lazy packs

- **GIVEN** the registry has no `lazyLoad: true` entries
- **WHEN** the prompt is built
- **THEN** no `AVAILABLE SKILL PACKS` section appears

#### Scenario: Catalog alphabetized

- **GIVEN** two lazy packs `zebrastuff` and `anvilstuff`
- **WHEN** the catalog renders
- **THEN** `anvilstuff` appears before `zebrastuff` in the bullet list

#### Scenario: Catalog omitted for plugin-managed scheduled fires

- **GIVEN** lazy packs and enabled user skills exist
- **AND** a session is fired by a `pluginManaged: true` cron job (e.g., casual-talk's `chatter`)
- **WHEN** the prompt is built
- **THEN** no `AVAILABLE SKILL PACKS` section and no `USER SKILLS:` subsection appear
- **AND** the `AVAILABLE INTEGRATIONS` catalog still renders

#### Scenario: User-created schedules keep the catalog

- **GIVEN** lazy packs exist
- **AND** a session is fired by a user-created cron job (its record carries no `pluginManaged` flag, the distinguishing criterion)
- **WHEN** the prompt is built
- **THEN** the `AVAILABLE SKILL PACKS` section renders under the existing rules

#### Scenario: Instruction-named skills stay loadable in gated sessions

- **GIVEN** a plugin-managed scheduled fire whose instructions reference a skill by pack and name
- **WHEN** Claude calls `load_skill` with that pack/name during the gated session
- **THEN** the skill loads normally — the gate omitted only the catalog listing, not the skill tools
