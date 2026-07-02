#!/usr/bin/env bash
# Local smoke test for the tester recording pipeline — no Clack app required.
#
# Stands up the clack-playwright sidecar (docker-compose.tester.yml), runs the
# gated integration test (sidecar probe → MCP handshake → recorded browser
# session → .webm on data/tester/recordings → ffmpeg transcode when available),
# and tears the sidecar down again.
#
#   ./scripts/tester-smoke.sh
#
# Pass KEEP_SIDECAR=1 to leave the sidecar running afterwards (useful while
# iterating on config.tester locally).
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.tester.yml)
SIDECAR_URL="${TESTER_SIDECAR_URL:-http://localhost:8931/mcp}"

echo "▶ starting clack-playwright sidecar..."
"${COMPOSE[@]}" up -d

cleanup() {
  if [ "${KEEP_SIDECAR:-0}" = "1" ]; then
    echo "▶ leaving sidecar running (KEEP_SIDECAR=1)"
  else
    echo "▶ stopping sidecar..."
    "${COMPOSE[@]}" down
  fi
}
trap cleanup EXIT

echo "▶ waiting for the MCP endpoint at ${SIDECAR_URL}..."
reachable=0
for _ in $(seq 1 30); do
  # Any HTTP response counts as reachable (HEAD yields a 400 here by design).
  if curl -s -o /dev/null --max-time 2 "${SIDECAR_URL}"; then
    reachable=1
    break
  fi
  sleep 1
done
if [ "${reachable}" != "1" ]; then
  echo "✗ sidecar never became reachable" >&2
  exit 1
fi

echo "▶ running the recording-pipeline integration test..."
TESTER_SMOKE=1 npx vitest run src/tester/sidecarPipeline.integration.test.ts

echo "✓ tester pipeline smoke test passed"
