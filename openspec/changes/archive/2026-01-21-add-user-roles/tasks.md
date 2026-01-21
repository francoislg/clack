# Tasks: Add User Roles with Home Tab Management

## Phase 1: Role Storage Foundation

- [x] **1.1** Create `data/state/` directory convention and update `.gitignore`
- [x] **1.2** Create `src/roles.ts` with `RolesConfig` interface
- [x] **1.3** Implement `loadRoles()` and `saveRoles()` functions with caching
- [x] **1.4** Implement role check functions: `isOwner()`, `isAdmin()`, `isDev()`, `getRole()`

## Phase 2: Role Management Functions

- [x] **2.1** Implement `setOwner()` for initial claim and transfer
- [x] **2.2** Implement `addAdmin()` and `removeAdmin()` with owner protection
- [x] **2.3** Implement `addDev()` and `removeDev()`
- [x] **2.4** Implement `isUserDisabled()` using Slack users.info API

## Phase 3: Home Tab Foundation

- [x] **3.1** Create `src/slack/homeTab.ts` for view building functions
- [x] **3.2** Implement `buildStatusSection()` showing repos and MCP servers
- [x] **3.3** Implement `buildHelpSection()` with bot usage instructions
- [x] **3.4** Implement `buildHomeView()` that assembles sections based on role

## Phase 4: Home Tab Event Handler

- [x] **4.1** Create `src/slack/handlers/homeTab.ts` with event handler
- [x] **4.2** Register `app_home_opened` event in `src/slack/app.ts`
- [x] **4.3** Implement view publishing on Home tab open

## Phase 5: Ownership Management UI

- [x] **5.1** Add "Claim Ownership" button to unclaimed state view
- [x] **5.2** Implement claim ownership action handler
- [x] **5.3** Add disabled owner detection and claim UI for admins
- [x] **5.4** Add "Transfer Ownership" button for owner view
- [x] **5.5** Implement transfer ownership modal and action handler

## Phase 6: Admin/Dev Management UI

- [x] **6.1** Implement `buildRoleManagementSection()` showing current roles
- [x] **6.2** Add "Add Admin" button and user selection modal
- [x] **6.3** Add admin removal buttons and action handler
- [x] **6.4** Add "Add Dev" button and user selection modal
- [x] **6.5** Add dev removal buttons and action handler

## Phase 7: Polish and Edge Cases

- [x] **7.1** Add role badge display at top of Home tab for assigned users
- [x] **7.2** Handle concurrent role modifications (file locking or last-write-wins)
- [x] **7.3** Add error handling and user feedback for all actions
- [x] **7.4** Ensure Home tab refresh after any role change

## Phase 8: Manifest Generation Updates

- [x] **8.1** Update manifest generation script to add `app_home_opened` event
- [x] **8.2** Add `users:read` scope to manifest (for user info and disabled check)
- [x] **8.3** Add `features.app_home` section with `home_tab_enabled: true`

## Phase 9: Validation

- [ ] **9.1** Test bootstrap flow (first visitor claims ownership)
- [ ] **9.2** Test ownership transfer flow
- [ ] **9.3** Test disabled owner claim flow
- [ ] **9.4** Test admin add/remove flows
- [ ] **9.5** Test dev add/remove flows
- [ ] **9.6** Test visibility (non-admins should not see role management)
- [ ] **9.7** Regenerate manifest and verify Home tab works in Slack
