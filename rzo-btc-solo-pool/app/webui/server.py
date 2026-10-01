#!/usr/bin/env python3

import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


HOST = "0.0.0.0"
PORT = 2020

BACKEND_BASE = "http://127.0.0.1:42070"
WEB_ROOT = Path(__file__).resolve().parent
NODE_PEER_SNAPSHOT = Path("/run/rzo-node-peers.json")
BITCOIN_HOST = "10.21.21.8"
BITCOIN_RPC_PORT = 8332
STRATUM_HOST = "127.0.0.1"
STRATUM_PORT = 42069
ZMQ_ENDPOINTS = {
    "rawblock": 28332,
    "rawtx": 28333,
    "hashblock": 28334,
    "sequence": 28335,
    "hashtx": 28336,
}
NODE_CACHE_TTL = 8
_NODE_CACHE: dict[str, Any] = {"time": 0.0, "payload": None}
_NODE_CACHE_LOCK = threading.Lock()


ADDRESS_PATTERN = re.compile(
    r"^(?:"
    r"bc1[ac-hj-np-z02-9]{11,87}"
    r"|[13][a-km-zA-HJ-NP-Z1-9]{25,34}"
    r")$"
)


def backend_json(path: str) -> Any:
    request = urllib.request.Request(
        f"{BACKEND_BASE}{path}",
        headers={
            "Accept": "application/json",
            "User-Agent": "RZO-WebUI/3.2.0",
        },
    )

    with urllib.request.urlopen(request, timeout=5) as response:
        body = response.read()

    if not body:
        return None

    return json.loads(body.decode("utf-8"))



def read_node_peer_snapshot() -> dict[str, Any] | None:
    """Liest den rootseitig erzeugten Live-Snapshot der Bitcoin Core-Peers."""
    try:
        data = json.loads(NODE_PEER_SNAPSHOT.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        checked_at = int(data.get("checked_at") or 0)
        data["stale"] = not checked_at or time.time() - checked_at > 90
        return data
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def tcp_probe(host: str, port: int, timeout: float = 0.7) -> dict[str, Any]:
    """Prüft einen lokalen Dienst ohne Docker- oder sudo-Abhängigkeit."""
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            latency_ms = (time.perf_counter() - started) * 1000
            return {"reachable": True, "latency_ms": round(latency_ms, 2)}
    except OSError as error:
        return {
            "reachable": False,
            "latency_ms": None,
            "error": type(error).__name__,
        }


def node_diagnostics() -> dict[str, Any]:
    """Robuster Status der lokalen RZO-Node über Pool-API und TCP-Prüfungen."""
    now = time.monotonic()
    with _NODE_CACHE_LOCK:
        cached = _NODE_CACHE.get("payload")
        if cached is not None and now - float(_NODE_CACHE.get("time", 0)) < NODE_CACHE_TTL:
            return cached

    payload: dict[str, Any] = {
        "version": "2.2.0",
        "source": "rzo-node-api-and-tcp-probes",
        "checked_at": int(time.time()),
        "bitcoin": None,
        "mempool": None,
        "peers": None,
        "stratum": None,
        "zmq": {"active": False, "count": 0, "endpoints": []},
        "errors": [],
    }

    try:
        bitcoin = backend_json("/api/bitcoin/status")
        if not isinstance(bitcoin, dict):
            bitcoin = {}
        payload["bitcoin"] = bitcoin
        payload["mempool"] = {
            "size": int(bitcoin.get("mempool_txs") or 0),
            "source": "local-rzo-node",
        }
    except Exception as error:
        payload["errors"].append(f"bitcoin-api: {type(error).__name__}")

    payload["peers"] = read_node_peer_snapshot()

    payload["stratum"] = tcp_probe(STRATUM_HOST, STRATUM_PORT)
    payload["bitcoin_rpc"] = tcp_probe(BITCOIN_HOST, BITCOIN_RPC_PORT)

    endpoints = []
    for name, port in ZMQ_ENDPOINTS.items():
        probe = tcp_probe(BITCOIN_HOST, port)
        endpoints.append({"name": name, "port": port, **probe})

    reachable = [endpoint for endpoint in endpoints if endpoint["reachable"]]
    payload["zmq"] = {
        "active": bool(reachable),
        "count": len(reachable),
        "configured_count": len(endpoints),
        "endpoints": endpoints,
        "source": "tcp-probe",
    }

    with _NODE_CACHE_LOCK:
        _NODE_CACHE["time"] = now
        _NODE_CACHE["payload"] = payload

    return payload


def find_session_objects(value: Any, address: str) -> list[dict[str, Any]]:
    """
    Durchsucht die Router-Status-Antwort rekursiv und gibt nur Datensätze
    zurück, die zur angefragten Bitcoin-Adresse gehören.
    """
    results: list[dict[str, Any]] = []

    if isinstance(value, dict):
        possible_username = (
            value.get("username")
            or value.get("user")
            or value.get("address")
            or value.get("btc_address")
            or value.get("btcaddress")
        )

        if isinstance(possible_username, str) and possible_username == address:
            results.append(value)

        for nested in value.values():
            results.extend(find_session_objects(nested, address))

    elif isinstance(value, list):
        for item in value:
            results.extend(find_session_objects(item, address))

    return results


def first_value(data: dict[str, Any], keys: tuple[str, ...], default: Any = None) -> Any:
    for key in keys:
        value = data.get(key)
        if value is not None:
            return value
    return default


def normalize_worker(data: dict[str, Any], number: int) -> dict[str, Any]:
    worker_name = first_value(
        data,
        (
            "workername",
            "worker_name",
            "worker",
            "name",
            "label",
        ),
        f"Worker {number}",
    )

    if not worker_name:
        worker_name = f"Worker {number}"

    hashrate = first_value(
        data,
        (
            "hashrate",
            "hashrate_1m",
            "hash_rate",
            "estimated_hashrate",
        ),
        None,
    )

    last_share = first_value(
        data,
        (
            "last_share",
            "last_share_time",
            "last_seen",
            "updated_at",
        ),
        None,
    )

    best_share = first_value(
        data,
        (
            "best_share",
            "best_diff",
            "highest_diff",
        ),
        None,
    )

    accepted = first_value(
        data,
        (
            "accepted_shares",
            "accepted",
            "shares_accepted",
        ),
        None,
    )

    rejected = first_value(
        data,
        (
            "rejected_shares",
            "rejected",
            "shares_rejected",
        ),
        None,
    )

    status_value = str(
        first_value(
            data,
            (
                "status",
                "state",
                "connection_status",
            ),
            "",
        )
    ).lower()

    idle = bool(data.get("idle", False))
    disconnected = bool(data.get("disconnected", False))

    if disconnected or status_value in {"offline", "disconnected", "closed"}:
        status = "offline"
    elif idle or status_value == "idle":
        status = "idle"
    else:
        status = "online"

    return {
        "name": str(worker_name),
        "hashrate": hashrate,
        "last_share": last_share,
        "best_share": best_share,
        "accepted_shares": accepted,
        "rejected_shares": rejected,
        "status": status,
    }



def normalize_user_worker(data: dict[str, Any]) -> dict[str, Any]:
    """Bereitet einen Mining-Worker für die öffentliche RZO-WebUI auf."""

    stats = data.get("stats")

    if not isinstance(stats, dict):
        stats = {}

    last_share = stats.get("last_share")
    last_share_number = 0

    try:
        last_share_number = int(last_share or 0)
    except (TypeError, ValueError):
        last_share_number = 0

    current_time = int(__import__("time").time())

    if last_share_number <= 0:
        status = "offline"
    elif current_time - last_share_number > 300:
        status = "idle"
    else:
        status = "online"

    return {
        "name": str(data.get("name") or "Unbenannter Worker"),
        "session_count": data.get("session_count", 0),

        # Standardwert für die bisherige Workerkarte
        "hashrate": stats.get("hashrate_5m"),

        # Zusätzliche Zeiträume für spätere Detailansichten
        "hashrate_1m": stats.get("hashrate_1m"),
        "hashrate_5m": stats.get("hashrate_5m"),
        "hashrate_15m": stats.get("hashrate_15m"),
        "hashrate_1hr": stats.get("hashrate_1hr"),
        "hashrate_6hr": stats.get("hashrate_6hr"),
        "hashrate_1d": stats.get("hashrate_1d"),
        "hashrate_7d": stats.get("hashrate_7d"),

        "sps_1m": stats.get("sps_1m"),
        "sps_5m": stats.get("sps_5m"),
        "sps_15m": stats.get("sps_15m"),
        "sps_1hr": stats.get("sps_1hr"),

        "best_share": stats.get("best_share"),
        "last_share": stats.get("last_share"),
        "accepted_shares": stats.get("accepted_shares"),
        "rejected_shares": stats.get("rejected_shares"),
        "accepted_work": stats.get("accepted_work"),
        "rejected_work": stats.get("rejected_work"),
        "hash_days": stats.get("delivered_hash_days", stats.get("hash_days", 0)),

        "status": status,
    }



# ============================================================
# RZO WebUI v3.2.0 - öffentliche Bestenliste / Blocktreffer
# Vollständige Wallet-Adressen bleiben serverseitig.
# ============================================================

_RZO_PUBLIC_CACHE_TTL = 20.0
_RZO_PUBLIC_CACHE = {}
_RZO_PUBLIC_CACHE_LOCK = threading.Lock()


# ============================================================
# RZO All-Time Archive v1
#
# Eigenständiger High-Water-Mark für Share Difficulty.
# Das Archiv liegt AUSSERHALB des Webroots, damit vollständige
# Wallet-Adressen niemals als statische Datei ausgeliefert werden.
# ============================================================

_RZO_ALLTIME_PATH = "/home/umbrel/rzo-webui-data/rzo-alltime-best.json"

_RZO_LEGACY_EVENT_PATHS = (
    "/home/umbrel/para-stat-backup-20260820-083030/events.json",
)

_RZO_LIVE_EVENT_PATH = "/home/umbrel/para-data/events.json"

_RZO_ALLTIME_LOCK = threading.Lock()


def _rzo_alltime_number(value: Any) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0

    if number < 0:
        return 0.0

    return number


def _rzo_alltime_empty() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": 0,
        "legacy_imported": False,
        "sources": {},
        "workers": {},
    }


def _rzo_alltime_load_unlocked() -> dict[str, Any]:
    pathlib = __import__("pathlib")
    json_module = __import__("json")

    path = pathlib.Path(_RZO_ALLTIME_PATH)

    if not path.exists():
        return _rzo_alltime_empty()

    try:
        data = json_module.loads(
            path.read_text(encoding="utf-8")
        )
    except Exception as error:
        print(f"RZO All-Time: Archiv konnte nicht gelesen werden: {error}")
        return _rzo_alltime_empty()

    if not isinstance(data, dict):
        return _rzo_alltime_empty()

    if not isinstance(data.get("workers"), dict):
        data["workers"] = {}

    if not isinstance(data.get("sources"), dict):
        data["sources"] = {}

    data.setdefault("version", 1)
    data.setdefault("legacy_imported", False)
    data.setdefault("updated_at", 0)

    return data


def _rzo_alltime_save_unlocked(data: dict[str, Any]) -> None:
    pathlib = __import__("pathlib")
    json_module = __import__("json")

    path = pathlib.Path(_RZO_ALLTIME_PATH)
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    data["version"] = 1
    data["updated_at"] = int(time.time())

    tmp = path.with_name(
        path.name + ".tmp"
    )

    tmp.write_text(
        json_module.dumps(
            data,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    tmp.chmod(0o600)
    tmp.replace(path)
    path.chmod(0o600)


def _rzo_alltime_upsert(
    data: dict[str, Any],
    address: str,
    worker: str,
    best_share: Any,
    *,
    timestamp: Any = None,
    blockheight: Any = None,
    source: str = "",
) -> bool:

    address = str(address or "").strip()
    worker = str(worker or "").strip()
    best = _rzo_alltime_number(best_share)

    if not address or not worker or best <= 0:
        return False

    workers = data.setdefault(
        "workers",
        {},
    )

    by_address = workers.setdefault(
        address,
        {},
    )

    current = by_address.get(worker)

    if isinstance(current, dict):
        current_best = _rzo_alltime_number(
            current.get("best_share")
        )
    else:
        current_best = 0.0

    if best <= current_best:
        return False

    record = {
        "worker": worker,
        "address": address,
        "best_share": best,
        "timestamp": timestamp,
        "blockheight": blockheight,
        "source": source,
    }

    by_address[worker] = record

    return True


def _rzo_alltime_seed_backend_unlocked(
    data: dict[str, Any],
) -> bool:

    changed = False

    try:
        raw_users = backend_json(
            "/api/pool/users"
        )
    except Exception as error:
        print(
            "RZO All-Time: "
            f"Backend-Users nicht erreichbar: {error}"
        )
        return False

    if isinstance(raw_users, dict):
        raw_users = raw_users.get(
            "users",
            [],
        )

    if not isinstance(raw_users, list):
        return False

    for raw_user in raw_users:

        if not isinstance(raw_user, dict):
            continue

        address = str(
            raw_user.get("address")
            or raw_user.get("username")
            or ""
        ).strip()

        if not address:
            continue

        try:
            encoded = urllib.parse.quote(
                address,
                safe="",
            )

            detail = backend_json(
                f"/api/pool/user/{encoded}"
            )

        except Exception:
            continue

        if not isinstance(detail, dict):
            continue

        raw_workers = detail.get(
            "workers",
            [],
        )

        if not isinstance(raw_workers, list):
            continue

        for raw_worker in raw_workers:

            if not isinstance(raw_worker, dict):
                continue

            stats = raw_worker.get("stats")

            if not isinstance(stats, dict):
                stats = {}

            worker = str(
                raw_worker.get("name")
                or raw_worker.get("worker_name")
                or "Miner"
            ).strip()

            best = (
                stats.get("best_share")
                or raw_worker.get("best_share")
                or 0
            )

            if _rzo_alltime_upsert(
                data,
                address,
                worker,
                best,
                source="para-backend",
            ):
                changed = True

    return changed


def _rzo_alltime_scan_file_unlocked(
    data: dict[str, Any],
    filename: str,
    *,
    start_at_eof_if_new: bool,
) -> bool:

    pathlib = __import__("pathlib")
    json_module = __import__("json")

    path = pathlib.Path(filename)

    if not path.exists():
        return False

    changed = False
    stat = path.stat()

    sources = data.setdefault(
        "sources",
        {},
    )

    state = sources.get(filename)

    if not isinstance(state, dict):

        if start_at_eof_if_new:

            sources[filename] = {
                "inode": stat.st_ino,
                "offset": stat.st_size,
                "size": stat.st_size,
            }

            return True

        offset = 0

    else:

        try:
            offset = int(
                state.get("offset")
                or 0
            )
        except (TypeError, ValueError):
            offset = 0

        old_inode = state.get("inode")

        if (
            old_inode != stat.st_ino
            or offset > stat.st_size
        ):
            offset = 0

    with path.open("rb") as handle:

        handle.seek(offset)

        for raw_line in handle:

            if not raw_line.strip():
                continue

            try:
                event = json_module.loads(
                    raw_line
                )
            except Exception:
                continue

            if not isinstance(event, dict):
                continue

            if event.get("type") != "share":
                continue

            if event.get("result") is not True:
                continue

            address = str(
                event.get("address")
                or ""
            ).strip()

            worker = str(
                event.get("workername")
                or event.get("worker_name")
                or ""
            ).strip()

            best = event.get(
                "share_diff"
            )

            if _rzo_alltime_upsert(
                data,
                address,
                worker,
                best,
                timestamp=event.get("timestamp"),
                blockheight=event.get("blockheight"),
                source=filename,
            ):
                changed = True

        new_offset = handle.tell()

    sources[filename] = {
        "inode": stat.st_ino,
        "offset": new_offset,
        "size": stat.st_size,
    }

    return True or changed


def _rzo_alltime_refresh() -> dict[str, Any]:

    with _RZO_ALLTIME_LOCK:

        data = _rzo_alltime_load_unlocked()

        changed = False

        # Aktuellen REDB-/Backend-Stand zuerst übernehmen.
        try:
            if _rzo_alltime_seed_backend_unlocked(
                data
            ):
                changed = True

        except Exception as error:
            print(
                "RZO All-Time: "
                f"Backend-Seed fehlgeschlagen: {error}"
            )

        # Historie vor dem REDB-Neustart genau einmal vollständig
        # aus dem alten Eventlog rekonstruieren.
        if not data.get("legacy_imported"):

            legacy_ok = True

            for filename in _RZO_LEGACY_EVENT_PATHS:

                try:
                    _rzo_alltime_scan_file_unlocked(
                        data,
                        filename,
                        start_at_eof_if_new=False,
                    )

                except Exception as error:
                    legacy_ok = False
                    print(
                        "RZO All-Time: "
                        f"Legacy-Import {filename} "
                        f"fehlgeschlagen: {error}"
                    )

            if legacy_ok:
                data["legacy_imported"] = True
                changed = True

        # Das aktuelle 2-GB-Eventlog muss beim ersten Start NICHT
        # komplett gelesen werden, weil sein bisheriger High-Water-Mark
        # bereits aus dem Backend übernommen wurde.
        #
        # Danach werden nur neu angehängte Bytes ausgewertet.
        try:
            if _rzo_alltime_scan_file_unlocked(
                data,
                _RZO_LIVE_EVENT_PATH,
                start_at_eof_if_new=True,
            ):
                changed = True

        except Exception as error:
            print(
                "RZO All-Time: "
                f"Live-Event-Scan fehlgeschlagen: {error}"
            )

        if changed:
            _rzo_alltime_save_unlocked(
                data
            )

        return data


def _rzo_alltime_worker_record(
    data: dict[str, Any],
    address: str,
    worker: str,
) -> dict[str, Any]:

    workers = data.get(
        "workers",
        {},
    )

    if not isinstance(workers, dict):
        return {}

    by_address = workers.get(
        address,
        {},
    )

    if not isinstance(by_address, dict):
        return {}

    record = by_address.get(
        worker,
        {},
    )

    if not isinstance(record, dict):
        return {}

    return record


def _rzo_alltime_worker_best(
    data: dict[str, Any],
    address: str,
    worker: str,
) -> float:

    return _rzo_alltime_number(
        _rzo_alltime_worker_record(
            data,
            address,
            worker,
        ).get("best_share")
    )




def _rzo_mask_address(value: Any) -> str:
    address = str(value or "").strip()
    if not address:
        return "–"
    if len(address) <= 18:
        return address[:5] + "••••" + address[-4:]
    return address[:10] + "••••••••••" + address[-6:]


def _rzo_public_cached(key: str, builder):
    now = time.time()

    with _RZO_PUBLIC_CACHE_LOCK:
        cached = _RZO_PUBLIC_CACHE.get(key)
        if cached and now - cached[0] < _RZO_PUBLIC_CACHE_TTL:
            return cached[1]

    payload = builder()

    with _RZO_PUBLIC_CACHE_LOCK:
        _RZO_PUBLIC_CACHE[key] = (now, payload)

    return payload


def _rzo_pool_top_shares() -> dict[str, Any]:
    def build():

        archive = _rzo_alltime_refresh()

        workers = archive.get(
            "workers",
            {},
        )

        if not isinstance(workers, dict):
            workers = {}

        rows = []

        for address, by_worker in workers.items():

            if not isinstance(by_worker, dict):
                continue

            for worker_name, record in by_worker.items():

                if not isinstance(record, dict):
                    continue

                best = _rzo_alltime_number(
                    record.get("best_share")
                )

                if best <= 0:
                    continue

                rows.append(
                    {
                        "worker": str(
                            worker_name
                            or "Miner"
                        ),
                        "best_share": best,
                        "address": _rzo_mask_address(
                            address
                        ),
                        "timestamp": record.get(
                            "timestamp"
                        ),
                        "blockheight": record.get(
                            "blockheight"
                        ),
                    }
                )

        rows.sort(
            key=lambda row: float(
                row.get("best_share")
                or 0
            ),
            reverse=True,
        )

        return {
            "scope": "pool",
            "count": min(
                20,
                len(rows),
            ),
            "rows": rows[:20],
            "generated_at": int(
                time.time()
            ),
        }

    return _rzo_public_cached(
        "top-shares",
        build,
    )



# ============================================================
# RZO Pool Status All-Time Overlay v1
#
# Der Para-Backendstatus enthält nur den Bestwert der aktuellen
# REDB-Generation. Für die öffentliche RZO-WebUI wird deshalb
# der dauerhafte All-Time-High-Water-Mark darübergelegt.
# ============================================================

def _rzo_alltime_pool_best(
    archive: dict[str, Any] | None = None,
) -> float:

    if archive is None:
        archive = _rzo_alltime_refresh()

    workers = archive.get("workers", {})

    if not isinstance(workers, dict):
        return 0.0

    best = 0.0

    for by_worker in workers.values():

        if not isinstance(by_worker, dict):
            continue

        for record in by_worker.values():

            if not isinstance(record, dict):
                continue

            value = _rzo_alltime_number(
                record.get("best_share")
            )

            if value > best:
                best = value

    return best


def _rzo_pool_status() -> dict[str, Any]:

    status = backend_json(
        "/api/pool/status"
    )

    if not isinstance(status, dict):
        status = {}

    archive = _rzo_alltime_refresh()

    all_time_best = _rzo_alltime_pool_best(
        archive
    )

    if all_time_best <= 0:
        return status

    # Eigenes explizites Feld für spätere Clients.
    status["all_time_best_share"] = all_time_best

    def overlay(container):

        if not isinstance(container, dict):
            return

        current = _rzo_alltime_number(
            container.get("best_share")
        )

        container["best_share"] = max(
            current,
            all_time_best,
        )

        container["all_time_best_share"] = (
            all_time_best
        )

        for key in (
            "downstream",
            "stats",
            "totals",
        ):
            nested = container.get(key)

            if isinstance(nested, dict):
                overlay(nested)

    overlay(status)

    return status


_RZO_DEVICE_AGENTS_PATH = Path(
    "/home/umbrel/rzo-webui-data/rzo-device-agents.json"
)

_RZO_ALLTIME_PATH = Path(
    "/home/umbrel/rzo-webui-data/rzo-alltime-best.json"
)


def _rzo_safe_float(value: Any) -> float:
    try:
        result = float(value or 0)
    except (TypeError, ValueError):
        return 0.0

    if result < 0:
        return 0.0

    return result


def _rzo_load_device_agents() -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(
            _RZO_DEVICE_AGENTS_PATH.read_text()
        )
    except Exception:
        return {}

    entries = payload.get("entries", {})

    if not isinstance(entries, dict):
        return {}

    result = {}

    for entry in entries.values():
        if not isinstance(entry, dict):
            continue

        address = str(
            entry.get("address") or ""
        ).strip()

        worker = str(
            entry.get("worker") or ""
        ).strip()

        user_agent = str(
            entry.get("user_agent") or ""
        ).strip()

        if not address:
            continue

        result[f"{address}|{worker}"] = {
            "user_agent": user_agent,
            "session_started_at": (
                entry.get("session_started_at")
                or entry.get("last_seen")
            ),
            "last_seen": entry.get("last_seen"),
        }

    return result


def _rzo_alltime_best_lookup():
    exact = {}
    by_worker = {}

    try:
        payload = json.loads(
            _RZO_ALLTIME_PATH.read_text()
        )
    except Exception:
        return exact, by_worker

    def add(address, worker, best):
        address = str(address or "").strip()
        worker = str(worker or "").strip()
        best = _rzo_safe_float(best)

        if not worker or best <= 0:
            return

        if address:
            key = (address, worker)
            exact[key] = max(
                exact.get(key, 0.0),
                best,
            )

        by_worker[worker] = max(
            by_worker.get(worker, 0.0),
            best,
        )

    def walk(value, key_hint=None):
        if isinstance(value, list):
            for item in value:
                walk(item)
            return

        if not isinstance(value, dict):
            return

        hinted_address = ""
        hinted_worker = ""

        if isinstance(key_hint, str) and "|" in key_hint:
            hinted_address, hinted_worker = key_hint.split(
                "|",
                1,
            )

        address = str(
            value.get("address")
            or value.get("wallet")
            or hinted_address
            or ""
        ).strip()

        worker = str(
            value.get("worker")
            or value.get("worker_name")
            or value.get("name")
            or hinted_worker
            or ""
        ).strip()

        username = str(
            value.get("username") or ""
        ).strip()

        if username and "." in username:
            username_address, username_worker = username.split(
                ".",
                1,
            )

            if not address:
                address = username_address.strip()

            if not worker:
                worker = username_worker.strip()

        best = (
            value.get("all_time_best_share")
            or value.get("best_share")
            or value.get("best_difficulty")
            or value.get("difficulty")
            or 0
        )

        add(
            address,
            worker,
            best,
        )

        for child_key, child_value in value.items():
            if isinstance(child_value, (dict, list)):
                walk(
                    child_value,
                    child_key,
                )

    walk(payload)

    return exact, by_worker


def _rzo_worker_device_fallback(worker_name: str):
    value = str(worker_name or "").strip()
    lowered = value.lower().replace(" ", "")

    if "nerdqaxe++" in lowered:
        return "NerdQAxe++"

    if "nerdqaxe+" in lowered:
        return "NerdQAxe+"

    if "nerdoctaxe" in lowered:
        return "NerdOCTAXE"

    if "octaxe" in lowered:
        return "OCTAXE"

    if "nexuss1" in lowered:
        return "Nexus S1"

    if "avalonnano3s" in lowered or "nano3s" in lowered:
        return "Avalon Nano 3S"

    if "avalonq" in lowered:
        return "Avalon Q"

    if (
        "bitaxegamma" in lowered
        or "gamma601" in lowered
        or "gamma602" in lowered
    ):
        return "Bitaxe Gamma"

    if "luckyminer" in lowered or "lv08" in lowered:
        return "LuckyMiner"

    if "whatsminer" in lowered:
        return "Whatsminer"

    if "antminer" in lowered:
        return "Antminer"

    if "bitaxe" in lowered:
        return "Bitaxe"

    if "xminer" in lowered:
        return "xMiner"

    return None


def _rzo_device_type(
    user_agent: str,
    worker_name: str,
):
    raw_agent = str(user_agent or "").strip()
    agent = raw_agent.lower().replace(" ", "")

    if "nerdqaxe++" in agent:
        return "NerdQAxe++", "watcher"

    if "nerdqaxe+" in agent:
        return "NerdQAxe+", "watcher"

    if "nerdoctaxe" in agent:
        return "NerdOCTAXE", "watcher"

    if "octaxe" in agent:
        return "OCTAXE", "watcher"

    if "nexuss1" in agent or "nexus-s1" in agent:
        return "Nexus S1", "watcher"

    if "nano3" in agent:
        return "Avalon Nano 3S", "watcher"

    if "avalonq" in agent:
        return "Avalon Q", "watcher"

    if "avalon" in agent:
        return "Avalon", "watcher"

    if "gamma" in agent:
        return "Bitaxe Gamma", "watcher"

    if "luckyminer" in agent:
        return "LuckyMiner", "watcher"

    if "whatsminer" in agent:
        return "Whatsminer", "watcher"

    if "antminer" in agent:
        return "Antminer", "watcher"

    if "bitaxe" in agent:
        return "Bitaxe", "watcher"

    if "cgminer" in agent:
        return "cgminer", "watcher"

    if "braiins" in agent:
        return "Braiins", "watcher"

    fallback = _rzo_worker_device_fallback(
        worker_name
    )

    if fallback:
        return fallback, "worker-fallback"

    if raw_agent:
        family = re.split(
            r"[/:\s]",
            raw_agent,
            maxsplit=1,
        )[0].strip()

        if family:
            return family[:48], "watcher"

    return "Unbekannt", "unknown"


def _rzo_pool_connected_miners() -> dict[str, Any]:
    def build():
        raw_users = backend_json(
            "/api/pool/users"
        )

        if isinstance(raw_users, dict):
            raw_users = raw_users.get(
                "users",
                [],
            )

        if not isinstance(raw_users, list):
            raw_users = []

        agent_map = _rzo_load_device_agents()

        alltime_exact, alltime_worker = (
            _rzo_alltime_best_lookup()
        )

        grouped = {}

        total_hashrate = 0.0
        total_working = 0

        watcher_identified = 0
        fallback_identified = 0
        unknown = 0

        for raw_user in raw_users:
            if not isinstance(raw_user, dict):
                continue

            address = str(
                raw_user.get("address")
                or raw_user.get("username")
                or ""
            ).strip()

            if not address:
                continue

            try:
                encoded = urllib.parse.quote(
                    address,
                    safe="",
                )

                detail = backend_json(
                    f"/api/pool/user/{encoded}"
                )

            except Exception:
                continue

            if not isinstance(detail, dict):
                continue

            sessions = detail.get(
                "sessions",
                [],
            )

            if not isinstance(sessions, list):
                sessions = []

            for session in sessions:
                if not isinstance(session, dict):
                    continue

                worker = str(
                    session.get("worker_name")
                    or ""
                ).strip()

                stats = session.get("stats")

                if not isinstance(stats, dict):
                    stats = {}

                hashrate = _rzo_safe_float(
                    stats.get("hashrate_5m")
                )

                current_best = _rzo_safe_float(
                    stats.get("best_share")
                )

                stored = agent_map.get(
                    f"{address}|{worker}",
                    {},
                )

                user_agent = str(
                    stored.get("user_agent")
                    or ""
                ).strip()

                device_type, source = (
                    _rzo_device_type(
                        user_agent,
                        worker,
                    )
                )

                # Connected Miners zeigt bewusst nur die
                # aktuelle Best Difficulty der aktiven Session.
                best = current_best

                row = grouped.setdefault(
                    device_type,
                    {
                        "type": device_type,
                        "working": 0,
                        "hashrate_5m": 0.0,
                        "best_share": 0.0,
                        "watcher": 0,
                        "fallback": 0,
                        "unknown": 0,
                    },
                )

                row["working"] += 1
                row["hashrate_5m"] += hashrate
                row["best_share"] = max(
                    row["best_share"],
                    best,
                )

                if source == "watcher":
                    row["watcher"] += 1
                    watcher_identified += 1

                elif source == "worker-fallback":
                    row["fallback"] += 1
                    fallback_identified += 1

                else:
                    row["unknown"] += 1
                    unknown += 1

                total_hashrate += hashrate
                total_working += 1

        rows = list(grouped.values())

        for row in rows:
            row["pool_share_pct"] = (
                row["hashrate_5m"]
                / total_hashrate
                * 100.0
                if total_hashrate > 0
                else 0.0
            )

        rows.sort(
            key=lambda row: (
                -float(row["hashrate_5m"]),
                -int(row["working"]),
                str(row["type"]).lower(),
            )
        )

        return {
            "scope": "pool",
            "working": total_working,
            "type_count": len(rows),
            "hashrate_5m": total_hashrate,
            "watcher_identified": watcher_identified,
            "fallback_identified": fallback_identified,
            "unknown": unknown,
            "rows": rows,
            "updated_at": int(time.time()),
        }

    return _rzo_public_cached(
        "connected-miners",
        build,
    )


def _rzo_pool_blocks() -> dict[str, Any]:
    def build():
        status = backend_json("/api/pool/status")

        if not isinstance(status, dict):
            status = {}

        raw_blocks = status.get("recent_blocks", [])
        if not isinstance(raw_blocks, list):
            raw_blocks = []

        blocks = []

        for raw in raw_blocks:
            if not isinstance(raw, dict):
                continue

            username = str(
                raw.get("username")
                or raw.get("user")
                or raw.get("login")
                or ""
            ).strip()

            address = str(
                raw.get("address")
                or raw.get("btc_address")
                or raw.get("bitcoin_address")
                or raw.get("user_address")
                or ""
            ).strip()

            worker = str(
                raw.get("worker")
                or raw.get("worker_name")
                or raw.get("miner")
                or raw.get("miner_name")
                or ""
            ).strip()

            if username and "." in username:
                left, right = username.split(".", 1)
                if not address and left:
                    address = left
                if not worker and right:
                    worker = right
            elif username and not address:
                address = username

            height = (
                raw.get("height")
                or raw.get("block_height")
                or raw.get("blockHeight")
                or 0
            )

            block_hash = str(
                raw.get("hash")
                or raw.get("block_hash")
                or raw.get("blockHash")
                or ""
            ).strip()

            found_at = (
                raw.get("found_at")
                or raw.get("foundAt")
                or raw.get("timestamp")
                or raw.get("time")
                or raw.get("created_at")
                or raw.get("createdAt")
            )

            share_diff = (
                raw.get("share_difficulty")
                or raw.get("share_diff")
                or raw.get("difficulty")
                or raw.get("best_share")
                or 0
            )

            blocks.append(
                {
                    "height": height,
                    "hash": block_hash,
                    "found_at": found_at,
                    "worker": worker or "Unbekannter Miner",
                    "address": _rzo_mask_address(address),
                    "share_difficulty": share_diff,
                }
            )

        return {
            "block_count": status.get("block_count", len(blocks)),
            "blocks": blocks,
            "generated_at": int(time.time()),
        }

    return _rzo_public_cached("blocks", build)



class RZOHandler(SimpleHTTPRequestHandler):
    server_version = "RZO-WebUI/3.2.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def proxy_json(self, backend_path: str) -> None:
        try:
            payload = backend_json(backend_path)
            self.send_json(200, payload)

        except urllib.error.HTTPError as error:
            self.send_json(
                error.code,
                {
                    "error": "backend_http_error",
                    "status": error.code,
                },
            )

        except urllib.error.URLError:
            self.send_json(
                502,
                {
                    "error": "backend_unavailable",
                    "message": "Der RZO-Pool ist momentan nicht erreichbar.",
                },
            )

        except json.JSONDecodeError:
            self.send_json(
                502,
                {
                    "error": "invalid_backend_response",
                },
            )

        except Exception as error:
            print(f"Proxyfehler: {error}")
            self.send_json(
                500,
                {
                    "error": "internal_proxy_error",
                },
            )

    def handle_my_miners(self, query: dict[str, list[str]]) -> None:
        address = query.get("address", [""])[0].strip()

        if not address:
            self.send_json(
                400,
                {
                    "error": "address_required",
                    "message": "Bitte eine Bitcoin-Adresse eingeben.",
                },
            )
            return

        if len(address) > 100 or not ADDRESS_PATTERN.fullmatch(address):
            self.send_json(
                400,
                {
                    "error": "invalid_address",
                    "message": "Die eingegebene Bitcoin-Adresse ist ungültig.",
                },
            )
            return

        encoded_address = urllib.parse.quote(address, safe="")

        try:
            detail = backend_json(
                f"/api/pool/user/{encoded_address}"
            )

            if not isinstance(detail, dict):
                raise ValueError(
                    "Unerwartete Antwort von /api/pool/user/{address}"
                )

            alltime_archive = _rzo_alltime_refresh()

            raw_workers = detail.get("workers", [])
            raw_sessions = detail.get("sessions", [])

            if not isinstance(raw_workers, list):
                raw_workers = []

            if not isinstance(raw_sessions, list):
                raw_sessions = []

            # Aktuelle Stratum-Sessions vollständig nach Workername
            # gruppieren. Dadurch bleibt die echte Anzahl paralleler
            # Sessions eines Workers erhalten.
            sessions_by_worker = {}

            for session in raw_sessions:
                if not isinstance(session, dict):
                    continue

                worker_name = str(session.get("worker_name") or "").strip()

                if not worker_name:
                    continue

                sessions_by_worker.setdefault(worker_name, []).append(session)

            workers = []

            for raw_worker in raw_workers:
                if not isinstance(raw_worker, dict):
                    continue

                worker = normalize_user_worker(raw_worker)
                worker_name = worker["name"]

                # Historische Werte ausdrücklich erhalten.
                #
                # Der Para-/REDB-Wert wird mit dem unabhängigen
                # RZO High-Water-Mark verglichen. Dadurch bleibt ein
                # älterer Rekord auch nach einem REDB-Neustart erhalten.
                archived_record = _rzo_alltime_worker_record(
                    alltime_archive,
                    address,
                    worker_name,
                )

                backend_all_time_best = _rzo_alltime_number(
                    worker.get("best_share")
                )

                archived_all_time_best = _rzo_alltime_number(
                    archived_record.get("best_share")
                )

                worker["all_time_best_share"] = max(
                    backend_all_time_best,
                    archived_all_time_best,
                )

                worker["all_time_best_timestamp"] = archived_record.get(
                    "timestamp"
                )

                worker["all_time_best_blockheight"] = archived_record.get(
                    "blockheight"
                )
                worker["all_time_accepted_shares"] = worker.get(
                    "accepted_shares"
                )
                worker["all_time_rejected_shares"] = worker.get(
                    "rejected_shares"
                )
                worker["all_time_hash_days"] = worker.get("hash_days")

                worker_sessions = sessions_by_worker.get(worker_name, [])

                # Echte aktuell vorhandene Stratum-Verbindungen dieses Workers.
                worker["session_count"] = len(worker_sessions)
                worker["session_active"] = bool(worker_sessions)

                # Für die bereits bestehende Kartenstatistik verwenden wir
                # weiterhin die Session mit dem neuesten Share. Die Anzahl
                # der Sessions wird davon unabhängig korrekt ausgewiesen.
                session = None

                if worker_sessions:
                    def session_last_share(item):
                        stats = item.get("stats")
                        if not isinstance(stats, dict):
                            return 0
                        try:
                            return int(stats.get("last_share") or 0)
                        except (TypeError, ValueError):
                            return 0

                    session = max(
                        worker_sessions,
                        key=session_last_share,
                    )

                if session is not None:
                    session_stats = session.get("stats")

                    if not isinstance(session_stats, dict):
                        session_stats = {}

                    # Diese Werte sollen in der Minerkarte ausschließlich
                    # die AKTUELLE Stratum-Verbindung darstellen.

                    # Hashrate-Zeiträume der aktuellen Session.
                    worker["hashrate"] = session_stats.get("hashrate_5m", 0)
                    worker["hashrate_1m"] = session_stats.get("hashrate_1m", 0)
                    worker["hashrate_5m"] = session_stats.get("hashrate_5m", 0)
                    worker["hashrate_15m"] = session_stats.get("hashrate_15m", 0)
                    worker["hashrate_1hr"] = session_stats.get("hashrate_1hr", 0)
                    worker["hashrate_6hr"] = session_stats.get("hashrate_6hr", 0)
                    worker["hashrate_1d"] = session_stats.get("hashrate_1d", 0)
                    worker["hashrate_7d"] = session_stats.get("hashrate_7d", 0)

                    # Shares pro Sekunde der aktuellen Session.
                    worker["sps_1m"] = session_stats.get("sps_1m", 0)
                    worker["sps_5m"] = session_stats.get("sps_5m", 0)
                    worker["sps_15m"] = session_stats.get("sps_15m", 0)
                    worker["sps_1hr"] = session_stats.get("sps_1hr", 0)

                    # Share-/Arbeitswerte der aktuellen Session.
                    worker["best_share"] = session_stats.get("best_share", 0)
                    worker["accepted_shares"] = session_stats.get(
                        "accepted_shares", 0
                    )
                    worker["rejected_shares"] = session_stats.get(
                        "rejected_shares", 0
                    )
                    worker["accepted_work"] = session_stats.get(
                        "accepted_work", 0
                    )
                    worker["rejected_work"] = session_stats.get(
                        "rejected_work", 0
                    )
                    worker["hash_days"] = session_stats.get(
                        "delivered_hash_days", 0
                    )
                    worker["session_best_share"] = session_stats.get(
                        "best_share", 0
                    )
                    worker["session_id"] = session.get("id")
                    worker["session_active"] = True

                    device_entry = _rzo_load_device_agents().get(
                        f"{address}|{worker_name}",
                        {},
                    )
                    worker["session_started_at"] = (
                        device_entry.get("session_started_at")
                        or device_entry.get("last_seen")
                    )
                else:
                    # Keine aktive Session:
                    # Keine historischen Share-Zähler als aktuelle Werte
                    # ausgeben.
                    worker["best_share"] = 0
                    worker["accepted_shares"] = 0
                    worker["rejected_shares"] = 0
                    worker["accepted_work"] = 0
                    worker["rejected_work"] = 0
                    worker["hash_days"] = 0
                    worker["session_best_share"] = 0
                    worker["session_id"] = None
                    worker["session_active"] = False
                    worker["session_started_at"] = None

                workers.append(worker)

            # Sortierung weiterhin nach dem historischen Bestwert,
            # damit die Karten beim Miner-Neustart nicht herumspringen.
            workers.sort(
                key=lambda worker: float(
                    worker.get("all_time_best_share") or 0
                ),
                reverse=True,
            )

            # Höchster historischer Share dieser Bitcoin-Adresse.
            # Die Workerwerte wurden bereits mit dem unabhängigen
            # RZO-All-Time-Archiv zusammengeführt.
            personal_all_time_best_share = max(
                (
                    _rzo_alltime_number(
                        worker.get("all_time_best_share")
                    )
                    for worker in workers
                ),
                default=0.0,
            )

            stats = detail.get("stats")

            if not isinstance(stats, dict):
                stats = {}

            response = {
                "pool": {
                    "name": "RZO",
                    "full_name": "RechenZauberOnline",
                },
                "address": detail.get("address", address),
                "authorized_at": detail.get("authorized_at"),
                "worker_count": len(workers),
                "session_count": detail.get("session_count", 0),

                # Die Gesamtansicht verwendet die 5-Minuten-Hashrate.
                "hashrate": stats.get("hashrate_5m", 0),

                "hashrate_1m": stats.get("hashrate_1m"),
                "hashrate_5m": stats.get("hashrate_5m"),
                "hashrate_15m": stats.get("hashrate_15m"),
                "hashrate_1hr": stats.get("hashrate_1hr"),
                "hashrate_6hr": stats.get("hashrate_6hr"),
                "hashrate_1d": stats.get("hashrate_1d"),
                "hashrate_7d": stats.get("hashrate_7d"),

                "sps_1m": stats.get("sps_1m"),
                "sps_5m": stats.get("sps_5m"),
                "sps_15m": stats.get("sps_15m"),
                "sps_1hr": stats.get("sps_1hr"),

                "received_hash_days": stats.get("delivered_hash_days", stats.get("hash_days", 0)),
                "best_share": stats.get("best_share", 0),
                "all_time_best_share": max(
                    _rzo_alltime_number(
                        stats.get("best_share")
                    ),
                    personal_all_time_best_share,
                ),
                "last_share": stats.get("last_share"),

                "accepted_shares": stats.get("accepted_shares", 0),
                "rejected_shares": stats.get("rejected_shares", 0),
                "accepted_work": stats.get("accepted_work", 0),
                "rejected_work": stats.get("rejected_work", 0),

                "workers": workers,
            }

            self.send_json(200, response)

        except urllib.error.HTTPError as error:
            if error.code == 404:
                self.send_json(
                    404,
                    {
                        "error": "address_not_found",
                        "message": (
                            "Für diese Bitcoin-Adresse wurden im RZO-Pool "
                            "keine Miner gefunden."
                        ),
                    },
                )
                return

            self.send_json(
                error.code,
                {
                    "error": "backend_http_error",
                    "status": error.code,
                    "message": (
                        "Die Minerdaten konnten nicht geladen werden."
                    ),
                },
            )

        except urllib.error.URLError:
            self.send_json(
                502,
                {
                    "error": "backend_unavailable",
                    "message": (
                        "Der RZO-Pool ist momentan nicht erreichbar."
                    ),
                },
            )

        except Exception as error:
            print(f"Fehler bei der RZO-Adressabfrage: {error}")

            self.send_json(
                500,
                {
                    "error": "user_lookup_failed",
                    "message": (
                        "Die Minerdaten konnten nicht geladen werden."
                    ),
                },
            )

    def end_headers(self) -> None:
        # UI assets are intentionally not cached. This prevents old miner.html/js
        # versions from surviving upgrades through browser or service-worker caches.
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = urllib.parse.parse_qs(parsed.query)

        # Öffentliche, aggregierte Pooldaten
        if path == "/api/pool/live-counts":
            try:
                users = backend_json("/api/pool/users")

                if not isinstance(users, list):
                    raise ValueError(
                        "Unerwartete Antwort von /api/pool/users"
                    )

                active_users = 0
                active_sessions = 0

                for user in users:
                    if not isinstance(user, dict):
                        continue

                    try:
                        sessions = int(
                            user.get("session_count", 0) or 0
                        )
                    except (TypeError, ValueError):
                        sessions = 0

                    if sessions <= 0:
                        continue

                    active_users += 1
                    active_sessions += sessions

                # In der Live-Anzeige zählen wir ausschließlich
                # tatsächlich verbundene Stratum-Worker.
                # Historische worker_count-Werte werden ignoriert.
                payload = {
                    "active_users": active_users,
                    "active_workers": active_sessions,
                    "active_sessions": active_sessions,
                }

                self.send_json(200, payload)

            except Exception as exc:
                self.send_json(
                    502,
                    {
                        "error": "live_counts_unavailable",
                        "message": str(exc),
                    },
                )

            return

        if path == "/api/pool/top-shares":
            try:
                self.send_json(200, _rzo_pool_top_shares())
            except Exception as error:
                self.send_json(
                    502,
                    {
                        "error": "top_shares_unavailable",
                        "message": str(error),
                    },
                )
            return

        if path == "/api/pool/connected-miners":
            try:
                self.send_json(
                    200,
                    _rzo_pool_connected_miners(),
                )
            except Exception as error:
                self.send_json(
                    502,
                    {
                        "error": "connected_miners_unavailable",
                        "message": str(error),
                    },
                )
            return

        if path == "/api/pool/blocks":
            try:
                self.send_json(200, _rzo_pool_blocks())
            except Exception as error:
                self.send_json(
                    502,
                    {
                        "error": "blocks_unavailable",
                        "message": str(error),
                    },
                )
            return

        if path == "/api/pool/status":
            try:
                self.send_json(
                    200,
                    _rzo_pool_status(),
                )
            except Exception as error:
                self.send_json(
                    502,
                    {
                        "error": "pool_status_unavailable",
                        "message": str(error),
                    },
                )
            return

        if path == "/api/bitcoin/status":
            self.proxy_json("/api/bitcoin/status")
            return

        if path == "/api/system/status":
            self.proxy_json("/api/system/status")
            return

        if path == "/api/node/diagnostics":
            self.send_json(200, node_diagnostics())
            return


        # Persönliche, serverseitig gefilterte Ansicht
        if path == "/api/my-miners":
            self.handle_my_miners(query)
            return

        # Sensible Rohdaten niemals direkt an den Browser ausgeben
        if path in {
            "/api/pool/users",
            "/api/router/status",
            "/api/users",
        }:
            self.send_json(
                403,
                {
                    "error": "endpoint_not_public",
                    "message": "Dieser Endpunkt ist in der RZO-WebUI nicht öffentlich.",
                },
            )
            return

        if path.startswith("/api/"):
            self.send_json(
                404,
                {
                    "error": "api_endpoint_not_found",
                },
            )
            return

        super().do_GET()


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), RZOHandler)

    print()
    print("RZO · RechenZauberOnline")
    print(f"WebUI: http://{HOST}:{PORT}")
    print(f"Backend: {BACKEND_BASE}")
    print("Beenden mit STRG + C")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nRZO-WebUI beendet.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
