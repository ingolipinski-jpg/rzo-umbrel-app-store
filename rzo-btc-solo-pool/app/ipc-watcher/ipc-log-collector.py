#!/usr/bin/env python3
"""RZO IPC log collector: read-only Docker JSON log follower."""

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path(os.environ.get("RZO_POOL_LOG", "/para-data/pool-runtime.log"))
DEST = Path(os.environ.get("RZO_IPC_LOG", "/para-data/ipc-events.log"))
RUN_FILE = Path(os.environ.get("RZO_IPC_RUN_FILE", "/para-data/ipc-run-id"))

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

MAX_BYTES = 262144
MAX_POOL_LOG_BYTES = 8 * 1024 * 1024


def write_event(message, run_id):
    lower = message.lower()
    pattern = next((p for p in PATTERNS if p in lower), None)
    if pattern is None:
        return

    height = re.search(r"\bheight=(\d+)", lower)
    event = pattern
    if height:
        event += f" height={height.group(1)}"

    stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    DEST.parent.mkdir(parents=True, exist_ok=True)

    with DEST.open("a", encoding="utf-8") as stream:
        stream.write(f"{stamp} run_id={run_id} {event}\n")

    if DEST.stat().st_size > MAX_BYTES:
        with DEST.open("rb") as stream:
            stream.seek(-MAX_BYTES, os.SEEK_END)
            data = stream.read()

        cut = data.find(b"\n")
        if cut >= 0:
            data = data[cut + 1:]

        temp = DEST.with_suffix(".log.tmp")
        temp.write_bytes(data)
        temp.replace(DEST)



def main():
    position = 0
    active_run = None

    while True:
        try:
            run_id = RUN_FILE.read_text(encoding="utf-8").strip()

            if not re.fullmatch(r"[0-9a-fA-F-]{36}", run_id):
                time.sleep(1)
                continue

            if run_id != active_run:
                active_run = run_id
                position = 0

            if not SOURCE.exists():
                time.sleep(1)
                continue

            size = SOURCE.stat().st_size

            if size < position:
                position = 0

            with SOURCE.open("r", encoding="utf-8", errors="replace") as stream:
                stream.seek(position)

                while True:
                    line = stream.readline()
                    if not line:
                        break

                    position = stream.tell()
                    write_event(line, run_id)

            # In-place truncation: Pool behält seinen Dateideskriptor.
            # Die Datei kann zwischen zwei Prüfungen kurzzeitig größer sein.
            if SOURCE.stat().st_size > MAX_POOL_LOG_BYTES:
                with SOURCE.open("r+b") as output:
                    output.truncate(0)
                position = 0

            time.sleep(0.5)

        except OSError:
            time.sleep(2)


if __name__ == "__main__":
    main()
