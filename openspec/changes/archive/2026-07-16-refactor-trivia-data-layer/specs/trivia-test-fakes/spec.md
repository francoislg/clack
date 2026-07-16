## ADDED Requirements

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
