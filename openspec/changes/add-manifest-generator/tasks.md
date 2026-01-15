# Tasks: Add Manifest Generator Script

## Implementation Tasks

1. [x] **Update config schema** — Add `slackApp` section with `name`, `description`, `backgroundColor` fields to `src/config.ts`

2. [x] **Update example config** — Add `slackApp` section to `data/config.example.json` with default values

3. [x] **Create manifest generator script** — Add `scripts/generate-manifest.ts` that:
   - Reads and validates config
   - Builds manifest JSON with branding from config + static defaults
   - Validates output against `@slack/web-api` manifest types
   - Writes to `slack-app-manifest.json`

4. [x] **Add npm script** — Add `"manifest": "npx tsx scripts/generate-manifest.ts"` to `package.json`

5. [x] **Update .gitignore** — Add `slack-app-manifest.json` to ignore list

6. [x] **Update README** — Add manifest generation step to setup instructions, document the `slackApp` config options

## Validation

7. [x] **Test script** — Run `npm run manifest` and verify output matches expected format

8. [x] **Test type validation** — Verify TypeScript compiles without errors
