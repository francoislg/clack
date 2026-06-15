---
name: rebase
description: "Rebase the current branch on the latest master (or a specified target branch). Use when the user asks to rebase, update the branch onto main/master, or resolve being behind the base branch."
---

Rebase the current working branch onto the latest version of a target branch.

If the user named a target branch, use it. Otherwise, use the repository's default branch.

## Steps

### 1. Detect the target branch

If the user specified a branch, use that. Otherwise detect the repo's default branch:

```bash
git remote show origin | grep 'HEAD branch' | sed 's/.*: //'
```

### 2. Ensure we're not on the target branch

Run `git branch --show-current`. If the current branch IS the target branch, tell the user ("You're already on `<branch>`, nothing to rebase.") and stop.

### 3. Fetch the latest from origin

```bash
git fetch origin <target-branch>
```

### 4. Check rebase necessity

Count how many commits the current branch is behind:

```bash
git rev-list --count HEAD..origin/<target-branch>
```

If the count is 0, report that the branch is already up to date with `<target-branch>` and stop.

### 5. Rebase

Report how many commits behind, then rebase:

```bash
git rebase origin/<target-branch>
```

### 6. Handle conflicts

If the rebase fails due to conflicts:

- Show the conflicted files: `git diff --name-only --diff-filter=U`
- Read each conflicted file and attempt to resolve the conflict markers. Most conflicts are straightforward (e.g. both sides added imports, or adjacent lines changed independently). Resolve these by keeping both changes in the right order.
- After resolving, stage the files (`git add <file>`) and continue: `git rebase --continue`
- If a conflict is genuinely ambiguous (contradictory changes to the same logic, unclear intent), stop and ask the user. Show the conflict markers and explain what both sides changed.
- If resolution fails or the user needs to bail: remind them of `git rebase --abort`.

### 7. Report

Summarize:

- Target branch
- Number of commits replayed
- Clean rebase or conflicts encountered
