# Tasks: Add Manifest Generator Script

## Implementation Tasks

1. [ ] **Update config schema** — Add `slackApp` section with `name`, `description`, `backgroundColor` fields to `src/config.ts`

2. [ ] **Update example config** — Add `slackApp` section to `data/config.example.json` with default values

3. [ ] **Create manifest generator script** — Add `scripts/generate-manifest.ts` that:
   - Reads and validates config
   - Builds manifest JSON with branding from config + static defaults
   - Validates output against `@slack/web-api` manifest types
   - Writes to `slack-app-manifest.json`

4. [ ] **Add npm script** — Add `"manifest": "npx tsx scripts/generate-manifest.ts"` to `package.json`

5. [ ] **Update .gitignore** — Add `slack-app-manifest.json` to ignore list

6. [ ] **Update README** — Add manifest generation step to setup instructions, document the `slackApp` config options

## Validation

7. [ ] **Test script** — Run `npm run manifest` and verify output matches expected format

8. [ ] **Test type validation** — Verify script fails with invalid config values
