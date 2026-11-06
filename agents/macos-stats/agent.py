#!/usr/bin/env python3
"""lgboard macOS stats agent — serves the single-host /api/stats payload from
native macOS metrics, so a Mac can show up as a host in lgboard's multi-host view.

lgboard's own server reads Linux /proc, which doesn't exist on macOS; this shim
fills the same JSON contract (cpu, cpuInfo, ram, disks, disk, net, uptimeSec,
temps, containers) using top/vm_stat/df/sysctl/netstat (+ docker ps best-effort).

Run:  python3 mac-stats-agent.py            # serves on :8077
Env:  PORT (default 8077), LGBOARD_MAC_NAME (default hostname), DATA_VOLUME
"""
from __future__ import annotations
import hmac, json, os, re, socket, subprocess, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = int(os.environ.get("PORT", "8077"))
BIND = os.environ.get("BIND", "0.0.0.0")  # set 127.0.0.1 when fronted by `tailscale serve`
NAME = os.environ.get("LGBOARD_MAC_NAME") or socket.gethostname().split(".")[0]
DATA_VOLUME = os.environ.get("DATA_VOLUME", "/System/Volumes/Data")
SAMPLE_SEC = 3.0
TOKEN_FILE = Path(os.environ.get("LGBOARD_AGENT_TOKEN_FILE") or Path.home() / ".config/lgboard/agent-token")
LAUNCH_AGENTS = Path.home() / "Library/LaunchAgents"
LAUNCHD_DOMAIN = f"gui/{os.getuid()}"
# Only the user's own scheduled jobs: this agent is com.lglot.*, so the switch can't cut its own channel.
PAUSABLE_LABEL = re.compile(r"com\.luigi\.[\w.-]+")

_snapshot: dict = {}
_lock = threading.Lock()


def _sh(cmd: list[str], timeout: float = 6.0) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def _sysctl(key: str) -> str:
    return _sh(["sysctl", "-n", key]).strip()


def read_cpu() -> float | None:
    # `top -l 2` — the SECOND sample is interval-based (the first is since-boot).
    out = _sh(["top", "-l", "2", "-n", "0", "-s", "1"], timeout=8.0)
    matches = re.findall(r"CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle", out)
    if not matches:
        return None
    user, sys_, idle = (float(x) for x in matches[-1])
    return round(max(0.0, min(100.0, 100.0 - idle)), 1)


def read_cpuinfo() -> dict:
    cores = _sysctl("hw.ncpu")
    freq = _sysctl("hw.cpufrequency")  # Hz on Intel, empty on Apple Silicon
    ghz = round(int(freq) / 1e9, 1) if freq.isdigit() and int(freq) > 0 else None
    return {"cores": int(cores) if cores.isdigit() else None, "ghz": ghz}


def read_mem() -> dict | None:
    total = _sysctl("hw.memsize")
    if not total.isdigit():
        return None
    total = int(total)
    out = _sh(["vm_stat"])
    page = 4096
    m = re.search(r"page size of (\d+) bytes", out)
    if m:
        page = int(m.group(1))
    def pages(label):
        mm = re.search(rf"{re.escape(label)}:\s+(\d+)\.", out)
        return int(mm.group(1)) if mm else 0
    used_pages = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")
    used = used_pages * page
    used = min(used, total)
    pct = round(used / total * 100) if total else 0
    return {"usedBytes": used, "totalBytes": total, "pct": pct,
            "usedGb": round(used / 1e9, 2), "totalGb": round(total / 1e9, 2)}


def read_disks() -> list[dict]:
    out = _sh(["df", "-k", DATA_VOLUME])
    lines = out.strip().splitlines()
    if len(lines) < 2:
        return []
    f = lines[1].split()
    try:
        used = int(f[2]) * 1024
        avail = int(f[3]) * 1024
        total = used + avail
        pct = round(used / total * 100) if total else 0
        return [{"id": "rootfs", "label": "Macintosh HD", "usedBytes": used, "totalBytes": total, "pct": pct}]
    except (IndexError, ValueError):
        return []


def read_uptime() -> int | None:
    bt = _sysctl("kern.boottime")
    m = re.search(r"sec\s*=\s*(\d+)", bt)
    return int(time.time()) - int(m.group(1)) if m else None


_net_prev = {"t": None, "rx": 0, "tx": 0}
def read_net() -> dict | None:
    out = _sh(["netstat", "-ib"])
    rx = tx = 0
    seen = set()
    for line in out.splitlines()[1:]:
        c = line.split()
        if len(c) < 11 or c[0] in seen or c[0] == "lo0" or c[0].startswith("lo"):
            continue
        # only count physical-ish ifaces that have a Link# / MAC row (avoid dup per-addr rows)
        if "Link#" not in line and ":" not in c[3]:
            continue
        try:
            ibytes, obytes = int(c[6]), int(c[9])
        except (ValueError, IndexError):
            continue
        seen.add(c[0]); rx += ibytes; tx += obytes
    now = time.time()
    prev = _net_prev
    res = {"downMBs": 0.0, "upMBs": 0.0}
    if prev["t"] is not None:
        dt = now - prev["t"]
        if dt > 0:
            res = {"downMBs": round(max(0, rx - prev["rx"]) / dt / 1e6, 1),
                   "upMBs": round(max(0, tx - prev["tx"]) / dt / 1e6, 1)}
    _net_prev.update({"t": now, "rx": rx, "tx": tx})
    return res


def read_containers() -> dict | None:
    out = _sh(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Image}}"], timeout=4.0)
    if not out.strip():
        return None
    items, running = [], 0
    for line in out.strip().splitlines():
        p = line.split("\t")
        if not p or not p[0]:
            continue
        state = p[1] if len(p) > 1 else "unknown"
        if state == "running":
            running += 1
        items.append({"name": p[0], "state": state, "image": p[2] if len(p) > 2 else ""})
    return {"running": running, "total": len(items), "items": items}


def sample() -> dict:
    disks = read_disks()
    return {
        "cpu": read_cpu(),
        "cpuInfo": read_cpuinfo(),
        "ram": read_mem(),
        "disks": disks,
        "disk": disks[0] if disks else None,
        "uptimeSec": read_uptime(),
        "net": read_net(),
        "temps": {"cpuC": None, "sensors": []},
        "containers": read_containers(),
        "timestamp": int(time.time() * 1000),
    }


def sampler_loop():
    global _snapshot
    while True:
        try:
            s = sample()
            with _lock:
                _snapshot = s
        except Exception as e:  # never die
            print("[mac-agent] sample error:", e, flush=True)
        time.sleep(SAMPLE_SEC)


def paused_labels() -> list[str]:
    """launchd's own disabled list: it survives reboots and is the only source of truth."""
    out = _sh(["launchctl", "print-disabled", LAUNCHD_DOMAIN])
    return sorted(m for m in re.findall(r'"([^"]+)" => disabled', out) if PAUSABLE_LABEL.fullmatch(m))


def _loaded(label: str) -> bool:
    return subprocess.run(["launchctl", "print", f"{LAUNCHD_DOMAIN}/{label}"],
                          capture_output=True, timeout=10).returncode == 0


def set_paused(label: str, paused: bool) -> None:
    """disable + bootout stops it for good (also a run in progress); enable + bootstrap restores it.
    launchctl's exit codes for "already in that state" vary, so the end state is what gets checked."""
    plist = LAUNCH_AGENTS / f"{label}.plist"
    service = f"{LAUNCHD_DOMAIN}/{label}"
    if paused:
        _sh(["launchctl", "disable", service])
        _sh(["launchctl", "bootout", service], timeout=30)
    else:
        _sh(["launchctl", "enable", service])
        _sh(["launchctl", "bootstrap", LAUNCHD_DOMAIN, str(plist)], timeout=30)
    if (label in paused_labels()) != paused or _loaded(label) == paused:
        raise RuntimeError(f"launchd non ha applicato la modifica a {label}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        """Stats are public on the tailnet, control is not. No token file means no control."""
        try:
            token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            token = ""
        sent = self.headers.get("Authorization", "")
        if token and hmac.compare_digest(sent.encode(), f"Bearer {token}".encode()):
            return True
        self._json(401, {"error": "token mancante o errato"})
        return False

    def do_POST(self):
        if self.path != "/api/automations/pause":
            self._json(404, {"error": "not found"})
            return
        if not self._authorized():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length)) if 0 < length <= 1024 else None
        except ValueError:
            body = None
        label = body.get("label") if isinstance(body, dict) else None
        paused = body.get("paused") if isinstance(body, dict) else None
        if not isinstance(label, str) or not isinstance(paused, bool) or not PAUSABLE_LABEL.fullmatch(label):
            self._json(400, {"error": "servono label com.luigi.* e paused booleano"})
            return
        if not (LAUNCH_AGENTS / f"{label}.plist").is_file():
            self._json(404, {"error": f"nessun plist per {label}"})
            return
        try:
            set_paused(label, paused)
        except (RuntimeError, subprocess.SubprocessError) as exc:
            self._json(500, {"error": str(exc)})
            return
        self._json(200, {"label": label, "paused": paused})

    def do_GET(self):
        if self.path == "/api/automations/paused":
            if self._authorized():
                self._json(200, {"labels": paused_labels()})
        elif self.path.startswith("/api/stats"):
            with _lock:
                snap = dict(_snapshot)
            self._json(200, snap or sample())
        elif self.path == "/api/health/live":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "agent: only /api/stats served"})


def main():
    threading.Thread(target=sampler_loop, daemon=True).start()
    time.sleep(0.2)
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"[mac-agent] '{NAME}' serving /api/stats on {BIND}:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
