"""lgboard — self-hosted dashboard server.

Serves static UI + config + stats + health APIs. Zero runtime dependencies.

Entry point:  python -m server.server
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

from .docker_api import DockerClient
from .health import HealthChecker
from .stats import CPUSampler, NetSampler, read_mem, read_disks, read_uptime, read_cpuinfo, read_temps

PUBLIC = Path(os.environ.get("LGBOARD_PUBLIC", "/app/public"))
CONFIG_DIR = Path(os.environ.get("LGBOARD_CONFIG", "/config"))
PORT = int(os.environ.get("PORT", "8080"))

CONFIG_LOCK = threading.Lock()


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


class State:
    """Shared singletons across handler threads."""

    def __init__(self, cfg: dict):
        stats_cfg = cfg.get("stats", {})
        self.cpu = CPUSampler(stats_cfg.get("hostProc", "/host/proc"))
        self.net = NetSampler(stats_cfg.get("hostProc", "/host/proc"))
        self.docker = DockerClient(stats_cfg.get("dockerSocket", "/var/run/docker.sock"))
        self.host_proc = stats_cfg.get("hostProc", "/host/proc")
        self.host_sys = stats_cfg.get("hostSys", "/host/sys")
        host_root = stats_cfg.get("hostRoot", "/host/root")
        # Back-compat: if no `disks` array given, fall back to single hostRoot.
        self.disks_cfg = stats_cfg.get("disks") or [
            {"id": "rootfs", "label": "rootfs", "path": host_root}
        ]
        hc_cfg = cfg.get("healthcheck", {})
        self.health = HealthChecker(
            get_apps=lambda: load_config().get("apps", []),
            interval=hc_cfg.get("intervalSeconds", 30),
            timeout=hc_cfg.get("timeoutSeconds", 5),
            user_agent=hc_cfg.get("userAgent", "lgboard-health/1.0"),
        )
        if hc_cfg.get("enabled", True):
            self.health.start()


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

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/config.json":
            self._serve_config()
        elif path == "/api/stats":
            self._serve_stats()
        elif path == "/api/health":
            self._serve_health()
        elif path == "/api/health/live":
            self.send_json(200, {"ok": True})
        else:
            super().do_GET()

    def do_POST(self):  # noqa: N802
        if urlparse(self.path).path != "/api/apps":
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

    def do_DELETE(self):  # noqa: N802
        path = urlparse(self.path).path
        prefix = "/api/apps/"
        if not path.startswith(prefix):
            self.send_json(404, {"error": "not found"})
            return
        target = path[len(prefix):]
        with CONFIG_LOCK:
            data = load_config()
            before = len(data.get("apps", []))
            data["apps"] = [a for a in data.get("apps", []) if a.get("id") != target]
            save_config(data)
        self.send_json(200, {"ok": True, "removed": before - len(data["apps"])})

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
        cpu = STATE.cpu.sample()
        mem = read_mem(STATE.host_proc)
        disks = read_disks(STATE.disks_cfg)
        uptime = read_uptime(STATE.host_proc)
        cpuinfo = read_cpuinfo(STATE.host_proc)
        net = STATE.net.sample()
        containers = STATE.docker.containers()
        temps = read_temps(STATE.host_sys)
        payload = {
            "cpu": cpu,
            "cpuInfo": cpuinfo,
            "ram": mem,
            "disks": disks,
            "disk": disks[0] if disks else None,  # legacy single-disk shape
            "uptimeSec": uptime,
            "net": net,
            "containers": containers,
            "temps": temps,
            "timestamp": int(__import__("time").time() * 1000),
        }
        self.send_json(200, payload)

    def _serve_health(self):
        assert STATE is not None
        self.send_json(200, STATE.health.snapshot())


def main() -> None:
    global STATE
    bootstrap_config()
    cfg = load_config()
    STATE = State(cfg)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[lgboard] serving {PUBLIC} on :{PORT}, config={config_path()}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if STATE is not None:
            STATE.health.stop()


if __name__ == "__main__":
    main()
