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

`suggestedAnswer` SHALL be sampled uniformly at random — each call has a 50% chance of `true` and a 50% chance of `false`. The value SHALL NOT be derived from the date, channel, or any deterministic input.

`suggestedDifficulty` SHALL be sampled with the following weights: 30% `"Easy"`, 60% `"Medium"`, 10% `"Hard"`. The bucket names map onto the 1–10 self-rating scale used downstream as follows:

| Bucket | 1–10 range (inclusive) | Width (values) |
| ------ | ---------------------- | -------------- |
| Easy   | 4–6                    | 3              |
| Medium | 7–8                    | 2              |
| Hard   | 9–10                   | 2              |

The buckets are intentionally asymmetric. Difficulty self-rating is fuzzy; the wider Easy band absorbs benign questions while the narrower Hard band keeps "Hard" meaningfully obscure. The 30/60/10 weights compensate for the size asymmetry — Easy is wider but rarer than Medium, and Hard is narrower and rarest.

Sampling is implemented as threshold comparisons against a single `Math.random()` draw `r ∈ [0, 1)`: `r < 0.30 → Easy`, `r < 0.90 → Medium`, otherwise `Hard`. Boundary values fall as follows: `r = 0.30 → Medium`, `r = 0.90 → Hard`.

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

#### Scenario: Pool exhausted by recent exclusions

- **WHEN** `get_ideas` is called and zero categories remain after exclusions (every category in the pool was used in the last 10 questions)
- **THEN** `categories.ideas` is an empty array
- **AND** `categories.total` reflects the full pool size
- **AND** `categories.excluded` reflects the count of recently-used categories
- **AND** `suggestedAnswer` and `suggestedDifficulty` are still populated

#### Scenario: suggestedAnswer is sampled uniformly

- **WHEN** `get_ideas` is invoked 1000 times under independent draws
- **THEN** the count of invocations producing `suggestedAnswer = true` falls within the band [436, 564] (expected 500, ±4σ for a Bernoulli(0.5) at N=1000)
- **AND** the count of invocations producing `suggestedAnswer = false` falls within the same band

#### Scenario: suggestedDifficulty is weighted 30/60/10

- **WHEN** `get_ideas` is invoked 1000 times under independent draws
- **THEN** the count of invocations producing `"Easy"` falls within [242, 358] (expected 300, ±4σ for a Bernoulli(0.3) at N=1000)
- **AND** the count of invocations producing `"Medium"` falls within [538, 662] (expected 600, ±4σ for a Bernoulli(0.6) at N=1000)
- **AND** the count of invocations producing `"Hard"` falls within [62, 138] (expected 100, ±4σ for a Bernoulli(0.1) at N=1000)

#### Scenario: suggestedDifficulty boundary values

- **WHEN** the underlying `Math.random()` returns exactly `0.30`
- **THEN** `suggestedDifficulty` is `"Medium"`

- **WHEN** the underlying `Math.random()` returns exactly `0.90`
- **THEN** `suggestedDifficulty` is `"Hard"`

- **WHEN** the underlying `Math.random()` returns a value strictly less than `0.30`
- **THEN** `suggestedDifficulty` is `"Easy"`
