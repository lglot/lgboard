"""Automations plugin: server side.

  GET  /api/_p/automations/list    → the collector's automations.json (+ serverNow)
  GET  /api/_p/automations/paused  → launchd jobs paused on the Mac right now
  POST /api/_p/automations/pause   → {id, paused}: pause or resume a Mac launchd job

The last two proxy the Mac agent (agents/macos-stats), the only place that can
touch launchd. Its URL and token live in /config/plugins/automations/config.json
(macAgentUrl, macAgentToken); without them the switches stay disabled.

Data is produced out of band by the host-side collector (home_server repo,
automations/collector.py), which also fills each job's `title` + `explanation`
via the llm-gateway once and persists them here. The plugin does NOT call any
LLM at runtime — it just serves the JSON dropped in its config-dir volume:
  /config/plugins/automations/data/automations.json
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

_DATA: Path | None = None
_CTX = None
MAC_LAUNCHD_PREFIX = "mac:launchd:"


def register(ctx):
    global _DATA, _CTX
    _CTX = ctx
    _DATA = ctx.config_dir / "data" / "automations.json"
    ctx.add_route("GET", "/api/_p/automations/list", list_automations)
    ctx.add_route("GET", "/api/_p/automations/paused", list_paused)
    ctx.add_route("POST", "/api/_p/automations/pause", set_paused)
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


def _mac_agent(path: str, payload: dict | None = None, timeout: float = 3) -> tuple[int, dict]:
    """Call the Mac agent. Asleep or off is normal, so it comes back as a 502, not an exception."""
    cfg = getattr(_CTX, "config", None) or {}
    url, token = cfg.get("macAgentUrl"), cfg.get("macAgentToken")
    if not url or not token:
        return 503, {"error": "agente Mac non configurato"}
    request = urllib.request.Request(
        url.rstrip("/") + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except ValueError:
            return exc.code, {"error": f"agente Mac: HTTP {exc.code}"}
    except (urllib.error.URLError, OSError, ValueError):
        return 502, {"error": "Mac non raggiungibile"}


def list_paused(req):
    status, body = _mac_agent("/api/automations/paused")
    if status != 200:
        return 200, {"reachable": False, "labels": [], "error": body.get("error")}
    return 200, {"reachable": True, "labels": body.get("labels", [])}


def set_paused(req):
    # A cross-site form can't send this content type without a CORS preflight, which lgboard never grants.
    if not (req.headers.get("Content-Type") or "").startswith("application/json"):
        return 415, {"error": "serve application/json"}
    body = req.body if isinstance(req.body, dict) else {}
    job_id, paused = body.get("id"), body.get("paused")
    if not isinstance(job_id, str) or not job_id.startswith(MAC_LAUNCHD_PREFIX) or not isinstance(paused, bool):
        return 400, {"error": "si possono mettere in pausa solo i job launchd del Mac"}
    # bootout waits for a running job to stop, launchd gives it up to 20s by default.
    return _mac_agent("/api/automations/pause",
                      {"label": job_id[len(MAC_LAUNCHD_PREFIX):], "paused": paused}, timeout=40)
