## 1. Dependencies & Auth Foundation

- [x] 1.1 Add `@octokit/rest` and `@octokit/auth-app` to package.json
- [x] 1.2 Create `data/auth/github.example.json` with placeholder values and comments
- [x] 1.3 Create `src/github.ts` — GitHub App auth module: load credentials from `data/auth/github.json`, generate installation tokens with caching, provide authenticated Octokit client, construct authenticated HTTPS git URLs
- [x] 1.4 Add `GitHubAuthConfig` interface to `src/config.ts` and load/validate `data/auth/github.json` on startup

## 2. Repository Management Migration

- [x] 2.1 Update `src/repositories.ts` — replace SSH-based `getGitInstance` with HTTPS token-based cloning/pulling using `src/github.ts` for URL construction
- [x] 2.2 Update `src/worktrees.ts` — replace SSH-based `getGitInstance` with token-based HTTPS auth for worktree creation, fetch, and push operations
- [x] 2.3 Remove `git.sshKeyPath` from `GitConfig` interface in `src/config.ts` and all references to it
- [x] 2.4 Update `data/config.example.json` — remove `git.sshKeyPath`, change repository URLs from SSH to `owner/repo` shorthand format

## 3. PR Operations Migration

- [x] 3.1 Rewrite `src/changes/pr.ts` — replace all `gh` CLI / `execSync` calls with Octokit API calls: `getPRStatus`, `createPR`, `mergePR`, `closePR`, `reviewPR`
- [x] 3.2 Update `createPR` to use `simple-git` for push (with token-authenticated remote URL) and Octokit for PR creation
- [x] 3.3 Update `mergePR` to use Octokit merge endpoint with configured merge strategy, then delete branch via API
- [x] 3.4 Update `closePR` to use Octokit close endpoint, optionally delete branch via API
- [x] 3.5 Update `reviewPR` to fetch comments/reviews via Octokit instead of `gh pr view`

## 4. Startup & Validation

- [x] 4.1 Update `src/index.ts` — add GitHub App credential validation on startup (generate test token, log app name/installation info)
- [x] 4.2 Remove MCP connection test for `gh` CLI if any exists in startup (none existed)

## 5. Docker & Deployment

- [x] 5.1 Update `Dockerfile` — remove `openssh-client` and `gh` CLI installation
- [x] 5.2 Update `scripts/docker-setup.sh` — replace SSH key setup flow with GitHub App credential setup (prompt for App ID, Installation ID, PEM file)
- [x] 5.3 Remove `data/auth/ssh/` directory and `.gitkeep`

## 6. Specs & Documentation

- [x] 6.1 Update `README.md` — replace SSH Key Setup section with GitHub App Setup section, update config reference table, update prerequisites, update architecture diagram
- [x] 6.2 Update `data/config.example.json` to reflect final config shape (done in task 2.4)

## 7. Cleanup

- [x] 7.1 Remove all remaining references to SSH keys, `sshKeyPath`, and `gh` CLI across the codebase
- [x] 7.2 Verify the app builds and starts successfully with GitHub App credentials
