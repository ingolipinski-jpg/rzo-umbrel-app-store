#!/usr/bin/env python3

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import urlopen
from urllib.error import URLError

WEBUI_BASE = os.getenv("RZO_WEBUI_BASE", "http://webui:2030")

def get_json(path):
    with urlopen(WEBUI_BASE + path, timeout=3) as r:
        return json.loads(r.read().decode("utf-8"))

def format_hashrate(hps):
    try:
        hps = float(hps or 0)
    except Exception:
        hps = 0.0

    if hps >= 1e15:
        return f"{hps / 1e15:.2f}", "PH/s"
    if hps >= 1e12:
        return f"{hps / 1e12:.2f}", "TH/s"
    if hps >= 1e9:
        return f"{hps / 1e9:.2f}", "GH/s"
    if hps >= 1e6:
        return f"{hps / 1e6:.2f}", "MH/s"
    return f"{hps:.0f}", "H/s"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/widget/stats":
            self.send_response(404)
            self.end_headers()
            return

        try:
            status = get_json("/api/pool/status")
            live = get_json("/api/pool/live-counts")
            blocks = get_json("/api/pool/blocks")

            hps = (
                status
                .get("downstream", {})
                .get("stats", {})
                .get("hashrate_5m", 0)
            )

            hr_text, hr_unit = format_hashrate(hps)

            payload = {
                "type": "four-stats",
                "link": "",
                "items": [
                    {
                        "title": "Hashrate",
                        "text": hr_text,
                        "subtext": hr_unit
                    },
                    {
                        "title": "Users",
                        "text": str(live.get("active_users", 0)),
                        "subtext": "active"
                    },
                    {
                        "title": "Workers",
                        "text": str(live.get("active_workers", 0)),
                        "subtext": "active"
                    },
                    {
                        "title": "Blocks",
                        "text": str(blocks.get("block_count", 0)),
                        "subtext": "found"
                    }
                ]
            }

            body = json.dumps(payload).encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        except Exception as e:
            body = json.dumps({
                "type": "four-stats",
                "link": "",
                "items": [
                    {"title": "Hashrate", "text": "-", "subtext": "offline"},
                    {"title": "Users", "text": "-", "subtext": "offline"},
                    {"title": "Workers", "text": "-", "subtext": "offline"},
                    {"title": "Blocks", "text": "-", "subtext": "offline"}
                ],
                "error": str(e)
            }).encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

HTTPServer(("0.0.0.0", 3000), Handler).serve_forever()
