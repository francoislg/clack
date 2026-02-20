## 1. Remove edit buttons from Configuration section

- [x] 1.1 In `src/slack/homeTab.ts` — `buildConfigurationSection()`: remove the `accessory` button from each file section block, keeping the file listing with status text
- [x] 1.2 Add a context block after the file list with a hint like "Chat with Clack to view or update configuration files"

## 2. Remove edit file modal and handlers

- [x] 2.1 In `src/slack/homeTab.ts` — delete `buildEditFileModal()`, `truncateTitle()`, `MAX_MODAL_TEXT_LENGTH`, and `MAX_MODAL_TITLE_LENGTH` (all dead code after button removal)
- [x] 2.2 In `src/slack/handlers/homeTab.ts` — delete the `edit_config_file` action handler (lines 396-423)
- [x] 2.3 In `src/slack/handlers/homeTab.ts` — delete the `edit_config_file_modal` view submission handler (lines 462-506)
- [x] 2.4 In `src/slack/handlers/homeTab.ts` — remove the `buildEditFileModal` import and the now-unused `readInstructionFile` / `writeInstructionFile` imports
- [x] 2.5 (bonus) Remove now-unused `userCanEditConfig` and `getRole` imports from handlers/homeTab.ts

## 3. Verify

- [x] 3.1 Ensure the project compiles without errors (`npm run build`)
- [x] 3.2 Run existing tests to confirm no regressions
