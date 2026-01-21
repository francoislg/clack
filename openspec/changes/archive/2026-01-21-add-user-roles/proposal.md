# Proposal: Add User Roles with Home Tab Management

## Summary

Add a persistent user roles system (Owner, Admin, Dev) managed via the Slack Home tab UI. Roles are informational for now but will enable feature gating in the future.

## Problem

Currently, there's no way to designate trusted users who can manage the bot or have elevated privileges. As features grow, we need a way to restrict certain capabilities (like configuration changes) to designated administrators.

## Solution

1. **Persistent roles storage**: Store user roles in `data/state/roles.json`
2. **Role hierarchy**: Owner (single) → Admins (many) → Devs (many) → Members (default)
3. **Home tab UI**: Visual interface for role management, bot status, and help
4. **Bootstrap flow**: First Home tab visitor can claim ownership

## Scope

### User Roles System
- Create `data/state/roles.json` for persistent storage
- Define role types: owner, admin, dev
- Owner cannot be removed, only transferred
- Admins can manage other admins and devs
- Disabled owner detection via Slack API for ownership claims

### Home Tab UI
- **All users see**: Status (repos, MCP), Help section, own role badge (if assigned)
- **Admins see**: Role management with Add/Remove controls
- **Owner sees**: Transfer ownership button
- **Unclaimed state**: "Claim Ownership" button for first visitor

### Manifest Generation Updates
- Auto-add `app_home_opened` event subscription
- Auto-add `users:read` scope (for user info and disabled check)
- Enable `features.app_home.home_tab_enabled` in manifest

## Out of Scope

- Feature gating based on roles (future work)
- Role-based access restrictions for queries
- Audit logging of role changes
- Multi-workspace support

## Dependencies

- Existing Slack app integration
- Slack Home tab events (`app_home_opened`)
