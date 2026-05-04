## MODIFIED Requirements

### Requirement: Get ideas tool

The system SHALL provide a `get_ideas` MCP tool (member role) that returns category suggestions for the next trivia question alongside server-computed hints that bias the question's truth value and difficulty.

The tool SHALL return an object with the following shape:

```
{
  categories: { ideas: string[]; total: number; excluded: number };
  suggestedAnswer: boolean;
  suggestedDifficulty: "Easy" | "Medium" | "Hard";
}
```

`categories.ideas` SHALL contain up to 5 random categories drawn from the pool, excluding categories used in the last 10 questions. `categories.total` SHALL be the total number of categories in the pool. `categories.excluded` SHALL be the count of recently-used categories filtered out.

`suggestedAnswer` SHALL be sampled uniformly at random — each call has a 50% chance of `true` and a 50% chance of `false`.

`suggestedDifficulty` SHALL be sampled with the following weights: 30% `"Easy"`, 60% `"Medium"`, 10% `"Hard"`. The bucket names map onto the 1–10 self-rating scale used downstream as follows:

| Bucket | 1–10 range (inclusive) |
| ------ | ---------------------- |
| Easy   | 4–6                    |
| Medium | 7–8                    |
| Hard   | 9–10                   |

The mapping itself is not part of the tool's payload; consumers (the trivia question-flow prompt) are responsible for translating the bucket name into the target 1–10 range.

#### Scenario: Result shape with sufficient pool

- **WHEN** `get_ideas` is called, the pool has 50 categories, and the last 10 questions used categories A through J
- **THEN** the tool returns an object with `categories.ideas` containing 5 random categories, none of which are A through J
- **AND** `categories.total` equals 50
- **AND** `categories.excluded` equals 10
- **AND** `suggestedAnswer` is a boolean
- **AND** `suggestedDifficulty` is one of `"Easy"`, `"Medium"`, or `"Hard"`

#### Scenario: Pool smaller than exclusion window

- **WHEN** `get_ideas` is called and fewer than 5 categories remain after exclusions
- **THEN** `categories.ideas` contains all remaining eligible categories (fewer than 5)
- **AND** `suggestedAnswer` and `suggestedDifficulty` are still populated

#### Scenario: suggestedAnswer is sampled uniformly

- **WHEN** `get_ideas` is invoked many times
- **THEN** each invocation independently produces `suggestedAnswer = true` with probability 0.5 and `suggestedAnswer = false` with probability 0.5
- **AND** the value is not derived from the date, channel, or any deterministic input

#### Scenario: suggestedDifficulty is weighted 30/60/10

- **WHEN** `get_ideas` is invoked many times
- **THEN** each invocation independently produces `suggestedDifficulty = "Easy"` with probability 0.30, `"Medium"` with probability 0.60, and `"Hard"` with probability 0.10
