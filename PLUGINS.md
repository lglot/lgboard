# lgboard plugin system

Plugins extend lgboard with new server endpoints, frontend pages, and
contextual actions on tiles. Plugins are first‑class citizens — the bundled
SSH and Watchtower features ship as plugins so the boundaries stay honest.

## Status

> **Design v1, work in progress.** Manifest format and APIs may shift before
> the first stable plugin tag. Pin a specific lgboard version when shipping a
> plugin you publish for others.

## Layout

```
/app/plugins/                 # core plugins, baked into the image
  ssh/
    plugin.json
    server.py                 # optional Python module, imported as plugins.ssh.server
    ui.jsx                    # optional ES module, loaded by the frontend on demand
    README.md

/config/plugins/              # user-installed plugins (volume), runtime-discovered
  watchtower/
    plugin.json
    ...
```

The same loader walks both paths. Anything in `/config/plugins/` overrides a
core plugin with the same `id`, so users can fork and replace a bundled
plugin without forking the whole image.

## Manifest — `plugin.json`

```jsonc
{
  "id": "ssh",                          // unique, kebab-case
  "name": "SSH Console",
  "version": "1.0.0",
  "author": "lglot",
  "description": "Web terminal for hosts and Docker containers.",
  "homepage": "https://github.com/lglot/lgboard-plugin-ssh",
  "license": "MIT",
  "lgboardMin": "0.4.0",                // minimum lgboard version

  "ui": {
    "module": "ui.jsx",                 // exports default export = plugin
    "page": {
      "path": "/_p/ssh",                // route registered in the dashboard
      "label": "SSH",
      "icon": "terminal"
    },
    "tileAction": {
      "label": "Shell",
      "icon": "terminal",
      "match": "container"              // "container" | "always" | function
    }
  },

  "server": {
    "module": "server",                 // imported as plugins.<id>.server
    "endpoints": [
      { "method": "GET",  "path": "/api/_p/ssh/sessions" },
      { "method": "POST", "path": "/api/_p/ssh/sessions" },
      { "method": "DELETE", "path": "/api/_p/ssh/sessions/{id}" }
    ]
  },

  "permissions": [
    "docker.exec",                      // run `docker exec` on whitelisted containers
    "docker.spawn",                     // start helper containers (ttyd)
    "config.write"                      // mutate /config/<plugin-id>/*.json
  ],

  "config": {                           // schema for /config/plugins/<id>/config.json
    "type": "object",
    "properties": {
      "allowedContainers": { "type": "array", "items": { "type": "string" }, "default": ["*"] },
      "hostShellEnabled":  { "type": "boolean", "default": false },
      "sessionTtlSeconds": { "type": "integer", "default": 600 }
    }
  }
}
```

## Server contract

Each plugin's `server.py` exposes a `register(plugin_ctx)` function. The host
calls it once at startup with a `PluginContext` — the only allowed entry
point.

```python
# /app/plugins/ssh/server.py
def register(ctx):
    ctx.add_route("GET",  "/api/_p/ssh/sessions",          list_sessions)
    ctx.add_route("POST", "/api/_p/ssh/sessions",          create_session)
    ctx.add_route("DELETE", "/api/_p/ssh/sessions/{id}",   destroy_session)
    ctx.on_shutdown(cleanup_all_sessions)
```

`PluginContext` exposes:
- `ctx.id`, `ctx.config`, `ctx.config_dir`
- `ctx.docker` — DockerClient instance (only if `docker.*` permission granted)
- `ctx.discovery` — Discovery instance (read-only)
- `ctx.add_route(method, path, handler)` — handler `(request) -> (status, body|dict)`
- `ctx.on_shutdown(fn)`
- `ctx.log(msg)`

Plugins **never** receive Python's raw `BaseHTTPRequestHandler`. The host
materialises a small `PluginRequest` object (`method`, `path`, `path_params`,
`query`, `body`, `headers`, `user`). This keeps request parsing in one place
and lets the host enforce perms uniformly.

## Frontend contract

`ui.jsx` is loaded as an ES module by the dashboard *only* when the plugin
contributes UI. It must default-export a plugin object:

```jsx
// /app/plugins/ssh/ui.jsx
export default {
  id: "ssh",
  Page: SshPage,                         // route component
  TileAction: SshTileAction,             // contextual button on a tile
  match(app, discovery) {                // optional filter for the tile action
    return discovery.byId[app.id]?.isDocker;
  },
};
```

The dashboard host gives the plugin a `pluginApi` prop with:
- `pluginApi.fetch(path, init)` — calls the plugin's own endpoints, prefixed automatically
- `pluginApi.config` — read-only, current plugin config
- `pluginApi.toast(msg)`
- `pluginApi.modal({ title, render })`
- `pluginApi.icons` — the lgboard icon set
- `pluginApi.theme` — `{ accent, mode, density }`

## Permissions

Permissions are declared in `plugin.json` and granted at install time.

| Permission         | Capability |
|--------------------|------------|
| `docker.read`      | List/inspect containers |
| `docker.exec`      | Run `docker exec` on whitelisted containers |
| `docker.spawn`     | Spawn ephemeral helper containers |
| `host.read`        | Read `/proc`, `/sys` exposed mounts |
| `host.shell`       | **High risk** — privileged shell into the host |
| `config.write`     | Persist plugin's own config in `/config/plugins/<id>/` |
| `apps.write`       | Mutate the `apps` config (avoid unless necessary) |
| `network.fetch`    | Outbound HTTP(S) from the lgboard process |

A plugin without a permission cannot bypass it — the corresponding
`PluginContext` attribute is missing or returns 403.

## Install / uninstall

Plugins live in `/config/plugins/`, which is a volume.

- **Install** from a tarball URL or git repo:
  - UI: store page → `Install` button → server downloads, validates manifest,
    writes to `/config/plugins/<id>/`, returns. Container restart applies it.
  - CLI: drop the directory in `/config/plugins/` and restart.
- **Uninstall**: delete the folder via UI button or `rm`.
- **Validation**: manifest schema check, `lgboardMin` version check, no
  symlinks escaping the install dir.

## Registry

Plugins published by the community live in
[`lglot/lgboard-plugins-registry`](https://github.com/lglot/lgboard-plugins-registry):

```jsonc
// index.json
[
  {
    "id": "ssh",
    "name": "SSH Console",
    "description": "Web terminal for hosts and Docker containers.",
    "version": "1.0.0",
    "homepage": "https://github.com/lglot/lgboard-plugin-ssh",
    "tarball":  "https://github.com/lglot/lgboard-plugin-ssh/archive/refs/tags/v1.0.0.tar.gz",
    "manifest": "https://raw.githubusercontent.com/lglot/lgboard-plugin-ssh/v1.0.0/plugin.json",
    "tags": ["terminal", "core"]
  }
]
```

The dashboard fetches the index once on visit to `/_p/store`, caches for an
hour. Anyone can submit a PR to that repo to list a new plugin — the registry
is just a curated index, the actual code lives wherever the author wants.

## Security

- Untrusted plugins **must** be reviewed before installation. lgboard does not
  sandbox arbitrary Python code — a hostile plugin with `docker.exec` can do
  anything Docker can.
- The store will surface installs by community reputation (stars, downloads),
  but the only real check is manifest review.
- Core plugins are vendored in the lgboard image and signed by repo provenance
  (GitHub Actions OIDC); third-party plugins are not.
- `/api/_p/<plugin-id>/*` is fully behind the same reverse proxy the rest of
  lgboard sits behind. Authelia (or whatever forward-auth you run) covers the
  whole tree by default.

## Status (today)

- Spec lives in this file. Server-side loader skeleton lands in
  `server/plugins.py`. Frontend loader stub in `public/components.jsx`.
- Bundled plugin shipping with the first cut: `ssh` (container shell only).
- Watchtower plugin scheduled for the follow-up.
