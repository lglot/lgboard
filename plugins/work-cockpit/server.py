"""Read-only endpoint for the Work cockpit snapshot.

The snapshot is produced on the Mac (home_server/work_cockpit/collector.py) and
pushed here; this plugin only serves the file, so the dashboard never holds a
Jira, Linear or Zammad credential.
"""
from __future__ import annotations

import json
import time

EMPTY = {"generatedAt": None, "areas": {}, "sessions": [], "sources": {}}


def register(ctx):
    ctx.add_route("GET", "/api/_p/work-cockpit/snapshot", lambda req: snapshot(ctx))


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
    return 200, doc
