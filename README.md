# lgboard

A simple, fast, self-hosted homelab dashboard. Zero build step, zero JS
dependencies beyond React+Babel bundled offline, zero Python packages beyond
the standard library.

- **Real** CPU/RAM/disk/temperature/uptime/network stats read from the host `/proc` and `/sys`
- **Multiple disks** — mount any number of partitions and list them in `stats.disks`
- **Real** container counter read from the Docker Engine socket (read-only)
- **Real** per-service health-check with an active `up/down` dot
- Everything — branding, theme, fonts, shown sections, quick-actions, services
  — lives in a single `config.json` that you can edit by hand or via the UI
- Works behind any reverse proxy (SWAG/nginx/Caddy/Traefik/Cloudflare Tunnel)
- Subfolder and subdomain URLs both work (Homer-style)
- MIT license

## Screenshot

_Add yours here._

## Quick start

```bash
git clone https://github.com/lglot/lgboard.git
cd lgboard
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

Open `http://localhost:8080`. The first boot seeds `./lgboard-config/config.json`
with the example config. Edit that file and refresh the browser — no restart
required.

## Config reference

The whole UI is driven by `config.json`. Here are the top-level keys:

| key            | what it controls |
|----------------|------------------|
| `branding`     | Title, subtitle, user name, monogram letter, footer text |
| `theme`        | Default mode (light/dark), accent palette, density, fonts, available themes |
| `features`     | Feature flags: stats strip, pinned row, quick actions, command palette, footer, greeting |
| `quickActions` | Array of buttons shown above the stats strip (see below) |
| `stats`        | Paths to host `/proc`, `/sys`, docker socket, and `disks[]` list |
| `healthcheck`  | Interval, timeout, user-agent for the background checker |
| `categories`   | List of sections (`media`, `infra`, `devices`, …) — shown in display order |
| `apps`         | Your services |

Each entry in `apps` looks like:

```json
{
  "id": "portainer",
  "name": "Portainer",
  "desc": "Container manager",
  "cat": "infra",
  "url": "https://portainer.example.com",
  "icon": "portainer",
  "fav": true,
  "target": "auto",
  "healthcheck": true,
  "healthUrl": null
}
```

- `url` can be a full URL (`https://…`) **or** a subfolder path (`/portainer/`).
- `target` is `"auto"` (default — subdomain opens new tab, subfolder opens same
  tab), `"_blank"`, or `"_self"`.
- `healthcheck: false` opts this service out of the periodic ping.
- `healthUrl` overrides the URL used for the health check — handy for services
  that 404 on `/` but respond on `/manifest.json` or similar.
- `icon` is the name of a built-in Lucide-style icon (see the Tweaks panel or
  `components.jsx` for the full list). Missing icon → initials monogram.
- `iconSvgPath` (optional) is the raw `d` attribute of an SVG path on a
  24×24 viewBox; overrides `icon`.

### Quick actions

Each entry in `quickActions`:

```json
{ "id": "ssh", "label": "SSH", "icon": "terminal", "action": "copy", "payload": "ssh myhost" }
```

- `action: "url"`      → opens `payload` in a new tab.
- `action: "copy"`     → copies `payload` to the clipboard and shows a toast.
- `action: "modal:add-service"` → opens the Add Service modal.
- `primary: true` renders the button in accent color.

Only three actions exist because **lgboard never executes shell commands on
your server**. If you want Reboot / Shutdown / Update buttons, point them at
your Cockpit / Portainer / Webmin URL with `action: "url"`.

### Themes

Pick an accent via `theme.accent` (`ink`, `emerald`, `amber`, `rose`, `violet`,
`graphite`, or `"custom"` + `theme.customAccentHex: "#7b4fff"`). Add or remove
entries in `theme.availableThemes` — the Tweaks panel reflects the change.

Fonts default to Space Grotesk + JetBrains Mono loaded from Google Fonts.
Set `theme.fontsOffline: true` to skip the external fetch (then the browser
falls back to system fonts, or to anything you drop into `public/vendor/fonts/`).

## Adding a service

Two ways, both work:

- **UI**: click the "Aggiungi servizio" quick action → fill the form → Save.
  The server rewrites `config.json` atomically and the UI reloads.
- **File**: edit `./lgboard-config/config.json`, push into `apps[]`, refresh
  the browser. No restart needed.

## API

| method | path                | description |
|--------|---------------------|-------------|
| GET    | `/`                 | static UI |
| GET    | `/config.json`      | full merged config |
| GET    | `/api/stats`        | real host stats; fields are `null` if the corresponding mount is missing |
| GET    | `/api/health`       | `{ [appId]: { status, httpCode, latencyMs, lastCheckMs } }` |
| GET    | `/api/health/live`  | liveness probe for reverse proxies |
| POST   | `/api/apps`         | upsert a service |
| DELETE | `/api/apps/<id>`    | remove a service |

The API is **unauthenticated** by design — put lgboard behind a reverse proxy
with forward-auth (Authelia, Authentik, Cloudflare Access, …) if it's not on a
trusted network.

## Reverse proxy

- `examples/swag-proxy.conf.example` — SWAG / linuxserver-nginx template
- `examples/caddyfile.example`       — one-liner for Caddy

For Cloudflare Tunnel: point a public hostname at `http://lgboard:8080` on the
Docker network.

## Development

Everything is runtime-compiled (Babel standalone), so there's no build step:

```bash
docker build -t lgboard:dev .
docker run --rm -p 8080:8080 \
  -v "$PWD/dev-config:/config" \
  lgboard:dev
```

On macOS the host stats will show `n/a` because there's no `/proc`; the UI
renders fine otherwise. On Linux mount `/proc:/host/proc:ro` and the numbers
light up.

## Non-goals

- No built-in auth (use your reverse proxy)
- No server-side command execution
- No bundler / build pipeline

## License

MIT — see [LICENSE](LICENSE).
