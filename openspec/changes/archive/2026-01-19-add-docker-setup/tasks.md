# Tasks: Add Docker Setup

## 1. Prepare Auth Directory Structure
- [x] 1.1 Create `data/auth/ssh/` directory with `.gitkeep`
- [x] 1.2 Update `.gitignore` to exclude `data/auth/` contents but keep structure

## 2. Separate Slack Credentials
- [x] 2.1 Create `data/auth/slack.example.json` template
- [x] 2.2 Modify `src/config.ts` to load Slack tokens from `data/auth/slack.json`
- [x] 2.3 Update `data/config.example.json` to remove Slack token fields
- [x] 2.4 Add validation for missing `data/auth/slack.json` with helpful error message

## 3. Create Docker Setup Script
- [x] 3.1 Create `scripts/docker-setup.sh` with interactive prompts
- [x] 3.2 Implement config.json check with offer to copy from example
- [x] 3.3 Implement SSH key generation/import logic
- [x] 3.4 Implement ANTHROPIC_API_KEY configuration
- [x] 3.5 Implement Slack credentials configuration (botToken, appToken, signingSecret)
- [x] 3.6 Add validation checks for all credentials
- [x] 3.7 Display GitHub SSH key approval instructions
- [x] 3.8 Verify Docker readiness at end of script

## 4. Create Dockerfile
- [x] 4.1 Create multi-stage `Dockerfile` with Node.js 18 Alpine base
- [x] 4.2 Install git and openssh-client for repository operations
- [x] 4.3 Configure Claude Code CLI installation in image
- [x] 4.4 Set up non-root user for security
- [x] 4.5 Configure proper volume mount points

## 5. Create Supporting Files
- [x] 5.1 Create `.dockerignore` to exclude node_modules, dist, etc.
- [x] 5.2 Add example `.env.example` in `data/auth/`

## 6. Update Configuration
- [x] 6.1 Update `data/config.example.json`: change `sshKeyPath` default to `data/auth/ssh/id_rsa`
- [x] 6.2 Update `data/config.example.json`: remove Slack token placeholders (moved to auth)

## 7. Documentation
- [x] 7.1 Docker setup instructions included in setup script output

## 8. GCE Deployment
- [x] 8.1 Create `scripts/gce-deploy.sh` for Google Compute Engine deployment
- [x] 8.2 Add `deploy:gce` npm script
- [x] 8.3 Document script dependencies in design.md
