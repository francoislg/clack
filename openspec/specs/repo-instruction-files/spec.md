# repo-instruction-files Specification

## Purpose
Per-repository instruction files for customizing the changes workflow execution and worktree initialization phases.

## Requirements
### Requirement: Repository Changes Instructions

The system SHALL support per-repository instruction files for the changes workflow execution phase.

#### Scenario: Changes instructions file exists
- **GIVEN** a repository named `{repo-name}` is configured
- **AND** `{repo-name}/changes_instructions.md` resolves via the two-tier chain
- **WHEN** a change is executed for that repository
- **THEN** the contents of the file are appended to the execution system prompt under a "Repository-Specific Instructions" section

#### Scenario: Changes instructions file does not exist
- **GIVEN** a repository named `{repo-name}` is configured
- **AND** `{repo-name}/changes_instructions.md` does not exist in either tier
- **WHEN** a change is executed for that repository
- **THEN** the execution system prompt is unchanged (no repo-specific section)

#### Scenario: Changes instructions used in PR body generation
- **GIVEN** `{repo-name}/changes_instructions.md` resolves for a repository
- **WHEN** a PR body is being generated for that repository
- **THEN** the changes instructions are included in the Claude prompt for PR generation

#### Scenario: Changes instructions used in follow-up commands
- **GIVEN** `{repo-name}/changes_instructions.md` resolves for a repository
- **WHEN** a follow-up command (update, review) is executed for that repository
- **THEN** the changes instructions are included in the execution system prompt

### Requirement: Worktree Setup Instructions

The system SHALL support per-repository instruction files for worktree initialization.

#### Scenario: Setup instructions file exists for fresh worktree
- **GIVEN** a repository named `{repo-name}` is configured
- **AND** `{repo-name}/worktree_setup_instructions.md` resolves via the two-tier chain
- **WHEN** a fresh worktree is created for that repository (not resumed)
- **THEN** the system runs a Claude invocation with the setup instructions as the prompt
- **AND** the invocation has access to `Bash`, `Write`, `Edit`, `Read` tools
- **AND** the working directory is the new worktree path
- **AND** the invocation has a 2-minute timeout

#### Scenario: Setup instructions file does not exist
- **GIVEN** a repository named `{repo-name}` is configured
- **AND** `{repo-name}/worktree_setup_instructions.md` does not exist in either tier
- **WHEN** a fresh worktree is created
- **THEN** no setup step is performed (same as current behavior)

#### Scenario: Setup skipped on resume
- **GIVEN** a worktree already exists for the branch (resumed session)
- **WHEN** the change workflow starts
- **THEN** the worktree setup instructions are NOT executed
- **AND** the workflow proceeds directly to execution

#### Scenario: Setup failure
- **GIVEN** the worktree setup Claude invocation fails or times out
- **WHEN** the setup step completes
- **THEN** the system logs a warning
- **AND** the workflow continues with execution (setup failure is non-fatal)
