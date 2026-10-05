#!/bin/bash
# Pull the VM's data/ files down to local, one file at a time.
# Replaces local files the VM changed since the last sync (a local copy with edits
# of its own is backed up first to data/.gce-sync-backups/); keeps files changed
# only locally. Never deletes. --all widens the scope from the push manifest to
# the whole data tree (caches, repositories/ and worktrees/ excluded).
# Run with --help for every flag; the engine is scripts/gceSync/cli.ts.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

require_project
require_instance

export GCE_INSTANCE="$INSTANCE_NAME" GCE_ZONE="$ZONE" GCE_DATA_MOUNT="$DATA_MOUNT_POINT" GCE_PROJECT_DIR="$PROJECT_DIR"
cd "$PROJECT_DIR"
exec npx tsx scripts/gceSync/cli.ts pull "$@"
