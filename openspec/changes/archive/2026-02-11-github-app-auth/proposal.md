## Why

Clack currently uses SSH keys for cloning repos and `gh` CLI for PR operations. This requires manual SSH key management and personal GitHub credentials, which is fragile (breaks if someone leaves), insecure (broad permissions), and hard to set up for self-hosters. A GitHub App provides org-owned authentication with fine-grained permissions, a dedicated bot identity, and short-lived tokens.

## What Changes

- **BREAKING** Remove SSH key authentication for git operations — replace with GitHub App installation tokens over HTTPS
- **BREAKING** Remove `gh` CLI dependency for PR operations — replace with Octokit (GitHub's Node.js SDK)
- **BREAKING** Remove `git.sshKeyPath` from configuration — replace with `github` config section for App ID, installation ID, and private key path
- Add `data/auth/github.json` as the auth config file for GitHub App credentials
- Add `data/auth/github-app.pem` as the expected location for the GitHub App private key
- Repository URLs in config change from SSH (`git@github.com:...`) to HTTPS (`https://github.com/...`) format, or are derived from the installation's repo list
- Update README with GitHub App setup instructions
- Update Docker setup script to handle GitHub App credentials instead of SSH keys
- Update all specs to remove SSH/gh CLI references

## Capabilities

### New Capabilities
- `github-app`: GitHub App authentication, token generation, and Octokit-based GitHub API operations (PR create/merge/close/review, repo access)

### Modified Capabilities
- `repository-management`: Replace SSH authentication with GitHub App token-based HTTPS cloning. Remove `sshKeyPath` config. Change repo URL format.
- `changes-workflow`: Replace `gh` CLI operations with Octokit API calls for PR lifecycle management.
- `docker-deployment`: Remove SSH key setup, `gh` CLI installation. Add GitHub App credential setup (private key, app ID, installation ID).

## Impact

- **Code**: `src/repositories.ts`, `src/worktrees.ts`, `src/changes/pr.ts`, `src/config.ts`, `src/index.ts`
- **New dependency**: `octokit` (or `@octokit/rest` + `@octokit/auth-app`)
- **Removed from Docker**: `openssh-client`, `gh` CLI
- **Config files**: `data/config.json` (new `github` section, remove `git.sshKeyPath`), `data/auth/github.json` (new), `data/config.example.json`
- **Auth files**: `data/auth/github-app.pem` replaces `data/auth/ssh/id_rsa`
- **Scripts**: `scripts/docker-setup.sh` updated for GitHub App flow
- **Docs**: README rewritten for GitHub App setup
- **Specs**: `repository-management`, `changes-workflow`, `docker-deployment` updated to remove SSH/gh references
