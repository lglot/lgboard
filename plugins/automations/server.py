"""Automations plugin — server side.

Two read-only endpoints:
  GET /api/_p/automations/list       → the collector's automations.json (+ serverNow)
  GET /api/_p/automations/explain    → an LLM analyst answer (read-only)

The data is produced OUT of band by a host-side collector (see the home_server
repo, automations/collector.py) and dropped in this plugin's config dir volume:
  /config/plugins/automations/data/automations.json

The LLM is the homelab llm-gateway (OpenAI-compatible, routes to the `claude`
CLI on the Max subscription — zero per-token cost; see wiki homelab/llm-gateway).
The plugin stays lean and provider-agnostic: it just speaks OpenAI chat. If the
gateway URL is unset the explain endpoint reports {available: false} and the UI
hides the button. We never write/modify anything.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs

_CTX = None
_DATA: Path | None = None

# OpenAI-compatible gateway (homelab llm-gateway, tailnet). Model is ignored by
# the gateway (it always routes to the claude CLI) — send a placeholder.
GATEWAY_MODEL = "claude"

SYSTEM_PROMPT = (
    "Sei un analista read-only delle automazioni schedulate di una homelab "
    "(cron, launchd, systemd timer, n8n). Spieghi cosa fa un job, segnali "
    "sovrapposizioni/race tra job e job che falliscono. NON generi, NON "
    "modifichi e NON suggerisci di scrivere cron o comandi. Rispondi in "
    "italiano, conciso, senza preamboli."
)


def register(ctx):
    global _CTX, _DATA
    _CTX = ctx
    _DATA = ctx.config_dir / "data" / "automations.json"
    ctx.add_route("GET", "/api/_p/automations/list", list_automations)
    ctx.add_route("GET", "/api/_p/automations/explain", explain)
    ctx.log(f"automations plugin ready (data: {_DATA})")


def _load() -> dict:
    try:
        return json.loads(_DATA.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"generatedAt": None, "generatedBy": None, "hosts": {}, "automations": [],
                "error": "nessun dato ancora: il collector non ha prodotto automations.json"}
    except Exception as e:  # noqa: BLE001
        return {"generatedAt": None, "hosts": {}, "automations": [], "error": str(e)}


def list_automations(req):
    doc = _load()
    doc["serverNow"] = int(time.time() * 1000)
    return 200, doc


def explain(req):
    base = os.environ.get("LLM_GATEWAY_URL")
    if not base:
        return 200, {"available": False, "reason": "LLM gateway non configurato"}

    q = parse_qs(req.query or "")
    report = (q.get("report") or ["explain"])[0]
    job_id = (q.get("id") or [None])[0]

    doc = _load()
    autos = doc.get("automations", [])
    prompt = _build_prompt(report, job_id, autos)
    if prompt is None:
        return 200, {"available": True, "error": "job non trovato"}

    body = json.dumps({
        "model": GATEWAY_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    headers = {"content-type": "application/json"}
    token = os.environ.get("LLM_GATEWAY_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    rq = urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions", data=body, method="POST", headers=headers,
    )
    try:
        with urllib.request.urlopen(rq, timeout=180) as resp:  # claude -p can take a while
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return 200, {"available": True, "error": f"HTTP {e.code}: {e.read()[:200].decode('utf-8','replace')}"}
    except Exception as e:  # noqa: BLE001
        return 200, {"available": True, "error": str(e)}

    try:
        text = payload["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        text = ""
    return 200, {"available": True, "report": report, "text": text or "(nessuna risposta)"}


def _slim(a: dict) -> dict:
    return {k: a.get(k) for k in
            ("name", "host", "type", "schedule_raw", "schedule_human",
             "command", "last_status", "log_path")}


def _build_prompt(report: str, job_id, autos: list) -> str | None:
    scheduled = [a for a in autos if a.get("category") != "os"]
    if report == "explain":
        job = next((a for a in autos if a.get("id") == job_id), None)
        if not job:
            return None
        return ("Spiega in 2-4 frasi cosa fa questo job schedulato e quando gira:\n"
                + json.dumps(_slim(job), ensure_ascii=False, indent=2))
    if report == "overlap":
        compact = [{"name": a.get("name"), "host": a.get("host"),
                    "schedule": a.get("schedule_raw"), "cmd": (a.get("command") or "")[:80]}
                   for a in scheduled]
        return ("Questi sono i job schedulati della homelab. Individua "
                "sovrapposizioni o race: job che girano nello stesso istante "
                "sullo stesso host e toccano le stesse risorse (file, repo, "
                "servizi). Elenca solo i conflitti reali, con il perche'.\n"
                + json.dumps(compact, ensure_ascii=False, indent=2))
    if report == "failures":
        failing = [_slim(a) for a in autos if a.get("last_status") == "fail"]
        if not failing:
            return "Nessun job risulta in stato 'fail'. Confermalo in una frase."
        return ("Questi job risultano falliti all'ultima esecuzione. Per "
                "ciascuno proponi le cause piu' probabili (in breve).\n"
                + json.dumps(failing, ensure_ascii=False, indent=2))
    return None
