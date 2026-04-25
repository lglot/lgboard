"""Plugin loader — discovery + registration.

See PLUGINS.md for the manifest spec. This is the v1 scaffold:
- Walk core (/app/plugins) and user (/config/plugins) directories.
- Validate manifest minimally.
- Import server.py and call register(ctx).
- Build a flat path → handler routing table for the main HTTP server.
- Expose a manifest list to the frontend via /api/plugins.

Path matching for plugin routes is intentionally tiny — exact match plus a
single `{name}` placeholder. We are not building a router framework.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import threading
from pathlib import Path
from typing import Callable, Optional


CORE_DIR = Path("/app/plugins")
USER_DIR = Path("/config/plugins")

_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def _placeholder_to_regex(template: str) -> tuple[re.Pattern, list[str]]:
    """Convert /api/_p/ssh/sessions/{id} -> compiled regex + ['id']."""
    names: list[str] = []

    def sub(m):
        names.append(m.group(1))
        return r"(?P<" + m.group(1) + r">[^/]+)"

    pattern = "^" + _PLACEHOLDER_RE.sub(sub, template) + "$"
    return re.compile(pattern), names


class PluginRequest:
    __slots__ = ("method", "path", "path_params", "query", "body", "headers", "user")

    def __init__(self, method, path, path_params, query, body, headers, user=None):
        self.method = method
        self.path = path
        self.path_params = path_params
        self.query = query
        self.body = body
        self.headers = headers
        self.user = user


class PluginContext:
    """Surface exposed to plugin server code via register(ctx)."""

    def __init__(self, plugin_id: str, config_dir: Path, manifest: dict, host):
        self.id = plugin_id
        self.config_dir = config_dir
        self.manifest = manifest
        self._host = host
        # Optional bindings (set by host before register is called).
        self.docker = None
        self.discovery = None
        self._shutdown_hooks: list[Callable[[], None]] = []
        self.config: dict = {}

    def add_route(self, method: str, path: str, handler: Callable):
        self._host._register_route(self.id, method, path, handler)

    def on_shutdown(self, fn: Callable[[], None]):
        self._shutdown_hooks.append(fn)

    def log(self, msg: str):
        print(f"[plugin:{self.id}] {msg}", flush=True)


class _Route:
    __slots__ = ("plugin_id", "method", "regex", "params", "handler")

    def __init__(self, plugin_id, method, regex, params, handler):
        self.plugin_id = plugin_id
        self.method = method
        self.regex = regex
        self.params = params
        self.handler = handler


class PluginHost:
    """Singleton holding all loaded plugins and their routes."""

    def __init__(self):
        self._lock = threading.Lock()
        self._loaded: dict[str, dict] = {}      # id -> {manifest, ctx, source_dir}
        self._routes: list[_Route] = []
        self._docker = None
        self._discovery = None

    def attach(self, docker, discovery):
        self._docker = docker
        self._discovery = discovery

    def load_all(self) -> None:
        for base in (CORE_DIR, USER_DIR):
            if not base.exists():
                continue
            for entry in sorted(base.iterdir()):
                if not entry.is_dir():
                    continue
                manifest_path = entry / "plugin.json"
                if not manifest_path.exists():
                    continue
                try:
                    self._load_one(entry, manifest_path)
                except Exception as e:
                    print(f"[plugin] failed to load {entry.name}: {e}", flush=True)

    def _load_one(self, plugin_dir: Path, manifest_path: Path) -> None:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        plugin_id = manifest.get("id")
        if not plugin_id:
            raise ValueError("manifest missing 'id'")
        # User dir takes precedence — drop core entry if same id arrives later.
        existing = self._loaded.get(plugin_id)
        if existing and existing["source_dir"] == plugin_dir:
            return
        ctx = PluginContext(
            plugin_id=plugin_id,
            config_dir=Path("/config/plugins") / plugin_id,
            manifest=manifest,
            host=self,
        )
        # Permissions gating
        perms = set(manifest.get("permissions") or [])
        if "docker.read" in perms or "docker.exec" in perms or "docker.spawn" in perms:
            ctx.docker = self._docker
            ctx.discovery = self._discovery
        # Plugin-local config (best-effort)
        plugin_cfg_file = ctx.config_dir / "config.json"
        if plugin_cfg_file.exists():
            try:
                ctx.config = json.loads(plugin_cfg_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                ctx.config = {}
        # Import server.py if declared
        server_decl = (manifest.get("server") or {}).get("module")
        if server_decl:
            module_path = plugin_dir / f"{server_decl}.py"
            if module_path.exists():
                self._import_and_register(plugin_id, module_path, ctx)
        # If we got here, drop any prior version of this id (user-overrides-core).
        if existing:
            self._routes = [r for r in self._routes if r.plugin_id != plugin_id]
        self._loaded[plugin_id] = {
            "manifest": manifest,
            "ctx": ctx,
            "source_dir": plugin_dir,
        }
        ctx.log(f"loaded v{manifest.get('version', '?')} from {plugin_dir}")

    def _import_and_register(self, plugin_id: str, module_path: Path, ctx: PluginContext):
        spec_name = f"plugins.{plugin_id}.server"
        spec = importlib.util.spec_from_file_location(spec_name, module_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot create import spec for {module_path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec_name] = module
        spec.loader.exec_module(module)
        register = getattr(module, "register", None)
        if not callable(register):
            raise ImportError(f"{plugin_id} server.py has no register(ctx)")
        register(ctx)

    def _register_route(self, plugin_id: str, method: str, path: str, handler):
        regex, params = _placeholder_to_regex(path)
        self._routes.append(_Route(plugin_id, method.upper(), regex, params, handler))

    def find_route(self, method: str, path: str) -> Optional[tuple[Callable, dict, str]]:
        method = method.upper()
        for r in self._routes:
            if r.method != method:
                continue
            m = r.regex.match(path)
            if m:
                return (r.handler, m.groupdict(), r.plugin_id)
        return None

    def list_manifests(self) -> list[dict]:
        out = []
        for plugin_id, rec in self._loaded.items():
            m = rec["manifest"]
            out.append({
                "id": plugin_id,
                "name": m.get("name", plugin_id),
                "version": m.get("version"),
                "description": m.get("description"),
                "author": m.get("author"),
                "homepage": m.get("homepage"),
                "ui": m.get("ui"),
                "permissions": m.get("permissions") or [],
                "source": "user" if str(rec["source_dir"]).startswith(str(USER_DIR)) else "core",
            })
        return out

    def shutdown(self):
        for rec in self._loaded.values():
            for hook in rec["ctx"]._shutdown_hooks:
                try:
                    hook()
                except Exception as e:
                    print(f"[plugin:{rec['ctx'].id}] shutdown hook failed: {e}", flush=True)


HOST = PluginHost()
