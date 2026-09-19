#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# floci-ui ships no prebuilt API image, so both services are built from the real floci-ui source
# (see docker-compose.yml's floci-api/floci-ui services, gated behind --profile ui). This clones
# that source into ./floci-ui on first run only.
if [ ! -d floci-ui ]; then
  echo "[floci-ui] Cloning floci-io/floci-ui (first run only)..."
  git clone --depth 1 https://github.com/floci-io/floci-ui.git floci-ui
fi

if ! docker inspect --format='{{.State.Health.Status}}' event-broker-floci 2>/dev/null | grep -q healthy; then
  echo "[floci-ui] floci isn't running -- start it first: npm run local:up"
  exit 1
fi

echo "[floci-ui] Building and starting floci-api + floci-ui (first run builds images, ~1-2 min)..."
docker compose --profile ui up -d --build floci-api floci-ui

echo ""
echo "[floci-ui] Ready: http://localhost:4500"
echo "Stop with: npm run local:ui:down"
