## ADDED Requirements

### Requirement: System Role Tier

The system SHALL recognize a `"system"` role as a fifth `UserRole` value, sitting at the top of the role hierarchy and reserved for internal use by the bot's own automation (e.g. plugin-managed cron jobs).

The system role SHALL be internal-only: it MUST NOT be assignable by any user-facing API, MUST NOT be returned by `getRole(userId)` regardless of any value stored in `roles.json`, and MUST NOT appear in any role-selection UI (Home Tab pickers, role-management dropdowns, etc.).

Hierarchy comparisons via `meetsMinimumRole(role, minRole)` SHALL treat `"system"` as greater than every other tier — i.e. `meetsMinimumRole("system", "owner") === true`, `meetsMinimumRole("system", "admin") === true`, and so on. The set of literal equality checks that pin operations to a human owner (ownership transfer, claim-from-disabled, role assignment, change-of-ownership flows) SHALL continue to compare against the string `"owner"` exactly, so that a `"system"` actor is correctly excluded from those operations.

#### Scenario: System role sits above owner in hierarchy

- **WHEN** `meetsMinimumRole("system", "owner")` is called
- **THEN** it returns `true`
- **AND** `meetsMinimumRole("system", "admin")` returns `true`
- **AND** `meetsMinimumRole("system", "dev")` returns `true`
- **AND** `meetsMinimumRole("system", "member")` returns `true`

#### Scenario: System role is not literally equal to owner

- **GIVEN** a context that holds a `UserRole` value of `"system"`
- **WHEN** the code performs `role === "owner"`
- **THEN** the comparison evaluates to `false`
- **AND** any ownership-mutating operation guarded by that literal check (transferOwnership, claimOwnershipFromDisabled, setRole for the owner) refuses the system actor

#### Scenario: getRole never returns system from disk

- **GIVEN** `data/state/roles.json` exists (or doesn't) with any contents
- **WHEN** `getRole(userId)` is called for any `userId`
- **THEN** the returned role is one of `"owner" | "admin" | "dev" | "member"`
- **AND** `"system"` is never returned, regardless of what `roles.json` contains

#### Scenario: setRole rejects system

- **WHEN** `setRole(userId, "system")` is attempted (e.g. via a misconfigured caller bypassing the `AssignableRole` type)
- **THEN** the call returns `{ success: false, error: "..." }` indicating that `"system"` is not an assignable role
- **AND** `roles.json` is not mutated

#### Scenario: Home Tab role pickers omit system

- **WHEN** the Home Tab renders any role-selection control (admin/dev/member assignment, role-change dropdown)
- **THEN** the available options include only `"admin"`, `"dev"`, and `"member"`
- **AND** `"system"` does not appear as a selectable option

#### Scenario: AssignableRole type excludes system

- **WHEN** the `AssignableRole` TypeScript type is consumed (in role-assignment tool inputs, Home Tab actions, etc.)
- **THEN** its union members are exactly `"admin" | "dev" | "member"`
- **AND** the compiler rejects any attempt to pass `"system"` (or `"owner"`) as an `AssignableRole`
