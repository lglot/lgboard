"""lgboard — self-hosted dashboard server.

Serves static UI + config + stats + health APIs. Zero runtime dependencies.

Entry point:  python -m server.server
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from .discovery import Discovery
from .docker_api import DockerClient
from .health import HealthChecker
from .plugins import HOST as PLUGIN_HOST, PluginRequest
from .remote_poller import RemoteStatsPoller
from .stats import CPUSampler, NetSampler, read_mem, read_disks, read_uptime, read_cpuinfo, read_temps

PUBLIC = Path(os.environ.get("LGBOARD_PUBLIC", "/app/public"))
CONFIG_DIR = Path(os.environ.get("LGBOARD_CONFIG", "/config"))
PORT = int(os.environ.get("PORT", "8080"))

# Asset version stamp — appended as ?v=<VER> on style.css / *.jsx in index.html.
# Bumps every container start, defeats edge caches (Cloudflare, SWAG, browser).
ASSET_VER = os.environ.get("LGBOARD_VERSION") or str(int(time.time()))
_INDEX_BUST_RE = re.compile(r'(href|src)="(style\.css|icons\.jsx|themes\.jsx|components\.jsx)"')

CONFIG_LOCK = threading.Lock()

_REGISTRY_CACHE = None
_REGISTRY_CACHE_AT = 0.0


def config_path() -> Path:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return CONFIG_DIR / "config.json"


def bootstrap_config() -> None:
    target = config_path()
    if target.exists():
        return
    seed = PUBLIC / "config.example.json"
    if not seed.exists():
        return
    shutil.copyfile(seed, target)
    print(f"[bootstrap] seeded {target} from {seed}", flush=True)


def load_config() -> dict:
    path = config_path()
    if not path.exists():
        path = PUBLIC / "config.example.json"
    with path.open() as f:
        return json.load(f)


def save_config(data: dict) -> None:
    path = config_path()
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


def _aggregate_hosts(hosts: list[dict]) -> dict:
    """Roll up the per-host stats into fleet-wide totals."""
    total_cpu = 0.0
    ram_used = 0.0
    disk_used = 0.0
    total_containers = 0
    running_containers = 0
    hosts_up = 0
    hosts_down = 0
    for h in hosts:
        status = h.get("status")
        if status == "up":
            hosts_up += 1
        elif status == "down":
            hosts_down += 1
        # "stale" counts as neither (degraded, data still shown).
        cpu = h.get("cpu")
        if isinstance(cpu, (int, float)):
            total_cpu += cpu
        ram = h.get("ram")
        if isinstance(ram, dict) and isinstance(ram.get("usedGb"), (int, float)):
            ram_used += ram["usedGb"]
        for d in (h.get("disks") or []):
            used = d.get("usedBytes") if isinstance(d, dict) else None
            if isinstance(used, (int, float)):
                disk_used += used / 1e9
        containers = h.get("containers")
        if isinstance(containers, dict):
            total_containers += containers.get("total") or 0
            running_containers += containers.get("running") or 0
    return {
        "totalCpuPercent": round(total_cpu, 1),
        "totalRamUsedGb": round(ram_used, 2),
        "totalDiskUsedGb": round(disk_used, 2),
        "totalContainers": total_containers,
        "runningContainers": running_containers,
        "hostsUp": hosts_up,
        "hostsDown": hosts_down,
    }


class State:
    """Shared singletons across handler threads."""

    def __init__(self, cfg: dict):
        stats_cfg = cfg.get("stats", {})
        self.agent_mode = bool(stats_cfg.get("agentMode"))
        self.cpu = CPUSampler(stats_cfg.get("hostProc", "/host/proc"))
        self.net = NetSampler(stats_cfg.get("hostProc", "/host/proc"))
        self.docker = DockerClient(stats_cfg.get("dockerSocket", "/var/run/docker.sock"))
        self.discovery = Discovery(self.docker)
        self.host_proc = stats_cfg.get("hostProc", "/host/proc")
        self.host_sys = stats_cfg.get("hostSys", "/host/sys")
        host_root = stats_cfg.get("hostRoot", "/host/root")
        # Back-compat: if no `disks` array given, fall back to single hostRoot.
        self.disks_cfg = stats_cfg.get("disks") or [
            {"id": "rootfs", "label": "rootfs", "path": host_root}
        ]
        # Display name for this node in the multi-host (?all=true) view.
        self.local_name = (
            stats_cfg.get("localName")
            or cfg.get("branding", {}).get("subtitle")
            or socket.gethostname()
        )
        hc_cfg = cfg.get("healthcheck", {})
        user_agent = hc_cfg.get("userAgent", "lgboard-health/1.0")

        def get_apps_with_discovery():
            apps = load_config().get("apps", [])
            # Augment apps with discovery hints the health checker uses to pick a
            # probe strategy: a reverse-proxy-bypassing internalUrl, plus the
            # matched container's presence/state.
            out = []
            for a in apps:
                if not isinstance(a, dict):
                    out.append(a)
                    continue
                a2 = dict(a)
                rec = self.discovery.lookup(a2)
                if rec is not None:
                    a2["_containerMatched"] = True
                    a2["_containerState"] = rec.get("state")
                # Auto-discover an internalUrl whenever no explicit healthUrl is
                # set. A manually-configured public `url` must NOT block this:
                # probing the public URL traverses Authelia and yields ambiguous
                # 302s. An explicit internalUrl is preserved (never overwritten).
                if not a2.get("healthUrl") and not a2.get("internalUrl"):
                    discovered = self.discovery.internal_url(a2)
                    if discovered:
                        a2["internalUrl"] = discovered
                        a2["_discovered"] = True
                out.append(a2)
            return out

        self.health = HealthChecker(
            get_apps=get_apps_with_discovery,
            interval=hc_cfg.get("intervalSeconds", 30),
            timeout=hc_cfg.get("timeoutSeconds", 5),
            user_agent=user_agent,
        )

        # Multi-host stats: poll remote agents over the tailnet. Skipped in agent
        # mode (a leaf node is polled, it doesn't poll others).
        self.remote_poller: RemoteStatsPoller | None = None
        remote_hosts = stats_cfg.get("remoteHosts") or []
        if remote_hosts and not self.agent_mode:
            self.remote_poller = RemoteStatsPoller(
                hosts=remote_hosts,
                interval=stats_cfg.get("remotePollSeconds", 5),
                timeout=stats_cfg.get("remoteTimeoutSeconds", 4),
                stale_after=stats_cfg.get("remoteStaleSeconds", 20),
                user_agent=user_agent,
            )
            self.remote_poller.start()

        if not self.agent_mode and hc_cfg.get("enabled", True):
            self.health.start()

    def stop(self) -> None:
        self.health.stop()
        if self.remote_poller is not None:
            self.remote_poller.stop()

    # --- stats builders (shared by single-host + multi-host endpoints) ---

    def build_local_stats(self) -> dict:
        """The single-host /api/stats payload (backward-compatible shape)."""
        disks = read_disks(self.disks_cfg)
        return {
            "cpu": self.cpu.sample(),
            "cpuInfo": read_cpuinfo(self.host_proc),
            "ram": read_mem(self.host_proc),
            "disks": disks,
            "disk": disks[0] if disks else None,  # legacy single-disk shape
            "uptimeSec": read_uptime(self.host_proc),
            "net": self.net.sample(),
            "containers": self.docker.containers(),
            "temps": read_temps(self.host_sys),
            "timestamp": int(time.time() * 1000),
        }

    def build_all_stats(self) -> dict:
        """Aggregated local + remote payload for /api/stats?all=true."""
        local = self.build_local_stats()
        local_host = {"id": "local", "name": self.local_name, "isLocal": True, "status": "up"}
        for k in ("cpu", "cpuInfo", "ram", "disks", "disk", "net", "uptimeSec", "temps", "containers"):
            local_host[k] = local.get(k)
        hosts = [local_host]
        if self.remote_poller is not None:
            hosts.extend(self.remote_poller.hosts_snapshot())
        return {
            "allMode": True,
            "timestamp": int(time.time() * 1000),
            "hosts": hosts,
            "stats": _aggregate_hosts(hosts),
        }


STATE: State | None = None


_NO_CACHE_EXT = (".html", ".css", ".js", ".jsx", ".json")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        # Force browsers (and any reverse proxy honoring origin headers) to
        # revalidate text assets so deploy bumps land on the next page view.
        path = urlparse(self.path).path
        if path == "/" or path.endswith(_NO_CACHE_EXT):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def send_json(self, code: int, payload) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _agent_blocked(self) -> bool:
        """In agent mode only /api/stats (+ liveness) are served; gate the rest."""
        return STATE is not None and STATE.agent_mode

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if self._agent_blocked():
            if path == "/api/stats":
                self._serve_stats()
            elif path == "/api/health/live":
                self.send_json(200, {"ok": True})
            else:
                self.send_json(404, {"error": "agent mode: only /api/stats is served"})
            return
        if path == "/config.json":
            self._serve_config()
        elif path == "/api/stats":
            self._serve_stats()
        elif path == "/api/health":
            self._serve_health()
        elif path == "/api/discovery":
            self._serve_discovery()
        elif path == "/api/plugins":
            self.send_json(200, PLUGIN_HOST.list_manifests())
        elif path == "/api/plugins/registry":
            self._serve_plugin_registry()
        elif path == "/api/health/live":
            self.send_json(200, {"ok": True})
        elif path.startswith("/_p/") and self._serve_plugin_static(path):
            return
        elif path in ("/", "/index.html"):
            self._serve_index()
        elif self._maybe_dispatch_plugin("GET", path):
            return
        else:
            super().do_GET()

    def _serve_plugin_static(self, path: str) -> bool:
        # /_p/<id>/<file>  → reads from /app/plugins/<id>/<file> or /config/plugins/<id>/<file>
        parts = path.split("/", 3)
        if len(parts) < 4:
            return False
        plugin_id, rel = parts[2], parts[3]
        if not plugin_id or "/" in rel.split("?", 1)[0].lstrip("/") and ".." in rel:
            return False
        rel = rel.split("?", 1)[0]
        if ".." in rel.split("/"):
            self.send_json(403, {"error": "path escape"})
            return True
        from .plugins import CORE_DIR, USER_DIR  # local import to avoid cycles
        for base in (USER_DIR, CORE_DIR):
            candidate = (base / plugin_id / rel).resolve()
            if not str(candidate).startswith(str((base / plugin_id).resolve())):
                continue
            if candidate.is_file():
                ctype = "application/javascript" if rel.endswith((".js", ".jsx")) else "text/plain; charset=utf-8"
                if rel.endswith(".css"):
                    ctype = "text/css"
                if rel.endswith(".json"):
                    ctype = "application/json"
                if rel.endswith(".html"):
                    ctype = "text/html; charset=utf-8"
                body = candidate.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache, must-revalidate")
                self.end_headers()
                self.wfile.write(body)
                return True
        self.send_json(404, {"error": f"plugin asset {path} not found"})
        return True

    def _maybe_dispatch_plugin(self, method: str, path: str) -> bool:
        match = PLUGIN_HOST.find_route(method, path)
        if not match:
            return False
        handler, path_params, plugin_id = match
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                body = raw  # let handler decide
            req = PluginRequest(
                method=method,
                path=path,
                path_params=path_params,
                query=urlparse(self.path).query,
                body=body,
                headers=dict(self.headers.items()),
                user=self.headers.get("Remote-User") or self.headers.get("X-Forwarded-User"),
            )
            result = handler(req)
            if isinstance(result, tuple) and len(result) == 2:
                code, payload = result
            else:
                code, payload = 200, result
            self.send_json(code, payload)
        except Exception as e:
            self.send_json(500, {"error": f"plugin {plugin_id} failed: {e}"})
        return True

    def _serve_plugin_registry(self):
        # Proxy a community-curated index. Cached per-process for 1h.
        # The registry repo is just a JSON list — anyone can PR new entries.
        global _REGISTRY_CACHE, _REGISTRY_CACHE_AT
        import time as _t
        if _REGISTRY_CACHE and (_t.time() - _REGISTRY_CACHE_AT < 3600):
            self.send_json(200, _REGISTRY_CACHE)
            return
        url = "https://raw.githubusercontent.com/lglot/lgboard-plugins-registry/main/index.json"
        try:
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "lgboard-registry/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw = resp.read()
            data = json.loads(raw)
            _REGISTRY_CACHE = data
            _REGISTRY_CACHE_AT = _t.time()
            self.send_json(200, data)
        except Exception as e:
            self.send_json(200, {"items": [], "error": str(e)})

    def _serve_discovery(self):
        assert STATE is not None
        cfg = load_config()
        out = {}
        for a in cfg.get("apps", []):
            if not isinstance(a, dict) or not a.get("id"):
                continue
            rec = STATE.discovery.lookup(a)
            internal = STATE.discovery.internal_url(a) if rec else None
            out[a["id"]] = {
                "container": rec["name"] if rec else None,
                "containerState": rec.get("state") if rec else None,
                "ports": rec.get("ports") if rec else [],
                "internalUrl": internal,
                "isDocker": rec is not None,
            }
        self.send_json(200, out)

    def _serve_index(self):
        try:
            html = (PUBLIC / "index.html").read_text(encoding="utf-8")
        except OSError as e:
            self.send_json(500, {"error": str(e)})
            return
        html = _INDEX_BUST_RE.sub(
            lambda m: f'{m.group(1)}="{m.group(2)}?v={ASSET_VER}"', html
        )
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        if self._agent_blocked():
            self.send_json(404, {"error": "agent mode: only /api/stats is served"})
            return
        path = urlparse(self.path).path
        if path != "/api/apps":
            if self._maybe_dispatch_plugin("POST", path):
                return
            self.send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError as e:
            self.send_json(400, {"error": f"invalid json: {e}"})
            return
        if not isinstance(entry, dict) or not entry.get("name"):
            self.send_json(400, {"error": "entry must be an object with a name"})
            return
        with CONFIG_LOCK:
            data = load_config()
            apps = data.setdefault("apps", [])
            entry_id = entry.get("id") or entry["name"].lower().replace(" ", "-")
            entry["id"] = entry_id
            apps = [a for a in apps if a.get("id") != entry_id]
            apps.append(entry)
            data["apps"] = apps
            save_config(data)
        self.send_json(200, {"ok": True, "id": entry_id})

    def do_PATCH(self):  # noqa: N802
        if self._agent_blocked():
            self.send_json(404, {"error": "agent mode: only /api/stats is served"})
            return
        path = urlparse(self.path).path
        prefix = "/api/apps/"
        if not path.startswith(prefix):
            self.send_json(404, {"error": "not found"})
            return
        target = path[len(prefix):]
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            patch = json.loads(raw)
        except json.JSONDecodeError as e:
            self.send_json(400, {"error": f"invalid json: {e}"})
            return
        if not isinstance(patch, dict):
            self.send_json(400, {"error": "patch must be an object"})
            return
        # Whitelist of patchable fields (avoid letting clients rewrite url, healthcheck, etc.
        # without thinking — anything below is safe-by-policy: presentation/pin metadata).
        allowed = {"fav", "target", "desc", "icon", "iconSvgPath", "containerName"}
        with CONFIG_LOCK:
            data = load_config()
            apps = data.get("apps", [])
            entry = next((a for a in apps if a.get("id") == target), None)
            if entry is None:
                self.send_json(404, {"error": "app not found"})
                return
            for k, v in patch.items():
                if k not in allowed:
                    continue
                if v is None or v is False:
                    entry.pop(k, None)
                else:
                    entry[k] = v
            save_config(data)
        self.send_json(200, {"ok": True, "id": target, "fav": entry.get("fav", False)})

    def do_DELETE(self):  # noqa: N802
        if self._agent_blocked():
            self.send_json(404, {"error": "agent mode: only /api/stats is served"})
            return
        path = urlparse(self.path).path
        prefix = "/api/apps/"
        if path.startswith(prefix):
            target = path[len(prefix):]
            with CONFIG_LOCK:
                data = load_config()
                before = len(data.get("apps", []))
                data["apps"] = [a for a in data.get("apps", []) if a.get("id") != target]
                save_config(data)
            self.send_json(200, {"ok": True, "removed": before - len(data["apps"])})
            return
        if self._maybe_dispatch_plugin("DELETE", path):
            return
        self.send_json(404, {"error": "not found"})

    # --- routes ---

    def _serve_config(self):
        try:
            with CONFIG_LOCK:
                data = load_config()
            self.send_json(200, data)
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def _serve_stats(self):
        assert STATE is not None
        params = parse_qs(urlparse(self.path).query)
        want_all = (params.get("all", ["false"])[0] or "").lower() in ("1", "true", "yes")
        # Multi-host aggregation is only meaningful on a non-agent node.
        if want_all and not STATE.agent_mode:
            self.send_json(200, STATE.build_all_stats())
            return
        self.send_json(200, STATE.build_local_stats())

    def _serve_health(self):
        assert STATE is not None
        self.send_json(200, STATE.health.snapshot())


def main() -> None:
    global STATE
    # Read config first so agent mode can short-circuit the bootstrap. In agent
    # mode the node is a stats-only leaf: no UI seed, no plugins, no health.
    cfg = load_config()
    agent_mode = bool(cfg.get("stats", {}).get("agentMode"))
    if not agent_mode:
        bootstrap_config()
        cfg = load_config()
    STATE = State(cfg)
    if not agent_mode:
        PLUGIN_HOST.attach(STATE.docker, STATE.discovery)
        PLUGIN_HOST.load_all()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    if agent_mode:
        print(f"[lgboard] agent mode: serving /api/stats only on :{PORT}", flush=True)
    else:
        print(f"[lgboard] serving {PUBLIC} on :{PORT}, config={config_path()}", flush=True)
        print(f"[lgboard] plugins loaded: {[m['id'] for m in PLUGIN_HOST.list_manifests()]}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if not agent_mode:
            PLUGIN_HOST.shutdown()
        if STATE is not None:
            STATE.stop()


if __name__ == "__main__":
    main()
