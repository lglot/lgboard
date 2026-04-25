"""Background healthchecker — pings each app URL periodically.

Tolerant of transient failures. Statuses:
  up      — HTTP response received, status in the acceptable set
  down    — connection error OR unacceptable HTTP status
  unknown — not checked yet, or healthcheck disabled for the entry

Does NOT follow redirects (3xx is treated as "up", which is what we want for
reverse-proxy-fronted services behind auth).
"""
from __future__ import annotations

import threading
import time
import urllib.request
import urllib.error
from copy import deepcopy
from typing import Callable

# 2xx, 3xx, plus 401/403 (service up but requires auth — we're healthy).
OK_CODES = {200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 401, 403}


class HealthChecker:
    def __init__(
        self,
        get_apps: Callable[[], list[dict]],
        interval: float = 30.0,
        timeout: float = 5.0,
        user_agent: str = "lgboard-health/1.0",
    ):
        self._get_apps = get_apps
        self.interval = interval
        self.timeout = timeout
        self.user_agent = user_agent
        self._lock = threading.Lock()
        self._snapshot: dict[str, dict] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="healthchecker")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            return deepcopy(self._snapshot)

    def _run(self) -> None:
        # Short warm-up so the UI sees results quickly on first load.
        self._stop.wait(2.0)
        while not self._stop.is_set():
            self._tick()
            self._stop.wait(self.interval)

    def _tick(self) -> None:
        apps = self._get_apps()
        new_snapshot: dict[str, dict] = {}
        for a in apps:
            if not isinstance(a, dict):
                continue
            app_id = a.get("id") or a.get("name")
            if not app_id:
                continue
            if a.get("healthcheck") is False:
                new_snapshot[app_id] = {"status": "unknown", "reason": "disabled"}
                continue
            # Probe priority: explicit healthUrl > internalUrl > public url.
            # internalUrl bypasses the reverse proxy (Authelia/SWAG), so a
            # forward-auth 302 doesn't mask a real backend failure.
            url = a.get("healthUrl") or a.get("internalUrl") or a.get("url")
            if not url or not url.startswith(("http://", "https://")):
                new_snapshot[app_id] = {"status": "unknown", "reason": "no-url"}
                continue
            new_snapshot[app_id] = self._probe(url)
            new_snapshot[app_id]["probedUrl"] = url
        with self._lock:
            self._snapshot = new_snapshot

    def _probe(self, url: str) -> dict:
        req = urllib.request.Request(
            url,
            method="GET",
            headers={"User-Agent": self.user_agent, "Accept": "*/*"},
        )
        # No redirect handler — we treat 3xx as "up" directly.
        opener = urllib.request.build_opener(_NoRedirectHandler())
        started = time.monotonic()
        try:
            with opener.open(req, timeout=self.timeout) as resp:
                code = resp.status
        except urllib.error.HTTPError as e:
            code = e.code
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            return {
                "status": "down",
                "reason": str(e.__class__.__name__),
                "lastCheckMs": int(time.time() * 1000),
            }
        latency_ms = int((time.monotonic() - started) * 1000)
        status = "up" if code in OK_CODES else "down"
        return {
            "status": status,
            "httpCode": code,
            "latencyMs": latency_ms,
            "lastCheckMs": int(time.time() * 1000),
        }


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
