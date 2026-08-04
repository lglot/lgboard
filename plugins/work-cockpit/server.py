"""Endpoints for the Work cockpit.

The snapshot is produced on the Mac (home_server/work_cockpit/collector.py) and
pushed here; this plugin only serves the file, so the dashboard never holds a
Jira, Linear or Zammad credential.

The one thing it can do besides reading is ask for a fresh run, and even that
it cannot do directly: the collector lives on the Mac. The request goes out as
an ntfy message that a listener there picks up.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

EMPTY = {"generatedAt": None, "areas": {}, "sessions": [], "sources": {}}
NTFY = "https://ntfy.sh"
RUN_COOLDOWN_S = 60


HEARTBEAT_STALE_S = 240  # the Mac says hello every minute; three misses and it is gone


def register(ctx):
    ctx.add_route("GET", "/api/_p/work-cockpit/snapshot", lambda req: snapshot(ctx))
    ctx.add_route("POST", "/api/_p/work-cockpit/run", lambda req: request_run(ctx))
    ctx.add_route("POST", "/api/_p/work-cockpit/heartbeat", lambda req: heartbeat(ctx))
    ctx._last_run_request = 0.0


def _beat_file(ctx):
    return ctx.config_dir / "data" / "heartbeat.json"


def heartbeat(ctx):
    """The Mac checking in. Without it an old snapshot is ambiguous: the machine
    could be asleep, or awake with a collector that has been failing for hours."""
    path = _beat_file(ctx)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"at": int(time.time() * 1000)}), encoding="utf-8")
    except OSError as exc:
        return 500, {"error": str(exc)}
    return 204, ""


def _host_state(ctx) -> dict:
    try:
        beat = json.loads(_beat_file(ctx).read_text(encoding="utf-8"))
        at = int(beat.get("at") or 0)
    except (OSError, ValueError, TypeError):
        return {"state": "unknown", "at": None}
    silent = time.time() - at / 1000
    return {"state": "up" if silent < HEARTBEAT_STALE_S else "down", "at": at}


def snapshot(ctx):
    path = ctx.config_dir / "data" / "work-cockpit.json"
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        doc = dict(EMPTY, error="Nessuno snapshot: il collector sul Mac non ha ancora pubblicato work-cockpit.json.")
    except (OSError, ValueError) as exc:
        doc = dict(EMPTY, error=f"Snapshot non leggibile: {exc}")
    # collector bookkeeping, not for the UI
    for internal in ("_sig", "_groups", "_details", "_due", "_signals"):
        doc.pop(internal, None)
    doc["serverNow"] = int(time.time() * 1000)
    doc["canRun"] = bool(_topic(ctx))
    doc["collectorHost"] = _host_state(ctx)
    return 200, doc


def _topic(ctx) -> str:
    return (ctx.config or {}).get("runTopic", "")


def request_run(ctx):
    """Publish a run request. The collector may be busy, asleep or the Mac shut:
    this says the message went out, never that a run happened."""
    topic = _topic(ctx)
    if not topic:
        return 501, {"error": "Nessun topic configurato: aggiungi runTopic alla config del plugin."}
    now = time.time()
    if now - getattr(ctx, "_last_run_request", 0) < RUN_COOLDOWN_S:
        return 429, {"error": "Richiesta gia' inviata meno di un minuto fa."}
    request = urllib.request.Request(
        f"{NTFY}/{topic}", data=b"run", method="POST",
        headers={"Title": "work cockpit", "Tags": "arrows_counterclockwise"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except (urllib.error.URLError, OSError) as exc:
        return 502, {"error": f"ntfy non raggiungibile: {exc}"}
    ctx._last_run_request = now
    return 202, {"requested": True,
                 "note": "Richiesta inviata al Mac. Se e' acceso, lo snapshot arriva entro un paio di minuti."}
