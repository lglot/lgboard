"""SSH plugin — spawn ephemeral ttyd containers that exec into the target.

Lifecycle:
  POST /api/_p/ssh/sessions { container: "sonarr" }
    → docker run -d --rm --network <net> --name lgboard-ttyd-<sid>
                  ttyd:1.7.7 --port 7681 --once -t fontSize=14
                  docker exec -it sonarr sh
    → returns { sid, url }   (url = /_p/ssh/<sid>/, proxied by SWAG to ttyd)
  DELETE /api/_p/ssh/sessions/{sid}
    → docker stop lgboard-ttyd-<sid>; container is auto-removed (--rm)

Hardening:
- Allowlist via plugin config (cfg.allowedContainers / cfg.denyContainers).
- Helper container itself runs the shell *as another container's exec*, so it
  needs access to /var/run/docker.sock. We mount it read-only? No — exec needs
  rw. We accept this risk and lock it to known-good binaries.
- Session TTL auto-kills idle terminals.
- ttyd is started with `--once`: dies on first disconnect.

Routing:
  SWAG must proxy /_p/ssh/<sid>/ → http://lgboard-ttyd-<sid>:7681/. We don't
  modify SWAG conf from here; the user adds a single regex location once.
"""
from __future__ import annotations

import http.client
import json
import secrets
import socket
import threading
import time
from typing import Optional

# This module is imported by the plugin loader, NOT directly by lgboard.
# It expects a PluginContext from server/plugins.py.

CFG_DEFAULTS = {
    "allowedContainers": ["*"],
    "denyContainers": ["dashboard", "swag", "authelia", "cloudflared"],
    "ttydImage": "tsl0922/ttyd:1.7.7",
    "shellCmd": ["sh"],
    "sessionTtlSeconds": 600,
    "network": "home_server_local",
}

_SESSIONS: dict[str, dict] = {}
_LOCK = threading.Lock()
_CTX = None  # PluginContext


def register(ctx):
    global _CTX
    _CTX = ctx
    # merge config defaults
    merged = dict(CFG_DEFAULTS)
    merged.update(ctx.config or {})
    ctx.config = merged

    ctx.add_route("GET",    "/api/_p/ssh/sessions",          list_sessions)
    ctx.add_route("POST",   "/api/_p/ssh/sessions",          create_session)
    ctx.add_route("DELETE", "/api/_p/ssh/sessions/{sid}",    destroy_session)
    ctx.on_shutdown(_cleanup_all)
    # Periodic GC for TTL-expired sessions.
    threading.Thread(target=_gc_loop, name="ssh-plugin-gc", daemon=True).start()
    ctx.log("SSH plugin ready")


# ---- handlers ----

def list_sessions(req):
    with _LOCK:
        items = [
            {"sid": sid, **{k: v for k, v in s.items() if k != "_internal"}}
            for sid, s in _SESSIONS.items()
        ]
    return 200, items


def create_session(req):
    body = req.body if isinstance(req.body, dict) else {}
    target = body.get("container")
    if not target or not isinstance(target, str):
        return 400, {"error": "container is required"}
    cfg = _CTX.config
    if target in cfg.get("denyContainers", []):
        return 403, {"error": f"container {target} is denylisted"}
    allow = cfg.get("allowedContainers") or ["*"]
    if "*" not in allow and target not in allow:
        return 403, {"error": f"container {target} not in allowlist"}
    if not _container_exists(target):
        return 404, {"error": f"container {target} not found or not running"}

    sid = secrets.token_urlsafe(8)
    helper_name = f"lgboard-ttyd-{sid}"
    image = cfg["ttydImage"]
    shell_cmd = cfg["shellCmd"]
    network = cfg["network"]
    # Build cmd: ttyd ... docker exec -it <target> <shell_cmd>
    cmd = [
        "--port", "7681",
        "--once",
        "--writable",
        "-t", "fontSize=14",
        "-t", "theme={\"background\":\"#1a1d2c\"}",
        "docker", "exec", "-it", target, *shell_cmd,
    ]
    started = _spawn_ttyd(helper_name, image, network, cmd)
    if started.get("error"):
        return 500, started
    record = {
        "sid": sid,
        "container": target,
        "helper": helper_name,
        "createdAt": int(time.time()),
        "expiresAt": int(time.time()) + int(cfg["sessionTtlSeconds"]),
        "url": f"/_p/ssh/{sid}/",
    }
    with _LOCK:
        _SESSIONS[sid] = record
    return 200, record


def destroy_session(req):
    sid = req.path_params.get("sid")
    if not sid:
        return 400, {"error": "missing sid"}
    with _LOCK:
        rec = _SESSIONS.pop(sid, None)
    if rec is None:
        return 404, {"error": "session not found"}
    _kill_helper(rec["helper"])
    return 200, {"ok": True, "sid": sid}


# ---- docker primitives over the unix socket ----

def _docker_request(method: str, path: str, body: Optional[dict] = None) -> tuple[int, Optional[dict]]:
    sock_path = "/var/run/docker.sock"
    payload = json.dumps(body).encode() if body is not None else b""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5.0)
        s.connect(sock_path)
        conn = http.client.HTTPConnection("localhost")
        conn.sock = s
        headers = {"Host": "localhost", "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(payload))
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
    except (FileNotFoundError, ConnectionRefusedError, OSError) as e:
        return 0, {"error": f"docker socket: {e}"}
    if not raw:
        return resp.status, None
    try:
        return resp.status, json.loads(raw)
    except json.JSONDecodeError:
        return resp.status, {"raw": raw[:200].decode("utf-8", errors="replace")}


def _container_exists(name: str) -> bool:
    code, data = _docker_request("GET", f"/containers/{name}/json")
    if code != 200 or not isinstance(data, dict):
        return False
    state = (data.get("State") or {}).get("Status")
    return state == "running"


def _spawn_ttyd(name: str, image: str, network: str, cmd: list[str]) -> dict:
    create_body = {
        "Image": image,
        "Cmd": cmd,
        "Tty": True,
        "OpenStdin": False,
        "HostConfig": {
            "NetworkMode": network,
            "AutoRemove": True,
            "Binds": ["/var/run/docker.sock:/var/run/docker.sock"],
        },
        "Labels": {"lgboard.plugin": "ssh"},
    }
    code, data = _docker_request("POST", f"/containers/create?name={name}", create_body)
    if code not in (200, 201):
        return {"error": f"create failed ({code})", "data": data}
    cid = (data or {}).get("Id")
    if not cid:
        return {"error": "no container id"}
    code, _ = _docker_request("POST", f"/containers/{cid}/start")
    if code not in (204, 200):
        return {"error": f"start failed ({code})"}
    return {"ok": True, "id": cid, "name": name}


def _kill_helper(name: str) -> None:
    _docker_request("POST", f"/containers/{name}/stop?t=2")
    # AutoRemove handles deletion.


def _cleanup_all():
    with _LOCK:
        names = [s["helper"] for s in _SESSIONS.values()]
        _SESSIONS.clear()
    for n in names:
        _kill_helper(n)


def _gc_loop():
    while True:
        time.sleep(30)
        now = int(time.time())
        expired: list[str] = []
        with _LOCK:
            for sid, rec in list(_SESSIONS.items()):
                if rec["expiresAt"] < now:
                    expired.append(sid)
                    _SESSIONS.pop(sid, None)
        for sid in expired:
            _kill_helper(f"lgboard-ttyd-{sid}")
