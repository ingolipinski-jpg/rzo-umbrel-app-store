#!/usr/bin/env python3
"""Filter pool stdout into bounded, timestamped IPC events."""

import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

LOG = Path(os.environ.get("RZO_IPC_LOG", "/data/ipc-events.log"))
RUN_FILE = Path(os.environ.get("RZO_IPC_RUN_FILE", "/data/ipc-run-id"))
MAX_BYTES = 262144

PATTERNS = (
    "rzo template source=native_ipc",
    "rzo template source=rpc_fallback",
    "native ipc published immediately",
    "rzo native ipc connected",
    "ipc reconnect failed",
    "ipc connection timed out",
    "ipc worker not connected",
    "ipc template task timed out",
    "ipc template failed during gbt",
)

def main():
    run_id = RUN_FILE.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", run_id):
        raise ValueError("Invalid run_id")

    LOG.parent.mkdir(parents=True, exist_ok=True)

    for raw in sys.stdin:
        message = raw.rstrip("\r\n")
        lower = message.lower()

        if not any(pattern in lower for pattern in PATTERNS):
            continue

        # Store only the recognized event, not arbitrary debug output.
        pattern = next(p for p in PATTERNS if p in lower)
        height = re.search(r"\bheight=(\d+)", lower)

        event = pattern
        if height:
            event += f" height={height.group(1)}"

        stamp = datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
        line = f"{stamp} run_id={run_id} {event}\n"

        with LOG.open("a", encoding="utf-8") as stream:
            stream.write(line)

        if LOG.stat().st_size > MAX_BYTES:
            with LOG.open("rb") as stream:
                stream.seek(-MAX_BYTES, os.SEEK_END)
                data = stream.read()

            # Discard any incomplete leading line.
            first_newline = data.find(b"\n")
            if first_newline >= 0:
                data = data[first_newline + 1:]

            temporary = LOG.with_suffix(".log.tmp")
            temporary.write_bytes(data)
            temporary.replace(LOG)

if __name__ == "__main__":
    main()
