#!/bin/bash
# Drained restart of the clack container on the GCE VM. Same gate as the deploy's
# Phase 1.5: wait for the bot to go idle (/status busy=false) before restarting,
# so an in-flight Claude run is never killed mid-answer.
#
# Unlike the deploy (which proceeds at its idle-wait cap — the operator already
# committed to a swap), this script ABORTS when the bot is still busy at the
# deadline. Pass --force to restart anyway.
#
# Usage: scripts/gce-restart.sh [--force]
#   DRAIN_MAX_WAIT=<secs>  override the drain deadline (default 300)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/gce-common.sh"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

DRAIN_MAX_WAIT="${DRAIN_MAX_WAIT:-300}"

require_project
require_instance

echo -e "${YELLOW}Draining: waiting for active runs to finish (up to ${DRAIN_MAX_WAIT}s)...${NC}"

DRAIN_EXIT=0
wait_for_idle "$DRAIN_MAX_WAIT" || DRAIN_EXIT=$?

if [ "$DRAIN_EXIT" = "11" ]; then
    echo -e "${YELLOW}Drain check skipped — restarting.${NC}"
elif [ "$DRAIN_EXIT" = "10" ]; then
    if [ "$FORCE" = "1" ]; then
        echo -e "${YELLOW}Still busy after ${DRAIN_MAX_WAIT}s — restarting anyway (--force).${NC}"
    else
        echo -e "${RED}✗ Bot still busy after ${DRAIN_MAX_WAIT}s — NOT restarting. Re-run with --force to override.${NC}"
        exit 1
    fi
elif [ "$DRAIN_EXIT" != "0" ]; then
    echo -e "${RED}✗ Drain probe failed (ssh exit ${DRAIN_EXIT}) — NOT restarting.${NC}"
    exit 1
fi

echo -e "${YELLOW}Restarting container (downtime starts here)...${NC}"
DOWNTIME_START=$(date +%s)

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command='docker restart clack > /dev/null'

echo -e "${YELLOW}Waiting for bot to reach 'Clack is ready' (up to 5 min)...${NC}"

WAIT_EXIT=0
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command='bash -s' <<'REMOTE' || WAIT_EXIT=$?
timeout 300 sh -c 'start=$(docker inspect --format "{{.State.StartedAt}}" clack); while true; do
    if docker logs --since "$start" clack 2>&1 | grep -q "Clack is ready"; then exit 0; fi
    if ! docker ps --filter name=clack --format "{{.Status}}" | grep -q Up; then exit 3; fi
    sleep 2
done'
REMOTE

DOWNTIME=$(( $(date +%s) - DOWNTIME_START ))

echo ""
case $WAIT_EXIT in
    0)
        echo -e "${GREEN}✓ Bot is ready — downtime $((DOWNTIME / 60))m $((DOWNTIME % 60))s${NC}"
        ;;
    3)
        echo -e "${RED}✗ Container exited after restart. Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs --tail 80 clack'"
        exit 1
        ;;
    *)
        echo -e "${RED}✗ Bot did not become ready within 5 min. Logs:${NC}"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='docker logs -f clack'"
        exit 1
        ;;
esac
