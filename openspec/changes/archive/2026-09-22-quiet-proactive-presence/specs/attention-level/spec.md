## ADDED Requirements

### Requirement: Attention Level Is Described By Its Real Scope

Every surface that describes the attention dial to a human or to Claude SHALL describe it as governing **thread follow-up** — how Clack treats replies in a thread it is engaged with — and SHALL NOT describe it as governing how eagerly Clack responds in general.

This matches the dial's actual effect. A matched auto-respond rule without `preAnalysisContext` fires on its triggering message unconditionally; the rule's `attentionLevel` is not consulted there. A rule with `preAnalysisContext` screens its triggering message with the pre-analysis classifier, and the level only tunes that classifier's lean, with `"always"` capped to `"high"` (see "Channel-Engagement Gate Caps Always to High") — so `"always"` never lets the triggering message bypass the screen. Beyond that, the level is read when seeding the session, after which it governs thread replies. Describing `"always"` as the eager or most reliable rung is therefore misleading: it does not make Clack answer the trigger any more reliably than `"high"`, it removes the filter on subsequent thread chatter.

Where the levels are enumerated for selection, `"always"` SHALL be presented as the **unfiltered** option rather than the most attentive one.

#### Scenario: Home Tab option text describes follow-up behaviour

- **WHEN** an admin opens the auto-respond rule modal and reads the attention-level options
- **THEN** each option's text describes what Clack does with thread replies at that level
- **AND** `"always"` is presented as replying to every message with no filtering
- **AND** no option text implies that a higher level makes Clack answer the rule's triggering message more reliably

#### Scenario: Rule tool descriptions describe follow-up behaviour

- **WHEN** Claude reads the `attentionLevel` parameter description on `add_auto_respond_rule` or `update_auto_respond_rule`
- **THEN** the description states that the level seeds the session's thread follow-up behaviour
- **AND** states that the level decides nothing about the rule's triggering message beyond tuning the pre-analysis screen's lean when the rule has pre-analysis context (with `"always"` treated as `"high"` there)

#### Scenario: Scheduled-message tool descriptions describe follow-up behaviour

- **WHEN** Claude reads the `attentionLevel` parameter description on `create_scheduled_message` or `update_scheduled_message`
- **THEN** the description scopes the dial to following the thread the scheduled post creates when someone replies
- **AND** `"always"` is described as replying to every reply with no relevance check

#### Scenario: Surfaces agree

- **WHEN** the dial is described in the Home Tab, the auto-respond rule tools, and the scheduled-message tools
- **THEN** all describe the same scope, so an admin reading any of them reaches the same understanding
