"""Endpoints for the Work cockpit.

The snapshot is produced on the Mac (home_server/work_cockpit/collector.py) and
pushed here; this plugin only serves the file, so the dashboard never holds a
Jira or Zammad credential.

The one thing it can do besides reading is ask for a fresh run, and even that
it cannot do directly: the collector lives on the Mac. The request goes out as
an ntfy message that a listener there picks up.

It can also ask for an agent session on a Backlog.md task. Same pattern: the
container cannot reach herdr-core, so it leaves a request file that a systemd
path unit on lgserver picks up (home_server/work_cockpit/launch_agent.sh). The
request carries only the task id and the agent: the prompt is built on the host
from the task itself, so a request cannot inject text.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

EMPTY = {"generatedAt": None, "areas": {}, "sessions": [], "sources": {}}
NTFY = "https://ntfy.sh"
RUN_COOLDOWN_S = 60
LAUNCH_AGENTS = ("claude", "codex", "pi")
LAUNCH_TASK = re.compile(r"^TASK-\d{1,6}$")
LAUNCH_COOLDOWN_S = 10


HEARTBEAT_STALE_S = 240  # the Mac says hello every minute; three misses and it is gone


def register(ctx):
    ctx.add_route("GET", "/api/_p/work-cockpit/snapshot", lambda req: snapshot(ctx))
    ctx.add_route("POST", "/api/_p/work-cockpit/run", lambda req: request_run(ctx))
    ctx.add_route("POST", "/api/_p/work-cockpit/heartbeat", lambda req: heartbeat(ctx))
    ctx.add_route("POST", "/api/_p/work-cockpit/launch", lambda req: request_launch(ctx, req))
    ctx._last_run_request = 0.0
    ctx._last_launch = 0.0


def request_launch(ctx, req):
    """Queue an agent session on a Backlog.md task for the host-side launcher.
    Only through lgser.me: Authelia sets Remote-User. Never through ntfy, unlike
    Run now, because this one starts an agent with shell access."""
    # shortcut: the LAN bind 192.168.1.161:8080 has no auth and a LAN client can
    # forge the header; close it by binding the dashboard to SWAG only.
    if not req.user:
        return 403, {"error": "Avvio agenti solo da lgser.me con login Authelia."}
    body = req.body if isinstance(req.body, dict) else {}
    task, agent = str(body.get("task", "")), str(body.get("agent", ""))
    if not LAUNCH_TASK.match(task) or agent not in LAUNCH_AGENTS:
        return 400, {"error": "Serve un task Backlog.md (TASK-n) e un agente tra claude, codex, pi."}
    now = time.time()
    if now - getattr(ctx, "_last_launch", 0) < LAUNCH_COOLDOWN_S:
        return 429, {"error": "Un avvio e' appena partito, riprova tra qualche secondo."}
    folder = ctx.config_dir / "data" / "launch"
    path = folder / f"{int(now * 1000)}-{task}-{agent}.json"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"task": task, "agent": agent, "by": req.user}), encoding="utf-8")
    except OSError as exc:
        return 500, {"error": f"Richiesta non scrivibile: {exc}"}
    ctx._last_launch = now
    return 202, {"requested": True,
                 "note": f"{agent} su {task}: parte su lgserver in Herdr come terminale "
                         f"{task.lower()}-{agent}-<ora>. Dal telefono: hc attach."}


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
    doc["canRun"] = True   # the request is a file the Mac reads over ssh; ntfy only speeds it up
    doc["collectorHost"] = _host_state(ctx)
    return 200, doc


def _topic(ctx) -> str:
    return (ctx.config or {}).get("runTopic", "")


def request_run(ctx):
    """Leave a run request on both channels. The file is the one that always
    works: the Mac reads it over ssh within a minute. ntfy only makes it fast,
    so it failing costs a wait, not the click."""
    now = time.time()
    if now - getattr(ctx, "_last_run_request", 0) < RUN_COOLDOWN_S:
        return 429, {"error": "Richiesta gia' inviata meno di un minuto fa."}
    stamp = str(int(now * 1000))
    path = ctx.config_dir / "data" / "run-request"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(stamp, encoding="utf-8")
    except OSError as exc:
        return 500, {"error": f"Richiesta non scrivibile: {exc}"}
    ctx._last_run_request = now

    fast = ""
    topic = _topic(ctx)
    if topic:
        request = urllib.request.Request(
            f"{NTFY}/{topic}", data=b"run", method="POST",
            headers={"Title": "work cockpit", "Tags": "arrows_counterclockwise"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                response.read()
            fast = " Dovrebbe partire subito."
        except (urllib.error.URLError, OSError):
            fast = " ntfy non risponde, quindi parte al prossimo giro dell'ascoltatore, entro un minuto."
    host = _host_state(ctx)
    if host["state"] == "down":
        return 202, {"requested": True,
                     "note": "Richiesta registrata, ma il Mac non si fa sentire: partira' quando torna acceso."}
    return 202, {"requested": True, "note": f"Richiesta inviata al Mac.{fast}"}
