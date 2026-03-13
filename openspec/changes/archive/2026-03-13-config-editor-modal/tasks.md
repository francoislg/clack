## 1. Infrastructure

- [x] 1.1 Add `deleteInstructionFile(filepath)` to `src/configurationFiles.ts` — deletes a file from `data/configuration/`, validates path safety, throws if file doesn't exist
- [x] 1.2 Add helper to compute effective content length for a file (custom content if it exists, else default content) — used to determine if a file is editable in the modal
- [x] 1.3 Write tests for `deleteInstructionFile` and content length helper

## 2. Home Tab Configuration Section

- [x] 2.1 Rewrite `buildConfigurationSection()` in `src/slack/homeTab.ts` — show one line per directory (role + repo) with file count and a [View] button. Action ID format: `view_config_dir` with directory name as button value
- [x] 2.2 Update `buildConfigurationSection` tests for the new interactive layout

## 3. File Picker Modal

- [x] 3.1 Create `buildConfigFilePickerModal(dir, files, isRepoDir)` in `src/slack/homeTab.ts` — lists files as buttons with source status labels, [+ Create New File] button (for role dirs only), "Too large — use chat" label for oversized files
- [x] 3.2 Register `view_config_dir` action handler in `src/slack/handlers/homeTab.ts` — on click, read the directory listing, build the picker modal, call `views.open`
- [x] 3.3 Write tests for `buildConfigFilePickerModal` (default files, customized files, custom-only files, oversized files, repo dirs without create button)

## 4. File Editor Modal

- [x] 4.1 Create `buildConfigEditorModal(dir, filename, content, fileState)` in `src/slack/homeTab.ts` — textarea pre-filled with content, submit label based on state ("Create Override" / "Save"), delete/reset button when applicable, file state passed via `private_metadata`
- [x] 4.2 Handle modal title truncation — `{dir}/{filename}` truncated to 23 chars + `…` if over 24 chars
- [x] 4.3 Register `edit_config_file` action handler in `src/slack/handlers/homeTab.ts` — on click, read file content, determine state, build editor modal, call `views.push`
- [x] 4.4 Register `config_editor_modal` view submission handler — parse `private_metadata`, verify admin permissions, write file via `writeInstructionFile()`, refresh Home Tab
- [x] 4.5 Write tests for `buildConfigEditorModal` (default file, override file, custom-only file, no delete button for default-only)
- [x] 4.6 Write tests for editor submission handler (save override, create override, permission check)

## 5. Create New File Modal

- [x] 5.1 Create `buildConfigCreateFileModal(dir)` in `src/slack/homeTab.ts` — filename input (with `.md` hint), content textarea, submit label "Create", dir stored in `private_metadata`
- [x] 5.2 Register `create_config_file` action handler in `src/slack/handlers/homeTab.ts` — on click, build create modal, call `views.push`
- [x] 5.3 Register `config_create_modal` view submission handler — append `.md` if needed, check for duplicate filename, verify admin permissions, write file, refresh Home Tab
- [x] 5.4 Write tests for `buildConfigCreateFileModal` and create submission handler

## 6. Delete / Reset

- [x] 6.1 Register `delete_config_file` action handler in `src/slack/handlers/homeTab.ts` — delete file via `deleteInstructionFile()`, then either update modal in-place (if default exists: show default content, change submit to "Create Override") or close stacked modal (if custom-only)
- [x] 6.2 Write tests for delete handler (reset to default, delete custom-only, permission check)

## 7. Integration

- [x] 7.1 Run full test suite to confirm no regressions
- [ ] 7.2 Verify the complete flow manually: Home Tab → [View] → file picker → [Edit] → editor → Save, and [+ Create New] → create → submit, and delete/reset
