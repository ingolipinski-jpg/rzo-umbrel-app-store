#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/build/versions.env"

IMAGE="${1:-rzo-core:1.0.0}"

echo "===== RZO CORE IMAGE ====="
sudo docker image inspect "$IMAGE" --format "{{.Id}}"

echo
echo "===== BITCOIND VERSION ====="
sudo docker run --rm \
  --entrypoint /bin/sh \
  "$IMAGE" -c 'mkdir -p /tmp/rzo-core-verify && exec /opt/bitcoind/v31.1/bitcoind -datadir=/tmp/rzo-core-verify --version' \
  | head -n 3

echo
echo "===== BITCOIND SHA256 ====="

ACTUAL="$(
  sudo docker run --rm \
    --entrypoint sha256sum \
    "$IMAGE" /opt/bitcoind/v31.1/bitcoind \
  | awk "{print \$1}"
)"

echo "Expected: $RZO_EXPECTED_BITCOIND_SHA256"
echo "Actual:   $ACTUAL"

test "$ACTUAL" = "$RZO_EXPECTED_BITCOIND_SHA256"

echo
echo "PASS: RZO Core bitcoind matches production reference."
