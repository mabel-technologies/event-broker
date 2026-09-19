#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "[event-broker/local] Stopping floci and removing its data..."
docker compose down -v
rm -f provision/generated.env
echo "[event-broker/local] Done."
