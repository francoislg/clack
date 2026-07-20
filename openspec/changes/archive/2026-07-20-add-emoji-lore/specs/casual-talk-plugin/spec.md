# casual-talk-plugin Specification (delta)

## MODIFIED Requirements

### Requirement: Engagement Topic (`casual-talk:engagement`)

The plugin SHALL register an on-demand server named `engagement` (`sdk.registerMcpServer("engagement", { autoload: false, description })`) with NO tools bound, and SHALL bind the engagement instructions to it via the handle's `addTopicInstruction("user", ...)` — making `casual-talk:engagement` an attachable instructions-only catalog entry. Attaching it SHALL resolve with the `instructions_only` outcome and deliver the engagement content as the tool result.

The engagement content SHALL carry the static (non-config-derived) guidance previously in the cron prompt: channel triage mechanics (`fetch_channel_messages` overview semantics, freshness-by-last-reply, human-leaf/no-pile-on guard, join signals), the reacting guidance (reactable bar, `find_emoji`, existing-reaction preference, volume judgment), and the posting and termination mechanics (single `deliver_to` entry, mandatory `attention_level: "high"` and `default_delivery_mode: "invisible"`, destination picking, react-only vs post termination). The persona constraints themselves SHALL NOT be restated in the topic — they live in the pre-attached `casual-talk` persona topic (loaded on every fire); the engagement content carries only the reaction-scoped extension of the persona's never-reveal rule. Config-derived content (channels, fallback topics, die, skip variant) SHALL NOT appear in the topic — it stays in the reconcile-time prompt so config hot-reload keeps working. The split for skip behavior: the topic carries the GENERIC termination mechanics (react-only → `skip_response`; post → single `deliver_to`), while the skip-STRICTNESS decision rule (how reluctant to skip a hit, which depends on whether fallback topics are configured) lives ONLY in the prompt's config-dependent variant — the topic defers to it by reference.

The reacting guidance SHALL additionally direct Claude to:

- call `find_emoji` with `query: "*"` and `lore_only: true` ONCE per engagement run before choosing reactions, and pick emojis by semantically matching the message against the returned lore index (falling back to name search / standard emojis when nothing fits); and
- observe-and-distill: when a custom emoji seen during channel triage shows a clear usage pattern the lore store does not capture — or contradicts — call `describe_emoji` with `source: "observed"`, a paraphrased example (never a verbatim quote, never naming the reactor), and the source message permalink; when observed usage contradicts a `taught` entry, surface the discrepancy rather than overwrite.

Lore lookup and capture are BEST-EFFORT: a failing or empty `find_emoji`/`describe_emoji` call SHALL NOT abort the engagement run — Claude falls back to name search or a standard emoji and proceeds to its normal react-or-post termination.

Admins MAY override the content via the standard plugin-topic override path (`data/configuration/user/topics/casual-talk:engagement/`).

#### Scenario: Attach resolves instructions-only

- **GIVEN** the plugin is loaded
- **WHEN** Claude calls `attach_integration("casual-talk:engagement")`
- **THEN** the attach succeeds with the `instructions_only` outcome (no MCP server config, no tools)
- **AND** the tool result contains the engagement instructions (triage, reacting incl. lore index + observe-and-distill, posting/termination — persona constraints stay in the pre-attached persona topic)

#### Scenario: Topic content is static

- **WHEN** the engagement topic content is registered at plugin load
- **THEN** it contains no channel IDs, no fallback-topic lists, and no die value
- **AND** a config edit (channels/topics/rate) requires no soft restart for the topic to stay correct

#### Scenario: Termination contract lives in one place

- **WHEN** the engagement content and the cron prompt are both assembled
- **THEN** the full termination mechanics (react-only → `skip_response`; post → single `deliver_to`, no `skip_response`; `attention_level`/`default_delivery_mode` mandates) appear ONLY in the engagement topic
- **AND** the cron prompt references the loaded instructions rather than restating them

#### Scenario: Lore index read once per run

- **WHEN** the engagement topic content is registered
- **THEN** it instructs Claude to call `find_emoji` with `lore_only: true` once per run before reacting
- **AND** to choose reactions by semantic match against the lore index

#### Scenario: Lore steps are best-effort

- **WHEN** the engagement topic content is registered
- **THEN** it states that a failed or empty lore lookup/capture does not abort the run
- **AND** directs Claude to fall back to name search or a standard emoji

#### Scenario: Observe-and-distill writes observed lore

- **WHEN** the engagement topic content is registered
- **THEN** it instructs Claude to record uncaptured custom-emoji usage via `describe_emoji` with `source: "observed"`, a paraphrased example, and the message permalink
- **AND** to surface (not overwrite) contradictions with `taught` lore
