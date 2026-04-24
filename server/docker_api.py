"""Minimal Docker Engine API client over a unix socket — stdlib only.

Avoids the `docker` pip package (adds 10MB). If the socket is missing or
inaccessible (common in dev), every call returns None and the caller skips
rendering container stats.
"""
from __future__ import annotations

import http.client
import json
import socket
import time
from threading import Lock
from typing import Optional


class _UHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: float = 2.0):
        super().__init__("localhost", timeout=timeout)
        self._sock_path = socket_path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self._sock_path)
        self.sock = s


class DockerClient:
    """Polls /containers/json with an in-memory cache (default 10s TTL)."""

    def __init__(self, socket_path: str = "/var/run/docker.sock", ttl: float = 10.0):
        self.socket_path = socket_path
        self.ttl = ttl
        self._lock = Lock()
        self._cache: Optional[dict] = None
        self._cache_at: float = 0.0

    def _request(self, path: str) -> Optional[list | dict]:
        try:
            conn = _UHTTPConnection(self.socket_path)
            conn.request("GET", path, headers={"Host": "localhost", "Accept": "application/json"})
            resp = conn.getresponse()
            if resp.status != 200:
                return None
            body = resp.read()
            conn.close()
            return json.loads(body)
        except (FileNotFoundError, ConnectionRefusedError, PermissionError, socket.error, OSError):
            return None
        except json.JSONDecodeError:
            return None

    def containers(self) -> Optional[dict]:
        """Return {running, total, items: [{name, state, image}]}, or None if unreachable."""
        now = time.monotonic()
        with self._lock:
            if self._cache is not None and (now - self._cache_at) < self.ttl:
                return self._cache
        data = self._request("/containers/json?all=true")
        if data is None or not isinstance(data, list):
            return None
        items = []
        running = 0
        for c in data:
            state = c.get("State", "unknown")
            if state == "running":
                running += 1
            names = c.get("Names") or []
            items.append({
                "name": (names[0] if names else c.get("Id", "?"))[1:] if names else "?",
                "state": state,
                "image": c.get("Image", ""),
            })
        result = {"running": running, "total": len(items), "items": items}
        with self._lock:
            self._cache = result
            self._cache_at = now
        return result
