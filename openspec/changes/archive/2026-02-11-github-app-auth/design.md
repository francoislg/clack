## Context

Clack currently authenticates with GitHub in two ways:
1. **SSH keys** (`data/auth/ssh/id_rsa`) for cloning and pulling repositories via `simple-git`
2. **`gh` CLI** (authenticated separately) for PR operations (create, merge, close, review)

This works but has significant drawbacks for a self-hosted bot: SSH keys are tied to individuals, `gh` CLI requires separate authentication, and there's no dedicated bot identity on GitHub. Self-hosters must manage SSH keys, configure deploy keys per repo, and set up `gh auth` — all fragile steps.

GitHub Apps provide a better model: org-owned identity, fine-grained per-repo permissions selected at install time, and short-lived tokens generated programmatically from a private key.

## Goals / Non-Goals

**Goals:**
- Replace SSH + `gh` CLI with GitHub App authentication
- Provide a clean self-hoster experience: create a GitHub App, install it, drop in credentials
- Use Octokit for all GitHub API operations (PRs, repo metadata)
- Use HTTPS + installation tokens for all git operations (clone, pull, push)
- Remove SSH and `gh` CLI dependencies entirely

**Non-Goals:**
- GitHub Marketplace / public app distribution (self-hosted only)
- OAuth user-level flows (bot acts as itself, not on behalf of users)
- Auto-discovery of repos from installation (keep manual config for now — could be added later)
- Supporting non-GitHub git hosts (GitLab, Bitbucket) — this change is GitHub-specific

## Decisions

### 1. Authentication library: `@octokit/rest` + `@octokit/auth-app`

**Decision**: Use `@octokit/rest` for API calls and `@octokit/auth-app` for GitHub App authentication.

**Why not `octokit` (unified package)?**: The unified `octokit` package is heavier and includes plugins we don't need. The split packages are more lightweight and widely used.

**Why not keep `gh` CLI for PRs?**: `gh` requires its own auth setup (PAT or device flow), runs as a subprocess (fragile), and ties operations to a user identity. Octokit uses the app's installation token directly — same auth for everything.

### 2. Token management: Generate on demand, cache until expiry

**Decision**: Create a `GitHubAuth` module that generates installation tokens on demand and caches them. Tokens expire after 1 hour; regenerate when within 5 minutes of expiry.

**Why not generate per-request?**: Token generation requires a JWT + API call. Caching avoids unnecessary latency and API calls.

**Why not store tokens persistently?**: They expire in 1 hour. In-memory caching is sufficient.

### 3. Git operations: HTTPS with token in URL

**Decision**: Clone/pull/push using `https://x-access-token:{token}@github.com/org/repo.git` format via `simple-git`.

**Why not use SSH with deploy keys from the app?**: GitHub Apps don't use SSH. HTTPS + token is the standard approach and eliminates SSH key management entirely.

### 4. Config structure: `github` section in config + `github.json` in auth

**Decision**:
- `data/auth/github.json` stores `appId`, `installationId`, `privateKeyPath`
- Private key PEM file at `data/auth/github-app.pem`
- Remove `git.sshKeyPath` from config entirely
- Repository URLs remain in config but use HTTPS format (or just `owner/repo` shorthand)

**Why separate auth file?**: Follows existing pattern (`data/auth/slack.json` for Slack credentials). Keeps secrets out of `config.json`.

### 5. Repository URL format: Support `owner/repo` shorthand

**Decision**: Accept either full HTTPS URL (`https://github.com/org/repo.git`) or shorthand (`org/repo`). Internally, construct the authenticated URL using the installation token.

**Why shorthand?**: Since we're GitHub-only now, forcing full URLs is redundant. `org/repo` is cleaner and less error-prone.

## Risks / Trade-offs

- **GitHub-only**: Dropping SSH removes support for non-GitHub hosts (GitLab, Bitbucket, self-hosted Git). → Acceptable: current codebase is already GitHub-centric (PRs, `gh` CLI). Non-GitHub support could be re-added later as a separate auth provider.

- **Token expiry during long operations**: If a clone or push takes >1 hour, the token could expire mid-operation. → Mitigation: regenerate token before each git operation. Clone/push typically complete in minutes.

- **Private key security**: The `.pem` file is a long-lived secret. → Mitigation: stored in `data/auth/` which is gitignored. Same security posture as current SSH key. Docker mounts it read-only.

- **Self-hosters must create their own GitHub App**: Each deployment needs its own app registration. → Mitigation: this is a one-time setup (5 minutes). Document with clear step-by-step instructions. Could provide an app manifest JSON for one-click creation.

## Open Questions

- Should we provide a GitHub App manifest JSON for one-click app creation? (Nice-to-have, can be added later)
