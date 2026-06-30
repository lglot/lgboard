# lgboard macOS stats agent

lgboard's server reads Linux `/proc`, which doesn't exist on macOS. This tiny
stdlib agent lets a Mac appear as a host in lgboard's multi-host view by serving
the single-host `/api/stats` payload from native macOS metrics
(`top`, `vm_stat`, `df`, `sysctl`, `netstat`, plus `docker ps` best-effort).

No dependencies, no secrets — it only exposes read-only system metrics.

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
