"""Background healthchecker — probes each app periodically, multi-host aware.

Per-app status is resolved in priority order (see `_evaluate`):

  1. explicit ``healthUrl`` or any ``internalUrl`` (explicit or docker-discovered)
     → probe it directly. This bypasses the reverse proxy (Authelia/SWAG), so a
     forward-auth 302 can't mask a real backend failure. Any non-5xx answer
     (incl. 2xx/3xx/401/403) means the service answered → "up"; 5xx or a
     connection error/timeout → "down". probeType "internal" (explicit url) or
     "container" (url derived from a discovered container host:port).
  2. a LOCAL docker container is matched and there is no health/internal url
     → status follows the container state: running="up", anything else="down".
     probeType "container".
  3. only a public, auth-gated ``url`` → probe it and follow ONE redirect. If the
     redirect Location points at "/authelia" we hit the auth gate and the
     backend is unconfirmable → status "unknown" (reason "auth-gated"), NOT up.
     Otherwise OK_CODES decides. probeType "public".
  4. healthcheck:false, or no usable http(s) url → "unknown" (disabled/no-url).
     probeType "none".

Statuses:
  up      — service answered acceptably
  down    — connection error, timeout, 5xx, or unacceptable public status
  unknown — not checked / disabled / auth-gated (backend unconfirmable)

Each snapshot entry is shaped:
  {status, httpCode, reason, probeType, latencyMs, lastCheckMs, probedUrl?}
"""
from __future__ import annotations

import threading
import time
import urllib.error
import urllib.request
from copy import deepcopy
from typing import Callable
from urllib.parse import urljoin

# Acceptable codes for a PUBLIC probe: 2xx, 3xx, plus 401/403 (service is up but
# requires auth). Redirect-to-authelia is handled separately and is NOT "up".
OK_CODES = {200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 401, 403}
_REDIRECT_CODES = {301, 302, 303, 307, 308}


def _is_http(url) -> bool:
    return isinstance(url, str) and url.startswith(("http://", "https://"))


def _is_authelia(location: str | None) -> bool:
    # SWAG + Authelia forward-auth bounces unauthenticated requests to a portal
    # whose path contains "/authelia". Hitting it means the backend is unproven.
    return "/authelia" in (location or "").lower()


def _exc_reason(exc: Exception) -> str:
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
    if isinstance(exc, ConnectionRefusedError):
        return "refused"
    return exc.__class__.__name__.lower()


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
            new_snapshot[app_id] = self._evaluate(a)
        with self._lock:
            self._snapshot = new_snapshot

    # --- per-app resolution ---

    def _evaluate(self, a: dict) -> dict:
        if a.get("healthcheck") is False:
            return self._snap("unknown", probe_type="none", reason="disabled")

        # 1. explicit healthUrl, or any internalUrl (explicit/discovered) → probe
        #    directly, bypassing the reverse proxy.
        health_url = a.get("healthUrl")
        if _is_http(health_url):
            res = self._probe_internal(health_url, "internal")
            res["probedUrl"] = health_url
            return res
        internal_url = a.get("internalUrl")
        if _is_http(internal_url):
            probe_type = "container" if a.get("_discovered") else "internal"
            res = self._probe_internal(internal_url, probe_type)
            res["probedUrl"] = internal_url
            return res

        # 2. a local container is matched but exposes no probeable url → trust
        #    the container state as authoritative.
        if a.get("_containerMatched"):
            state = (a.get("_containerState") or "").lower()
            if state == "running":
                return self._snap("up", probe_type="container", reason="container-running")
            return self._snap(
                "down", probe_type="container", reason="container-" + (state or "stopped")
            )

        # 3. public, auth-gated url → probe + detect the authelia redirect.
        url = a.get("url")
        if _is_http(url):
            res = self._probe_public(url)
            res["probedUrl"] = url
            return res

        # 4. nothing usable.
        return self._snap("unknown", probe_type="none", reason="no-url")

    # --- probes ---

    def _request_once(self, url: str) -> tuple[int, str | None]:
        """Single GET, NO redirect following.

        Returns (status_code, Location). 3xx/4xx/5xx all come back as a code
        (never raised). Connection-level failures propagate to the caller.
        """
        req = urllib.request.Request(
            url, method="GET", headers={"User-Agent": self.user_agent, "Accept": "*/*"}
        )
        opener = urllib.request.build_opener(_NoRedirectHandler())
        try:
            with opener.open(req, timeout=self.timeout) as resp:
                return resp.status, resp.headers.get("Location")
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location") if getattr(e, "headers", None) else None
            return e.code, loc

    def _probe_internal(self, url: str, probe_type: str) -> dict:
        """Direct backend probe — any non-5xx answer means the service is up."""
        started = time.monotonic()
        try:
            code, _loc = self._request_once(url)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            return self._snap("down", probe_type=probe_type, reason=_exc_reason(e))
        latency_ms = int((time.monotonic() - started) * 1000)
        if 500 <= code <= 599:
            return self._snap(
                "down", probe_type=probe_type, http_code=code,
                reason="server-error", latency_ms=latency_ms,
            )
        return self._snap("up", probe_type=probe_type, http_code=code, latency_ms=latency_ms)

    def _probe_public(self, url: str) -> dict:
        """Auth-gated public probe — follow ONE redirect, flag the authelia gate."""
        started = time.monotonic()
        try:
            code, location = self._request_once(url)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            return self._snap("down", probe_type="public", reason=_exc_reason(e))

        if code in _REDIRECT_CODES and location:
            if _is_authelia(location):
                return self._snap(
                    "unknown", probe_type="public", http_code=code,
                    reason="auth-gated", latency_ms=int((time.monotonic() - started) * 1000),
                )
            # Follow exactly one redirect, then re-evaluate.
            try:
                code, location = self._request_once(urljoin(url, location))
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                return self._snap("down", probe_type="public", reason=_exc_reason(e))
            if code in _REDIRECT_CODES and location and _is_authelia(location):
                return self._snap(
                    "unknown", probe_type="public", http_code=code,
                    reason="auth-gated", latency_ms=int((time.monotonic() - started) * 1000),
                )

        latency_ms = int((time.monotonic() - started) * 1000)
        status = "up" if code in OK_CODES else "down"
        reason = None if status == "up" else "bad-status"
        return self._snap(
            status, probe_type="public", http_code=code, reason=reason, latency_ms=latency_ms
        )

    # --- helpers ---

    def _snap(
        self,
        status: str,
        *,
        probe_type: str,
        http_code: int | None = None,
        reason: str | None = None,
        latency_ms: int | None = None,
    ) -> dict:
        return {
            "status": status,
            "httpCode": http_code,
            "reason": reason,
            "probeType": probe_type,
            "latencyMs": latency_ms,
            "lastCheckMs": int(time.time() * 1000),
        }


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
