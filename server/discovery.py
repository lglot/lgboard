"""Auto-detect the Docker container backing each app.

Used for two reasons:
  1. Derive a reverse-proxy-bypassing health check URL (e.g. http://sonarr:8989)
     so a backend down doesn't get masked by Authelia returning 302.
  2. Power per-service shell features (SSH plugin) without forcing the user to
     hand-write `containerName` in every config entry.

Matching is best-effort. Container is matched against an app by:
  - exact id match  (app.id == container_name)
  - exact name match (app.name.lower() == container_name)
  - explicit override via app.containerName

Discovery is cached for `ttl` seconds to avoid hammering Docker.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from .docker_api import DockerClient


_DEFAULT_HEALTH_PATHS = ("/", "/api/health", "/health", "/ping")
# Heuristic: we don't probe random ports. Use the first declared `ExposedPort`
# from the image (TCP only).


class Discovery:
    def __init__(self, docker: DockerClient, ttl: float = 60.0):
        self.docker = docker
        self.ttl = ttl
        self._lock = threading.Lock()
        self._by_name: dict[str, dict] = {}
        self._cache_at: float = 0.0

    def _refresh(self) -> None:
        raw = self.docker.list_full()
        if not raw:
            return
        new: dict[str, dict] = {}
        for c in raw:
            names = [n.lstrip("/") for n in (c.get("Names") or [])]
            primary = names[0] if names else None
            if not primary:
                continue
            ports = c.get("Ports") or []
            tcp_ports = sorted({p["PrivatePort"] for p in ports if p.get("Type") == "tcp"})
            entry = {
                "id": c.get("Id"),
                "name": primary,
                "names": names,
                "state": c.get("State"),
                "image": c.get("Image"),
                "ports": tcp_ports,
                "networks": list((c.get("NetworkSettings") or {}).get("Networks", {}).keys()),
            }
            for n in names:
                new[n] = entry
        with self._lock:
            self._by_name = new
            self._cache_at = time.monotonic()

    def _maybe_refresh(self) -> None:
        if (time.monotonic() - self._cache_at) > self.ttl:
            self._refresh()

    def lookup(self, app: dict) -> Optional[dict]:
        """Return the matched container record, or None."""
        if not isinstance(app, dict):
            return None
        self._maybe_refresh()
        with self._lock:
            by_name = dict(self._by_name)
        # Explicit override wins.
        explicit = app.get("containerName")
        if explicit and explicit in by_name:
            return by_name[explicit]
        # Try id and name (lowercased, hyphens removed).
        candidates = []
        if app.get("id"):
            candidates.append(str(app["id"]).lower())
        if app.get("name"):
            candidates.append(str(app["name"]).lower().replace(" ", "-"))
        for c in candidates:
            if c in by_name:
                return by_name[c]
        return None

    def internal_url(self, app: dict) -> Optional[str]:
        """If a matched container exposes a port, return http://<name>:<port>/."""
        rec = self.lookup(app)
        if rec is None or rec.get("state") != "running":
            return None
        ports = rec.get("ports") or []
        if not ports:
            return None
        return f"http://{rec['name']}:{ports[0]}/"

    def manifest(self) -> dict:
        """Snapshot of all matched containers — used by the /api/discovery endpoint."""
        self._maybe_refresh()
        with self._lock:
            return {n: dict(rec) for n, rec in self._by_name.items()}
