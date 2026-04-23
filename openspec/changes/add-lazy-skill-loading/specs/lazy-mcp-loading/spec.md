## MODIFIED Requirements

### Requirement: Startup Baseline Token Smoke Test

The system SHALL, at bot startup, launch a small asynchronous Claude query per role tier (`user`, `dev`, `admin`) with the same MCP set, skill-plugin set, cascade, and user-prompt catalog blocks that tier would normally receive, and log each query's initial `cache_creation_input_tokens`. This provides continuous, in-production visibility into the baseline prompt size — a regression tripwire for changes that silently re-inflate the baseline (e.g., a new always-on MCP, a new eager skill plugin, a large topical file accidentally moved back to the baseline cascade).

#### Scenario: Startup logs baseline token count per role

- **WHEN** the bot starts up (after config is loaded and before Slack event handlers are registered)
- **THEN** an asynchronous task kicks off a minimal query (a single-turn prompt like `"ping"` that returns immediately) for each role tier: `user`, `dev`, `admin`
- **AND** each query uses the same always-on MCP subset, cascade resolver output, integrations catalog, skill-packs catalog, and filtered skill-plugin set (`discoverEagerSkillPlugins`) that a real query for that role would receive
- **AND** the SkillsManager and McpServerManager are wired into the tool context so `list_skill_pack_skills`, `load_skill`, and `attach_integration` register into baseline exactly as they would for a real session
- **AND** each query is capped at `maxTurns: 1` and a short wall-clock timeout (e.g., 60s) so a slow MCP spawn never blocks the main event loop
- **AND** the `cache_creation_input_tokens` from the first assistant turn is logged at `info` level along with the role, in a single structured line (e.g. `baseline.tokens role=user tokens=18452`)
- **AND** the smoke test runs fire-and-forget — failures log a warning but never block startup

#### Scenario: Lazy-tagged skill pack excluded from baseline

- **GIVEN** `config.skillPlugins.marketingskills.lazyLoad === true`
- **WHEN** the startup smoke test runs for any role
- **THEN** `marketingskills` is NOT passed to the SDK as a `--plugin-dir` entry for the smoke query
- **AND** its 32 skill frontmatter entries are NOT part of the measured baseline
- **AND** the `AVAILABLE SKILL PACKS` catalog block contributes a single-line entry (`- marketingskills — …`) in place of the 32 frontmatter entries

#### Scenario: Eager skill pack still contributes to baseline

- **GIVEN** `config.skillPlugins.devtools.lazyLoad === false` (or no registry entry — eager by default)
- **WHEN** the startup smoke test runs
- **THEN** `devtools` is passed as a `--plugin-dir` entry and its full skill frontmatter enters the measured baseline, matching a real session
