#!/bin/bash
# Drained restart of the clack container on the GCE VM. Same gate as the deploy's
# Phase 1.5: wait for the bot to go idle (/status busy=false) before restarting,
# so an in-flight Claude run is never killed mid-answer.
#
# Unlike the deploy (which proceeds on drain timeout — the operator already
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

STATUS_PORT="${STATUS_PORT:-8787}"
DRAIN_MAX_WAIT="${DRAIN_MAX_WAIT:-300}"

require_project
require_instance

echo -e "${YELLOW}Draining: waiting for active runs to finish (up to ${DRAIN_MAX_WAIT}s)...${NC}"

DRAIN_EXIT=0
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
    --command="bash -s ${STATUS_PORT} ${DRAIN_MAX_WAIT}" <<'REMOTE' || DRAIN_EXIT=$?
PORT="$1"
MAX="$2"
deadline=$(( $(date +%s) + MAX ))
probe() {
    docker exec -e SP="$PORT" clack node -e 'fetch("http://127.0.0.1:"+process.env.SP+"/status").then(r=>r.json()).then(j=>process.stdout.write(j.busy+" "+j.activeRuns.count+" "+j.workers.active)).catch(()=>process.exit(2))' 2>/dev/null
}
while :; do
    out=$(probe) || { echo "Drain check skipped (status endpoint unreachable)."; exit 0; }
    set -- $out
    busy="$1"; runs="$2"; workers="$3"
    if [ "$busy" != "true" ] && [ "$busy" != "false" ]; then
        echo "Drain check skipped (status endpoint returned unexpected output)."; exit 0
    fi
    if [ "$busy" = "false" ]; then echo "Bot idle — proceeding."; exit 0; fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "Drain timeout — still busy ($runs runs, $workers workers)."
        exit 4
    fi
    echo "Draining: ($runs runs, $workers workers) waiting..."
    sleep 5
done
REMOTE

if [ "$DRAIN_EXIT" = "4" ]; then
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
