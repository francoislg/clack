## 1. Configuration File Module

- [x] 1.1 Create `src/configurationFiles.ts` — module with: `listInstructionFiles()` returns all convention filenames with override status (customized vs default); `readInstructionFile(filename)` reads from `configuration/` or falls back to `default_configuration/`; `writeInstructionFile(filename, content)` writes to `configuration/` with path safety (resolve + startsWith)
- [x] 1.2 Ensure `data/configuration/` directory is created if it doesn't exist on write

## 2. Home Tab UI

- [x] 2.1 Add `buildConfigurationSection()` to `src/slack/homeTab.ts` — lists all instruction files with status label ("Customized" or "Default") and an action button ("Edit" for overrides, "Customize" for defaults)
- [x] 2.2 Wire `buildConfigurationSection()` into `buildHomeView()` — show for admins only, after Role Management and before Active Workers

## 3. Edit Modal & Handler

- [x] 3.1 Add `buildEditFileModal(filename, content)` to `src/slack/homeTab.ts` — modal with filename as title, multiline `plain_text_input` pre-filled with content, and a submit button
- [x] 3.2 Handle the 3000 char limit: if file exceeds 3000 chars, show an informational modal instead explaining the file is too large to edit via Slack
- [x] 3.3 Register `edit_config_file` action handler in `src/slack/handlers/homeTab.ts` — on button click, read the file via `readInstructionFile()`, open the edit modal
- [x] 3.4 Register `edit_config_file_modal` view submission handler — on submit, verify admin role, write content via `writeInstructionFile()`, refresh the Home Tab

## 4. Validation

- [x] 4.1 Verify the app builds successfully
- [x] 4.2 Verify editing a default-only file creates the override in `data/configuration/`
