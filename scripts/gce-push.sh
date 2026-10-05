#!/bin/bash
# Push local data/ files to the VM's persistent data disk, one file at a time.
# Creates files missing on the VM; replaces an existing VM file only when it is
# named with --overwrite <path> AND its VM copy is unchanged since the last sync.
# Never deletes. Run with --help for every flag; the engine is scripts/gceSync/cli.ts.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

require_project
require_instance

export GCE_INSTANCE="$INSTANCE_NAME" GCE_ZONE="$ZONE" GCE_DATA_MOUNT="$DATA_MOUNT_POINT" GCE_PROJECT_DIR="$PROJECT_DIR"
cd "$PROJECT_DIR"
exec npx tsx scripts/gceSync/cli.ts push "$@"
