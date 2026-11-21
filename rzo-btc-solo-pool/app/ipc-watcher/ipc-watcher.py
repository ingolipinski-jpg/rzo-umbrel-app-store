#!/usr/bin/env python3
"""RZO IPC watcher: timestamped events, no Docker access."""

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

LOG = Path(os.environ.get(
    "RZO_IPC_LOG", "/home/umbrel/para-data/ipc-events.log"
))
OUTPUT = Path(os.environ.get(
    "RZO_IPC_STATUS",
    "/home/umbrel/rzo-webui-data/ipc-status.json"
))
RUN_FILE = Path(os.environ.get(
    "RZO_IPC_RUN_FILE",
    "/home/umbrel/para-data/ipc-run-id"
))
MAX_AGE = 120

EVENTS = (
    ("rzo template source=native_ipc", "confirmed"),
    ("rzo template source=rpc_fallback", "fallback"),
    ("native ipc published immediately", "confirmed"),
    ("rzo native ipc connected", "connected"),
    ("ipc reconnect failed", "error"),
    ("ipc connection timed out", "error"),
    ("ipc worker not connected", "error"),
    ("ipc template task timed out", "error"),
    ("ipc template failed during gbt", "error"),
)

DETAILS = {
    "confirmed": "Native IPC: Template erfolgreich veröffentlicht",
    "fallback": "RPC-Fallback im Pool-Log erkannt",
    "error": "IPC-Fehler im Pool-Log erkannt",
    "unknown": "Kein aktueller IPC-Nachweis",
}

LINE = re.compile(
    r"^(\S+)\s+run_id=([0-9a-fA-F-]{36})\s+(.*)$"
)
HEIGHT = re.compile(r"height=(\d+)")

def collect():
    now = int(time.time())
    result = {
        "checked_at": now,
        "state": "unknown",
        "source": "timestamped-pool-events",
        "last_event_at": None,
        "last_success_at": None,
        "last_blockheight": None,
        "detail": DETAILS["unknown"],
    }

    try:
        run_id = RUN_FILE.read_text(
            encoding="utf-8"
        ).strip()

        if not re.fullmatch(
            r"[0-9a-fA-F-]{36}", run_id
        ):
            result["detail"] = "Ungültige Pool-Laufzeitkennung"
            return result

        if not LOG.is_file():
            result["detail"] = "IPC-Ereignisdatei fehlt"
            return result

        with LOG.open("rb") as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(max(0, size - 262144))
            content = stream.read().decode(
                "utf-8", errors="replace"
            )

        latest = None
        latest_time = None
        last_success = None
        last_height = None

        for line in content.splitlines():
            match = LINE.match(line)
            if not match:
                continue

            stamp, event_run, message = match.groups()

            if event_run != run_id:
                continue

            try:
                event_time = int(
                    datetime.fromisoformat(
                        stamp.replace("Z", "+00:00")
                    ).timestamp()
                )
            except (ValueError, OverflowError):
                continue

            if event_time > now + 30:
                continue

            message = message.lower()
            state = next(
                (
                    kind for pattern, kind in EVENTS
                    if pattern in message
                ),
                None
            )

            if state is None:
                continue

            if (
                latest_time is None
                or event_time >= latest_time
            ):
                latest_time = event_time
                latest = state

            if state == "confirmed":
                if (
                    last_success is None
                    or event_time >= last_success
                ):
                    last_success = event_time
                    height = HEIGHT.search(message)
                    if height:
                        last_height = int(height.group(1))

        result["last_success_at"] = last_success
        result["last_blockheight"] = last_height
        result["last_event_at"] = latest_time

        if latest_time is None:
            result["detail"] = "Keine IPC-Ereignisse dieser Pool-Laufzeit"
        elif now - latest_time > MAX_AGE:
            result["detail"] = "IPC-Ereignisse veraltet"
        elif latest == "connected":
            result["detail"] = "IPC verbunden; Template noch nicht bestätigt"
        else:
            result["state"] = latest
            result["detail"] = DETAILS[latest]

    except (OSError, ValueError, TypeError):
        result["detail"] = "IPC-Diagnose nicht verfügbar"

    return result

def write_status(payload):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8"
    )
    temporary.replace(OUTPUT)

def main():
    while True:
        write_status(collect())
        time.sleep(10)

if __name__ == "__main__":
    main()
