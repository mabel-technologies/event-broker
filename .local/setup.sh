#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "[event-broker/local] Starting floci (Docker required)..."
docker compose up -d --wait floci

echo "[event-broker/local] Provisioning SNS/SQS/S3/EventBridge resources..."
docker compose run --rm provision

echo ""
echo "[event-broker/local] Generated resource values:"
echo "---------------------------------------------------------------"
cat provision/generated.env
echo "---------------------------------------------------------------"
echo ""
echo "Copy the vars you need into each service's .env.local, plus these four so the AWS SDK talks"
echo "to floci instead of real AWS (see ../README.md > Local development with Floci):"
echo "  AWS_ENDPOINT_URL=http://localhost:4566"
echo "  AWS_ACCESS_KEY_ID=test"
echo "  AWS_SECRET_ACCESS_KEY=test"
echo "  AWS_DEFAULT_REGION=us-east-1"
echo ""
echo "Re-run this script any time -- it's idempotent. Run ./teardown.sh to stop and wipe floci."
