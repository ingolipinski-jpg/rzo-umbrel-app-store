#!/usr/bin/env python3

import json
import os
import socket
import struct
import time
from pathlib import Path


PORTS = {42068, 42069}

DATA_FILE = Path(
    "/home/umbrel/rzo-webui-data/rzo-device-agents.json"
)

MAX_STREAM_BUFFER = 65536
MAX_AGENT_LENGTH = 256
MAX_USERNAME_LENGTH = 300

# TCP-Verbindungen:
# (src_ip, src_port, dst_ip, dst_port)
connections = {}

# Dauerhaft bekannte Worker -> User-Agent
entries = {}


def now():
    return int(time.time())


def load_database():
    global entries

    try:
        data = json.loads(DATA_FILE.read_text())

        loaded = data.get("entries", {})

        if isinstance(loaded, dict):
            entries = loaded
        else:
            entries = {}

    except FileNotFoundError:
        entries = {}

    except Exception as exc:
        print(
            f"[WARN] vorhandene Datenbank konnte "
            f"nicht gelesen werden: {exc}",
            flush=True,
        )
        entries = {}


def save_database():
    DATA_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    payload = {
        "version": 1,
        "updated_at": now(),
        "entry_count": len(entries),
        "entries": entries,
    }

    tmp = DATA_FILE.with_suffix(".json.tmp")

    tmp.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )

    os.chmod(tmp, 0o600)
    os.replace(tmp, DATA_FILE)
    os.chown(DATA_FILE, 1000, 1000)
    os.chmod(DATA_FILE, 0o600)


def decode_string(value):
    if not isinstance(value, str):
        return ""

    value = value.strip()

    # Keine absurden Datenmengen übernehmen.
    return value[:MAX_AGENT_LENGTH]


def split_username(username):
    username = str(username or "").strip()

    if not username:
        return "", ""

    if "." in username:
        address, worker = username.split(".", 1)
    else:
        address = username
        worker = ""

    return address.strip(), worker.strip()


def remember(username, agent):
    username = str(username or "")[:MAX_USERNAME_LENGTH]
    agent = decode_string(agent)

    if not username:
        return

    address, worker = split_username(username)

    if not address:
        return

    key = f"{address}|{worker}"

    previous = entries.get(key, {})

    # Falls ein Miner ausnahmsweise keinen User-Agent sendet,
    # behalten wir einen bereits bekannten Wert.
    if not agent:
        agent = str(
            previous.get("user_agent")
            or ""
        )

    session_started_at = now()

    entries[key] = {
        "address": address,
        "worker": worker,
        "user_agent": agent,
        "session_started_at": session_started_at,
        "last_seen": session_started_at,
    }

    save_database()

    shown_worker = worker or "(ohne Workername)"
    shown_agent = agent or "(leer/unbekannt)"

    print(
        f"[DEVICE] {shown_worker} -> {shown_agent}",
        flush=True,
    )


def process_message(conn_key, raw):
    raw = raw.strip()

    if not raw:
        return

    try:
        message = json.loads(
            raw.decode("utf-8", errors="strict")
        )
    except Exception:
        return

    if not isinstance(message, dict):
        return

    method = message.get("method")
    params = message.get("params")

    if not isinstance(params, list):
        params = []

    state = connections.setdefault(
        conn_key,
        {
            "buffer": b"",
            "next_seq": None,
            "user_agent": "",
            "updated": now(),
        },
    )

    state["updated"] = now()

    if method == "mining.subscribe":
        agent = ""

        if params and isinstance(params[0], str):
            agent = decode_string(params[0])

        state["user_agent"] = agent

        print(
            f"[SUBSCRIBE] {conn_key[0]}:{conn_key[1]} "
            f"-> {agent or '(leer)'}",
            flush=True,
        )

        return

    if method == "mining.authorize":
        if not params:
            return

        username = params[0]

        if not isinstance(username, str):
            return

        # params[1] wäre das Miner-Passwort.
        # Es wird absichtlich weder gelesen noch gespeichert.
        remember(
            username,
            state.get("user_agent", ""),
        )


def process_payload(conn_key, seq, payload):
    if not payload:
        return

    state = connections.setdefault(
        conn_key,
        {
            "buffer": b"",
            "next_seq": None,
            "user_agent": "",
            "updated": now(),
        },
    )

    state["updated"] = now()

    next_seq = state.get("next_seq")

    if next_seq is None:
        state["next_seq"] = seq + len(payload)

    elif seq < next_seq:
        overlap = next_seq - seq

        if overlap >= len(payload):
            return

        payload = payload[overlap:]
        state["next_seq"] += len(payload)

    elif seq > next_seq:
        # Lücke / verlorenes Capture-Paket:
        # alten unvollständigen JSON-Rest verwerfen.
        state["buffer"] = b""
        state["next_seq"] = seq + len(payload)

    else:
        state["next_seq"] += len(payload)

    state["buffer"] += payload

    if len(state["buffer"]) > MAX_STREAM_BUFFER:
        state["buffer"] = state["buffer"][-MAX_STREAM_BUFFER:]

    while b"\n" in state["buffer"]:
        line, state["buffer"] = state["buffer"].split(
            b"\n",
            1,
        )

        process_message(
            conn_key,
            line,
        )


def parse_ipv4(frame, offset):
    if len(frame) < offset + 20:
        return

    version_ihl = frame[offset]

    version = version_ihl >> 4
    ihl = (version_ihl & 0x0F) * 4

    if version != 4 or ihl < 20:
        return

    if len(frame) < offset + ihl:
        return

    protocol = frame[offset + 9]

    if protocol != 6:
        return

    total_length = struct.unpack(
        "!H",
        frame[offset + 2:offset + 4],
    )[0]

    src_ip = socket.inet_ntoa(
        frame[offset + 12:offset + 16]
    )

    dst_ip = socket.inet_ntoa(
        frame[offset + 16:offset + 20]
    )

    tcp_offset = offset + ihl
    ip_end = min(
        len(frame),
        offset + total_length,
    )

    parse_tcp(
        frame,
        tcp_offset,
        ip_end,
        src_ip,
        dst_ip,
    )


def parse_ipv6(frame, offset):
    if len(frame) < offset + 40:
        return

    version = frame[offset] >> 4

    if version != 6:
        return

    next_header = frame[offset + 6]

    # Für unsere lokalen Stratum-Verbindungen erwarten
    # wir TCP direkt ohne IPv6 Extension Headers.
    if next_header != 6:
        return

    payload_length = struct.unpack(
        "!H",
        frame[offset + 4:offset + 6],
    )[0]

    src_ip = socket.inet_ntop(
        socket.AF_INET6,
        frame[offset + 8:offset + 24],
    )

    dst_ip = socket.inet_ntop(
        socket.AF_INET6,
        frame[offset + 24:offset + 40],
    )

    tcp_offset = offset + 40
    ip_end = min(
        len(frame),
        tcp_offset + payload_length,
    )

    parse_tcp(
        frame,
        tcp_offset,
        ip_end,
        src_ip,
        dst_ip,
    )


def parse_tcp(
    frame,
    offset,
    packet_end,
    src_ip,
    dst_ip,
):
    if len(frame) < offset + 20:
        return

    src_port, dst_port = struct.unpack(
        "!HH",
        frame[offset:offset + 4],
    )

    if dst_port not in PORTS:
        return

    seq = struct.unpack(
        "!I",
        frame[offset + 4:offset + 8],
    )[0]

    data_offset = (
        (frame[offset + 12] >> 4) * 4
    )

    if data_offset < 20:
        return

    payload_start = offset + data_offset

    if payload_start > packet_end:
        return

    flags = frame[offset + 13]

    conn_key = (
        src_ip,
        src_port,
        dst_ip,
        dst_port,
    )

    payload = frame[
        payload_start:packet_end
    ]

    if payload:
        process_payload(
            conn_key,
            seq,
            payload,
        )

    # FIN oder RST
    if flags & 0x05:
        connections.pop(
            conn_key,
            None,
        )


def process_frame(frame):
    if len(frame) < 14:
        return

    ethertype = struct.unpack(
        "!H",
        frame[12:14],
    )[0]

    offset = 14

    # VLAN
    if ethertype in (0x8100, 0x88A8):
        if len(frame) < 18:
            return

        ethertype = struct.unpack(
            "!H",
            frame[16:18],
        )[0]

        offset = 18

    if ethertype == 0x0800:
        parse_ipv4(
            frame,
            offset,
        )

    elif ethertype == 0x86DD:
        parse_ipv6(
            frame,
            offset,
        )


def cleanup_connections():
    cutoff = now() - 3600

    stale = [
        key
        for key, value in connections.items()
        if value.get("updated", 0) < cutoff
    ]

    for key in stale:
        connections.pop(
            key,
            None,
        )


def main():
    load_database()

    print(
        "[START] RZO Stratum Device Watcher",
        flush=True,
    )

    print(
        "[START] Lausche passiv auf "
        "TCP 42068/42069",
        flush=True,
    )

    print(
        f"[START] Bereits bekannte Geräte: "
        f"{len(entries)}",
        flush=True,
    )

    sock = socket.socket(
        socket.AF_PACKET,
        socket.SOCK_RAW,
        socket.htons(0x0003),
    )

    sock.settimeout(5.0)

    last_cleanup = time.time()

    while True:
        try:
            frame, _ = sock.recvfrom(65535)

        except socket.timeout:
            frame = None

        if frame:
            try:
                process_frame(frame)

            except Exception as exc:
                print(
                    f"[WARN] Paketfehler: {exc}",
                    flush=True,
                )

        if time.time() - last_cleanup >= 60:
            cleanup_connections()
            last_cleanup = time.time()


if __name__ == "__main__":
    main()
