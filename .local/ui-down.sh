#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

docker compose --profile ui stop floci-api floci-ui
docker compose --profile ui rm -f floci-api floci-ui
