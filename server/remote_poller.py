"""Poll remote lgboard agents over the tailnet for multi-host stats.

Each remote host runs lgboard in agent mode (``stats.agentMode=true``) and
exposes a single-host ``/api/stats`` payload. This poller fetches them on a
background thread, caches the last good payload per host, and serves a
stale-tolerant snapshot consumed by ``GET /api/stats?all=true``:

  up     — fresh data within the stale window
  stale  — poll failing now, last cached payload still served
  down   — never reached (no cached data)

stdlib only (urllib). A failing remote never raises into the request path.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

# Fields lifted verbatim from a remote single-host /api/stats payload.
_STAT_FIELDS = ("cpu", "cpuInfo", "ram", "disks", "disk", "net", "uptimeSec", "temps", "containers")


def _empty_stats() -> dict:
    return {
        "cpu": None,
        "cpuInfo": None,
        "ram": None,
        "disks": [],
        "disk": None,
        "net": None,
        "uptimeSec": None,
        "temps": None,
        "containers": None,
    }


def _extract_stats(data: dict) -> dict:
    out = _empty_stats()
    if isinstance(data, dict):
        for k in _STAT_FIELDS:
            if k in data:
                out[k] = data[k]
    return out


def _stats_url(raw: str) -> str:
    """Normalize a host entry into its /api/stats endpoint.

    Accepts either a base url (``http://lgcloud:8080``) or a full stats url.
    """
    raw = (raw or "").rstrip("/")
    if not raw:
        return raw
    if raw.endswith("/api/stats"):
        return raw
    return raw + "/api/stats"


def _reason(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        return f"http-{exc.code}"
    if isinstance(exc, urllib.error.URLError):
        r = getattr(exc, "reason", None)
        rname = r.__class__.__name__.lower() if r is not None else ""
        if "timed out" in str(r).lower() or "timeout" in rname:
            return "timeout"
        if isinstance(r, ConnectionRefusedError) or "refused" in str(r).lower():
            return "refused"
        return "unreachable"
    if isinstance(exc, TimeoutError):
        return "timeout"
    return exc.__class__.__name__.lower()


class RemoteStatsPoller:
    """Background-polls a set of remote agents, caches + stale-falls-back."""

    def __init__(
        self,
        hosts,
        interval: float = 5.0,
        timeout: float = 4.0,
        stale_after: float = 20.0,
        user_agent: str = "lgboard-health/1.0",
        token_header: str = "X-LGBoard-Token",
    ):
        self.interval = float(interval)
        self.timeout = float(timeout)
        self.stale_after_ms = float(stale_after) * 1000.0
        self.user_agent = user_agent
        self.hosts: list[dict] = []
        for i, h in enumerate(hosts or []):
            if not isinstance(h, dict):
                continue
            url = _stats_url(h.get("url") or h.get("statsUrl") or "")
            if not url:
                continue
            hid = str(h.get("id") or h.get("name") or f"host{i}")
            self.hosts.append({
                "id": hid,
                "name": h.get("name") or hid,
                "url": url,
                "token": h.get("token"),
                "tokenHeader": h.get("tokenHeader") or token_header,
            })
        self._lock = threading.Lock()
        # id -> {data, lastOkMs, lastTryMs, error}
        self._cache: dict[str, dict] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None or not self.hosts:
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="remote-poller")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        # Brief warm-up, then poll on a fixed interval.
        self._stop.wait(0.3)
        while not self._stop.is_set():
            self.poll_all()
            self._stop.wait(self.interval)

    def poll_all(self) -> None:
        # Poll hosts concurrently so one slow/dead host can't delay the others.
        threads = []
        for host in self.hosts:
            t = threading.Thread(target=self._poll_one, args=(host,), daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join(self.timeout + 1.0)

    def _poll_one(self, host: dict) -> None:
        now = int(time.time() * 1000)
        data = None
        error = None
        try:
            data = self._fetch(host)
        except Exception as e:  # noqa: BLE001 — never raise out of the thread
            error = _reason(e)
        with self._lock:
            entry = self._cache.get(host["id"]) or {"data": None, "lastOkMs": None}
            entry["lastTryMs"] = now
            if data is not None:
                entry["data"] = data
                entry["lastOkMs"] = now
                entry["error"] = None
            else:
                entry["error"] = error
            self._cache[host["id"]] = entry

    def _fetch(self, host: dict) -> dict:
        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        if host.get("token"):
            headers[host["tokenHeader"]] = host["token"]
        req = urllib.request.Request(host["url"], headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            if resp.status != 200:
                raise RuntimeError(f"http-{resp.status}")
            raw = resp.read()
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise RuntimeError("bad-payload")
        return parsed

    def hosts_snapshot(self) -> list[dict]:
        """Render each remote host into the multi-host ``hosts[]`` contract."""
        now = int(time.time() * 1000)
        with self._lock:
            cache = {k: dict(v) for k, v in self._cache.items()}
        out: list[dict] = []
        for host in self.hosts:
            obj = {"id": host["id"], "name": host["name"], "isLocal": False}
            entry = cache.get(host["id"])
            if not entry or entry.get("lastOkMs") is None:
                # Never seen a good payload.
                obj["status"] = "down"
                obj.update(_empty_stats())
                obj["lastOkMs"] = None
                if entry and entry.get("error"):
                    obj["error"] = entry["error"]
                out.append(obj)
                continue
            age = now - entry["lastOkMs"]
            obj["status"] = "stale" if age > self.stale_after_ms else "up"
            obj.update(_extract_stats(entry.get("data") or {}))
            obj["lastOkMs"] = entry["lastOkMs"]
            if obj["status"] == "stale" and entry.get("error"):
                obj["error"] = entry["error"]
            out.append(obj)
        return out
