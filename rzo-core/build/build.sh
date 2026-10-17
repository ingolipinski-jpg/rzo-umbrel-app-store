#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/build/versions.env"

sudo docker build \
  --file "$ROOT/build/Dockerfile" \
  --build-arg "BITCOIN_BASE_COMMIT=$BITCOIN_BASE_COMMIT" \
  --build-arg "EXPECTED_SOURCE_TREE=$RZO_SOURCE_TREE" \
  --build-arg "EXPECTED_BITCOIND_SHA256=$RZO_EXPECTED_BITCOIND_SHA256" \
  --tag rzo-core:1.0.0 \
  "$ROOT"
