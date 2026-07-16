# trivia-test-fakes Specification

## Purpose

The contract every canonical test fake in the trivia plugin obeys — what a fake may and may not expose, which members are observable, which are structurally unmockable, and where test-only affordances live. The canonical fakes live in `src/plugins/trivia/testHelpers.fakeSdk.ts` (the `ClackSdk` fake, `primeTriviaConfig`, and the SlackDeps fakes) and `src/plugins/trivia/testHelpers.ts` (fixtures and the data layer fake — the real `createSdkDataLayer` under spies); the contract is guard-enforced by `src/plugins/trivia/testHelpers.guard.test.ts` and, for the renderer rule, by the compiler.

## Requirements

### Requirement: A fake never adds a member to the faked interface

A canonical fake SHALL be assignable to the interface it fakes, and SHALL NOT declare any member absent from that interface. Widening an existing member's type to expose the mock API is permitted; adding a member is not. Affordances the interface cannot express SHALL be returned in a sibling `testHelpers` object, never attached to the fake.

#### Scenario: The fake satisfies the production interface

- **WHEN** a test assigns the fake to a variable typed as the production interface
- **THEN** it typechecks with no cast

#### Scenario: A test-only affordance is requested

- **WHEN** a test needs to seed or inspect something the production interface cannot express
- **THEN** the affordance is reached through `testHelpers`, and the fake's own type is unchanged

### Requirement: Collaborator members are observable

Every `ClackSdk` member representing a collaborator — a registration, an outbound effect, or an inbound query — SHALL be a vitest mock carrying its current default behavior. The collaborator set is defined by complement: every function-valued `ClackSdk` member that is not a renderer (see the renderers requirement), so a member later added to the interface is a collaborator by default. Wrapping preserves behavior, so a consumer that does not assert on calls SHALL observe no change.

#### Scenario: A registration is asserted

- **WHEN** a test boots a plugin against the fake and inspects `registerMcpServer`
- **THEN** the call's arguments are recorded and assertable

#### Scenario: An existing consumer is not disturbed

- **WHEN** a test that never touches the mock API runs against the rewritten fake
- **THEN** it passes unchanged, because the default implementation is the prior behavior

#### Scenario: An inbound query is programmed

- **WHEN** a test programs a return value on an inbound query member
- **THEN** the code under test receives it, without needing a construction-time override

### Requirement: Renderers are structurally unmockable

`t`, `actionId`, and `viewCallbackId` have exactly one faithful rendering and SHALL NOT be mockable. They SHALL remain plain functions on the fake's type so that attempting to stub them is a compile error rather than a convention.

#### Scenario: A test attempts to stub a renderer

- **WHEN** a test writes `sdk.t.mockReturnValue("x")`
- **THEN** the code fails to typecheck

#### Scenario: A renderer is called normally

- **WHEN** production code under test calls `sdk.t(key, vars)`
- **THEN** it returns the faithful rendering, and asserting on the rendered value proves the string was routed through `t()`

### Requirement: Factory members are stable observation points

`registerMcpServer(name)` SHALL memoize by name and return the same handle for the same key — without this, an assertion targets a handle the code under test never touched and passes vacuously. `users.data(schema)` and `memory.data(schema)` SHALL return a fresh accessor per call, matching production, with every accessor sharing one backing store per fake — so state written by the code under test is readable through the production API regardless of which accessor instance wrote it.

#### Scenario: An on-demand server handle is reused

- **WHEN** `registerMcpServer` is called twice with the same name
- **THEN** the same handle is returned, and tools bound through it accumulate on one observable object

#### Scenario: Namespace accessors share one store

- **WHEN** the code under test merges data through its own `sdk.users.data(schema)` accessor and a test reads through a separately obtained accessor with the same schema
- **THEN** the test observes the merged state, because both accessors are views over the fake's single store

### Requirement: File I/O is backed by an in-memory store

`readFile` and `writeFile` SHALL be backed by an in-memory store by default, so `readFileOrSeed` exercises its real delegation and no consumer needs to supply a store. The store SHALL be reachable through `testHelpers`.

#### Scenario: Seeding a missing file

- **WHEN** `readFileOrSeed` is called for a path with no entry
- **THEN** the default content is returned and written to the store

#### Scenario: Reading a seeded file

- **WHEN** `readFileOrSeed` is called again for that path with different default content
- **THEN** the originally seeded content is returned and the store is not overwritten

### Requirement: The fake does not obstruct plugin boot

No member SHALL throw by default. A member with no meaningful default SHALL no-op and return a benign value, so the real plugin can be booted against the fake to assert its wiring.

#### Scenario: The real plugin is booted against the fake

- **WHEN** a test invokes the plugin's entry point with the fake
- **THEN** initialization completes without a thrown error, and every registration is observable

### Requirement: Collaborators are canonically faked, never hand-rolled

A collaborator in a trivia test SHALL be either a canonical fake from the plugin's test-helpers modules (`testHelpers.fakeSdk.ts`, `testHelpers.ts`) or a `vi.mock` at the boundary. A test file SHALL NOT define a local object literal standing in for a collaborator interface, and SHALL NOT record calls into a capture array where a mock's own call history serves. This SHALL be enforced by a guard test.

#### Scenario: A test hand-rolls a collaborator

- **WHEN** a test file defines a local factory returning an object literal typed as a collaborator interface
- **THEN** the guard test fails, naming the offender and the canonical alternative

#### Scenario: A test records calls into an array

- **WHEN** a test collects calls into a local array rather than asserting through a mock's call history
- **THEN** the guard test fails

### Requirement: A faked stateful collaborator runs the real implementation

A stateful collaborator is one that owns persisted state but carries no domain-decision logic; the trivia data layer is the instance governed here. Where such a collaborator's production implementation can be driven against faked I/O, the canonical fake SHALL drive that real implementation rather than reimplement its behavior. The trivia data layer fake SHALL construct `createSdkDataLayer` over the sdk fake's in-memory store. No second implementation of `TriviaDataLayer` SHALL exist in test code.

#### Scenario: Default behavior is production's

- **WHEN** a test writes a record through the fake and reads it back without stubbing
- **THEN** the value returned is produced by the real implementation, including its serialization and validation

#### Scenario: Production behavior absent from a reimplementation is present

- **WHEN** a test loads seasons state for a game with no stored file and seasons are enabled
- **THEN** the real bootstrap seeds a `season-YYYY-MM` entry and persists it, because no reimplementation is standing in

#### Scenario: Derived state runs real logic

- **WHEN** a test records the same user cheating twice
- **THEN** the returned tallies are `1` then `2`, computed by the real implementation rather than returned as a fixed default

### Requirement: Every method is observable and individually stubbable

Each method of a faked collaborator SHALL be a spy carrying the real implementation. A test SHALL be able to assert a method's calls without altering behavior, and SHALL be able to stub any single method while the remainder stay real.

#### Scenario: Asserting a call leaves behavior intact

- **WHEN** a test asserts that a write method was called with particular arguments
- **THEN** the assertion passes and the value is still readable through the fake

#### Scenario: Stubbing one method

- **WHEN** a test programs a return value on a read method
- **THEN** that method returns the programmed value and every other method retains real behavior

#### Scenario: Read-after-write within one call

- **WHEN** the code under test writes a record and then reads the collection again in the same invocation
- **THEN** it observes the write, with no call-order-dependent stubbing required

#### Scenario: A scoped accessor is a stable observation point

- **WHEN** a test asserts on a `forGame(name)` method after the code under test obtained its own accessor for the same name
- **THEN** the assertion targets the spy the code under test actually invoked, because the scoped accessor is memoized by name — without this the assertion passes vacuously against an untouched object

### Requirement: Spies observe the boundary, not the implementation's internals

Spies SHALL sit at the collaborator's public surface. Calls a method makes to its own siblings internally SHALL NOT be observable, so a test cannot assert a dependency's internal behavior through the unit under test.

#### Scenario: An internal cross-call is not counted

- **WHEN** the code under test calls a write method whose implementation internally reads the same collection
- **THEN** the read method's recorded call count reflects only calls made by the code under test

### Requirement: The fake takes the sdk and owns no state

The data layer fake SHALL accept the sdk fake as its argument, mirroring the production factory's signature. It SHALL own no state of its own, and therefore SHALL return only the faked interface, with no accompanying `testHelpers`. All test-only state SHALL be reachable through the sdk fake.

#### Scenario: One sdk threads through

- **WHEN** a test constructs the sdk fake and passes it to the data layer fake
- **THEN** state written through the data layer is visible via the sdk fake's store, because both share one instance

#### Scenario: No test-only surface is added

- **WHEN** a test assigns the data layer fake to a variable typed as the production interface
- **THEN** it typechecks, and the fake declares no member the interface lacks

### Requirement: Test scope is determined by substrate, not by helper

A unit test and an integration test SHALL use the same fakes and differ only in what they stub: a unit test stubs whatever its claim depends on and asserts the unit; an integration test stubs nothing and exercises the real flow. A test file whose name asserts integration scope SHALL NOT run against a reimplementation of a collaborator. Enforcement is structural where possible — once the reimplementation is removed there is nothing to violate the rule with, and the guard test rejects hand-rolled stand-ins; the stubbing discipline itself is a documented convention in CLAUDE.md's Test Conventions, verified in review.

#### Scenario: An integration test exercises real behavior

- **WHEN** an `*.integration.test.ts` file exercises a flow across tools
- **THEN** every collaborator beneath it is the real implementation over faked I/O

#### Scenario: A unit test isolates its claim

- **WHEN** a unit test's assertion depends on a collaborator's behavior
- **THEN** the test stubs that method and asserts only the unit's own handling of the result

### Requirement: Seeding does not go through the write path

A test SHALL seed a read's result by programming that read, not by invoking an unrelated write. Seeding through a write couples the test to a collaborator it is not testing.

#### Scenario: Seeding a filtered read

- **WHEN** a test needs a read to return a set of records
- **THEN** it programs the read directly, and the test passes regardless of whether the corresponding write method works
