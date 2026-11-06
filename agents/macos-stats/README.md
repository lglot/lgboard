# lgboard macOS stats agent

lgboard's server reads Linux `/proc`, which doesn't exist on macOS. This tiny
stdlib agent lets a Mac appear as a host in lgboard's multi-host view by serving
the single-host `/api/stats` payload from native macOS metrics
(`top`, `vm_stat`, `df`, `sysctl`, `netstat`, plus `docker ps` best-effort).

No dependencies. Metrics are read-only and public on the tailnet. The only write
is pausing the user's own `com.luigi.*` LaunchAgents, for the switch in lgboard's
Automations panel:

- `GET /api/automations/paused`, `POST /api/automations/pause` with `{"label", "paused"}`;
- `Authorization: Bearer <token>`, read from `~/.config/lgboard/agent-token` (mode 600).
  No file means no control;
- pausing is `launchctl disable` + `bootout`, so it survives reboots and stops a run
  in progress. Resuming is `enable` + `bootstrap`, so a `RunAtLoad` job starts right away.

The hub needs the same token in `/config/plugins/automations/config.json`:
`{"macAgentUrl": "http://<mac-tailnet-ip>:8077", "macAgentToken": "<token>"}`.

## Run (foreground)

```bash
python3 agent.py            # serves on :8077
```

Env: `PORT` (default 8077), `LGBOARD_MAC_NAME` (host label, default hostname),
`DATA_VOLUME` (default `/System/Volumes/Data`).

## Install as a launchd service (autostart)

```bash
PY=$(command -v python3)
AGENT="$HOME/code/lgboard/agents/macos-stats/agent.py"
PLIST="$HOME/Library/LaunchAgents/com.lglot.lgboard-mac-agent.plist"
sed -e "s#__PYTHON__#$PY#" -e "s#__AGENT__#$AGENT#" \
  "$HOME/code/lgboard/agents/macos-stats/com.lglot.lgboard-mac-agent.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
curl -s http://127.0.0.1:8077/api/stats | head -c 200   # smoke test
```

Logs: `/tmp/lgboard-mac-agent.log`. Uninstall: `launchctl unload "$PLIST" && rm "$PLIST"`.

## Wire into lgboard (on the hub node)

Add to the hub's `config.json` under `stats.remoteHosts`, then restart the
dashboard so it picks up the new host:

```json
{ "id": "mac", "name": "Mac", "url": "http://<mac-tailnet-ip>:8077" }
```

The agent binds `0.0.0.0`; reach it over the tailnet (or restrict with a host
firewall / Tailscale ACL). Temperatures need elevated privileges on macOS and
are reported as `n/a`.
