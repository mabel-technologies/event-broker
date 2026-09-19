#!/usr/bin/env bash
set -euo pipefail

# Replicates what each backend repo's own CI does on push (generate-event-registry.ts +
# sync-event-registry.ts), then applies the merged registry's per-consumer event lists as SNS
# FilterPolicy on the local platform-events subscriptions -- mirroring
# social-fe-devops/script/sync_sns.py, which is the script that actually runs this against real
# AWS on push to social-fe-devops's `events` branch. See ../../README.md > Local development with
# Floci > Filter policies for the full explanation.
#
# Runs on the host (not in a container): it needs the sibling repos on disk and event-broker's own
# node_modules/dist, and repo paths are hardcoded relative to this monorepo layout.
#
# Prereq: .local/setup.sh has already provisioned the topics/queues.
# Usage:  bash .local/provision/sync-filters.sh   (or: npm run local:filters)

cd "$(dirname "${BASH_SOURCE[0]}")/../.." # -> event-broker/

if [ ! -d node_modules ]; then
  echo "[sync-filters] node_modules missing, running npm install..."
  npm install
fi
if [ ! -f dist/scripts/generate-event-registry.js ]; then
  echo "[sync-filters] dist/ missing, running npm run build..."
  npm run build
fi

MONOREPO_ROOT="$(cd .. && pwd)"
REGISTRY_SEED="$MONOREPO_ROOT/social-fe-devops/event_registry.json"
REGISTRY_OUT="$(pwd)/.local/provision/event_registry.json"

if [ ! -f "$REGISTRY_SEED" ]; then
  echo "[sync-filters] ERROR: $REGISTRY_SEED not found." >&2
  echo "  Clone social-fe-devops alongside event-broker -- it holds the real shared registry" >&2
  echo "  (256 events as of the last real sync) that this script uses as its starting point." >&2
  exit 1
fi

echo "[sync-filters] Seeding merged registry from social-fe-devops's real event_registry.json..."
cp "$REGISTRY_SEED" "$REGISTRY_OUT"

# repo dir -> devops short name. Matches EVENT_REGISTRY_SERVICE_NAME as set in each repo's own
# *-cicd.yml (see knowledgebase/event-architecture.md section 3) -- NOT each repo's package.json
# name, because auclair-be-main and social-be both ship "auclair-be-framework" there (a real bug,
# documented, worked around in real CI the same way: an explicit env var per workflow).
declare -A REPOS=(
  ["auclair-be-main"]="auth"
  ["social-be"]="social"
  ["auclair-be-music1"]="music"
  ["auclair-be-data"]="data"
  ["auclair-be-networkgraph"]="networkgraph"
)

# generate-event-registry.js always writes <root>/event_registry.json. Two of the five repos
# (auclair-be-music1, auclair-be-networkgraph) commit that file to git instead of gitignoring it,
# so pointing EVENT_BROKER_REGISTRY_ROOT straight at the repo would dirty a tracked file on every
# run. Point it at a scratch dir with a symlinked src/ instead -- read-only access to the real
# source, output never touches the repo.
SCRATCH_ROOT="$(pwd)/.local/provision/.scratch"
rm -rf "$SCRATCH_ROOT"
mkdir -p "$SCRATCH_ROOT"

for repo in "${!REPOS[@]}"; do
  short="${REPOS[$repo]}"
  repo_path="$MONOREPO_ROOT/$repo"
  if [ ! -d "$repo_path" ]; then
    echo "[sync-filters] skip $repo -- not cloned alongside event-broker"
    continue
  fi

  scratch="$SCRATCH_ROOT/$short"
  mkdir -p "$scratch"
  ln -sfn "$repo_path/src" "$scratch/src"
  printf '{"name": "%s"}' "$short" >"$scratch/package.json"

  echo "[sync-filters] $repo ($short): scanning src/ for @OnSubscribe / .publish(...)..."
  EVENT_BROKER_REGISTRY_ROOT="$scratch" node dist/scripts/generate-event-registry.js

  echo "[sync-filters] $repo ($short): merging into $(basename "$REGISTRY_OUT")..."
  EVENT_REGISTRY_ROOT="$scratch" EVENT_REGISTRY_SERVICE_NAME="$short" \
    node dist/scripts/sync-event-registry.js -- "$REGISTRY_OUT"
done

rm -rf "$SCRATCH_ROOT"

# data2/music2/personalisation/personalisationsocial/subscription have no repo cloned locally to
# regenerate from, so their entries carry over unchanged from the social-fe-devops seed -- the
# same staleness real AWS has for any service whose own CI hasn't run recently.

echo "[sync-filters] Applying filter policies to Floci SNS subscriptions..."
node .local/provision/apply-filters.mjs "$REGISTRY_OUT"

echo "[sync-filters] Done. Merged registry saved at .local/provision/event_registry.json"
