"""Automations plugin — server side (read-only).

One endpoint:
  GET /api/_p/automations/list  → the collector's automations.json (+ serverNow)

Data is produced out of band by the host-side collector (home_server repo,
automations/collector.py), which also fills each job's `title` + `explanation`
via the llm-gateway once and persists them here. The plugin does NOT call any
LLM at runtime — it just serves the JSON dropped in its config-dir volume:
  /config/plugins/automations/data/automations.json
"""
from __future__ import annotations

import json
import time
from pathlib import Path

_DATA: Path | None = None


def register(ctx):
    global _DATA
    _DATA = ctx.config_dir / "data" / "automations.json"
    ctx.add_route("GET", "/api/_p/automations/list", list_automations)
    ctx.log(f"automations plugin ready (data: {_DATA})")


def list_automations(req):
    try:
        doc = json.loads(_DATA.read_text(encoding="utf-8"))
    except FileNotFoundError:
        doc = {"generatedAt": None, "hosts": {}, "automations": [],
               "error": "nessun dato ancora: il collector non ha prodotto automations.json"}
    except Exception as e:  # noqa: BLE001
        doc = {"generatedAt": None, "hosts": {}, "automations": [], "error": str(e)}
    doc["serverNow"] = int(time.time() * 1000)
    return 200, doc
