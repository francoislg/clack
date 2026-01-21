# Design: User Roles with Home Tab Management

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Slack Home Tab                            │
├─────────────────────────────────────────────────────────────┤
│  [Your Role: Admin]  (shown only if assigned)               │
├─────────────────────────────────────────────────────────────┤
│  Status Section (visible to all)                            │
│  - Connected repositories                                    │
│  - MCP servers status                                        │
│  - Bot version/uptime                                        │
├─────────────────────────────────────────────────────────────┤
│  Role Management (visible to admins/owner only)             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Owner: @user [Transfer]                              │   │
│  │ Admins: @user1, @user2 [+ Add] [- Remove]           │   │
│  │ Devs: @user3, @user4 [+ Add] [- Remove]             │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Help Section (visible to all)                              │
│  - How to use the bot                                        │
│  - Available trigger methods                                 │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### roles.json Structure

```json
{
  "owner": "U1234567890",
  "admins": ["U1234567890", "U0987654321"],
  "devs": ["UABCDEFGHI", "UJKLMNOPQR"]
}
```

**Notes:**
- Owner is always implicitly an admin (no need to list in admins array)
- Empty file or missing file = unclaimed state
- User IDs are Slack user IDs (e.g., U1234567890)

## Key Flows

### Bootstrap (First Owner Claim)

```
1. User opens Home tab
2. System checks roles.json
3. If no owner exists → show "Claim Ownership" button
4. User clicks "Claim Ownership"
5. System sets user as owner in roles.json
6. Home tab refreshes with full admin view
```

### Ownership Transfer

```
1. Owner clicks "Transfer Ownership" on Home tab
2. Modal opens with user selector
3. Owner selects target user
4. System validates target is not disabled (Slack API)
5. System updates roles.json: new owner, old owner → admin
6. Both users' Home tabs refresh
```

### Disabled Owner Claim

```
1. Admin opens Home tab
2. System detects owner exists
3. System checks if owner is disabled (users.info API)
4. If disabled → show "Claim Ownership" button to admins
5. Admin clicks button
6. System sets admin as new owner
```

## Component Structure

```
src/
├── roles.ts                    # Role management logic
│   ├── loadRoles()
│   ├── saveRoles()
│   ├── getRole(userId)
│   ├── isOwner(userId)
│   ├── isAdmin(userId)
│   ├── isDev(userId)
│   ├── setOwner(userId)
│   ├── addAdmin(userId)
│   ├── removeAdmin(userId)
│   ├── addDev(userId)
│   ├── removeDev(userId)
│   └── isUserDisabled(client, userId)
│
└── slack/
    ├── homeTab.ts              # Home tab rendering
    │   ├── buildHomeView(userId, role)
    │   ├── buildStatusSection()
    │   ├── buildRoleManagementSection()
    │   └── buildHelpSection()
    │
    └── handlers/
        └── homeTab.ts          # Home tab event handlers
            ├── registerHomeTabHandler(app)
            ├── handleClaimOwnership()
            ├── handleTransferOwnership()
            ├── handleAddAdmin()
            ├── handleRemoveAdmin()
            ├── handleAddDev()
            └── handleRemoveDev()
```

## State Directory Convention

This change introduces `data/state/` for runtime-persisted data:

```
data/
├── auth/           # Secrets (slack.json, ssh keys)
├── config.json     # User configuration
├── mcp.json        # MCP server configuration
├── repositories/   # Cloned repos
├── sessions/       # Session data
└── state/          # NEW: Runtime persistent state
    └── roles.json  # User roles
```

## Security Considerations

1. **Home tab is private**: Only the viewing user sees their Home tab
2. **Role checks on every action**: Validate permissions server-side, not just UI
3. **Owner protection**: Owner can never be removed, only transferred
4. **Disabled user detection**: Prevents orphaned ownership

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No roles.json exists | First visitor can claim ownership |
| Owner removes all admins | Allowed (owner is always admin) |
| Admin removes themselves | Allowed (owner remains) |
| Last admin (non-owner) removed | Allowed (owner is always admin) |
| Owner disabled, no admins | Any Home tab visitor can claim |
| Transfer to disabled user | Blocked with error message |
| Multiple simultaneous claims | First write wins (file locking) |
