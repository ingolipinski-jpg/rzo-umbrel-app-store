#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COUNT="$(find "$ROOT/patches" -maxdepth 1 -type f -name "*.patch" | wc -l)"

if [ "$COUNT" -ne 7 ]; then
    echo "ERROR: expected 7 RZO patches, found $COUNT" >&2
    exit 1
fi

echo "PASS: 7 RZO patches present"

for PATCH in "$ROOT"/patches/*.patch; do
    printf "%s  " "$(basename "$PATCH")"
    sha256sum "$PATCH" | awk "{print \$1}"
done
