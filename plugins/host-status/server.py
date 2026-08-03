"""Host status plugin - server side (read-only).

One endpoint:
  GET /api/_p/host-status/overview

Answers the two questions that today only live in logs and Slack DMs:
  1. is the host healthy? Same checks as alerts/handlers/host-health-check.sh:
     NFS mounts declared in fstab (mounted and actually readable) and the
     binaries in ~/.hermes/bin (executable, built for the native ELF machine).
  2. what did the alerts aggregator do? alerts.toml gives the configured
     alerts, ~/.cache/alerts/alerts.log gives the recent runs.

Everything is read through the read-only bind of the host root at /host/root,
so no extra volume and no shelling out. Stdlib only.
"""
from __future__ import annotations

import os
import re
import threading
import time
import tomllib
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULTS = {
    "hostRoot": "/host/root",
    "hostLabel": "lgserver-new",
    "homeDir": "/home/lgser",
}

LOG_TAIL_BYTES = 256 * 1024
RUNS_PER_ALERT = 8
PROBE_TIMEOUT = 6.0
FALLBACK_TZ = "Europe/Rome"

# Network filesystems worth probing: they are the ones that can go away or turn
# unreadable while the apps on top keep serving an empty directory.
# Prefixes, so nfs4 / smb3 / smbfs are covered too.
NET_FSTYPES = ("nfs", "cifs", "smb")

ELF_MACHINES = {0x02: "sparc", 0x03: "x86", 0x28: "arm", 0x3E: "x86-64",
                0xB7: "aarch64", 0xF3: "riscv"}

LOG_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \| ([^|]+?) \| rc=(-?\d+) \| ?(.*)$")

_CFG = dict(DEFAULTS)


def register(ctx):
    _CFG.update({k: v for k, v in (ctx.config or {}).items() if k in DEFAULTS})
    ctx.add_route("GET", "/api/_p/host-status/overview", overview)
    ctx.log(f"host-status ready (root: {_CFG['hostRoot']}, home: {_CFG['homeDir']})")


def _hp(*parts) -> Path:
    """A host path as seen from inside the container."""
    return Path(_CFG["hostRoot"]).joinpath(*[str(p).lstrip("/") for p in parts])


# ---------------------------------------------------------------- mounts

def _mount_table() -> dict:
    table = {}
    try:
        for line in Path("/proc/mounts").read_text(encoding="utf-8", errors="replace").splitlines():
            f = line.split()
            if len(f) >= 3:
                table[f[1]] = {"source": f[0], "fstype": f[2]}
    except OSError:
        pass
    return table


def _probe_readable(path: Path) -> dict:
    # A stale NFS handle can block the caller for a long time, so the listing
    # runs on a throwaway thread we can walk away from.
    res = {}

    def run():
        t0 = time.monotonic()
        try:
            res["entries"] = len(os.listdir(path))
        except OSError as e:
            res["error"] = e.strerror or str(e)
        res["ms"] = int((time.monotonic() - t0) * 1000)

    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(PROBE_TIMEOUT)
    if th.is_alive():
        return {"readable": False, "error": f"nessuna risposta in {int(PROBE_TIMEOUT)}s",
                "probeMs": int(PROBE_TIMEOUT * 1000)}
    if "error" in res:
        return {"readable": False, "error": res["error"], "probeMs": res["ms"]}
    return {"readable": True, "entries": res["entries"], "probeMs": res["ms"]}


def _check_mounts(problems: list) -> list:
    fstab = _hp("/etc/fstab")
    table = _mount_table()
    out = []
    try:
        lines = fstab.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as e:
        problems.append(f"fstab illeggibile: {e}")
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split()
        if len(f) < 3 or not f[2].startswith(NET_FSTYPES) or not f[1].startswith("/"):
            continue
        mp = f[1]
        row = {"mountpoint": mp, "declared": f[0], "fstab": f[2]}
        live = table.get(str(_hp(mp))) or table.get(mp)
        if not live:
            row.update(mounted=False, readable=False, status="fail",
                       problem=f"mount {mp} non attivo")
            problems.append(f"mount {mp} non attivo (sudo mount {mp})")
        else:
            row.update(mounted=True, source=live["source"], fstype=live["fstype"])
            row.update(_probe_readable(_hp(mp)))
            # With x-systemd.automount /proc/mounts only carries the autofs stub
            # until something touches the path. The probe just did, so re-read to
            # report the real source instead of "systemd-1 / autofs".
            if live["fstype"] == "autofs":
                fresh = _mount_table()
                real = fresh.get(str(_hp(mp))) or fresh.get(mp) or {}
                if real.get("fstype", "autofs") != "autofs":
                    row.update(source=real["source"], fstype=real["fstype"])
            if row["readable"]:
                row["status"] = "ok"
            else:
                row["status"] = "fail"
                row["problem"] = f"mount {mp} attivo ma illeggibile: {row.get('error')}"
                problems.append(f"mount {mp} attivo ma illeggibile ({row.get('error')}), rimontare")
        out.append(row)
    return out


# ---------------------------------------------------------------- binaries

def _elf_machine(path: Path):
    try:
        with path.open("rb") as f:
            head = f.read(20)
    except OSError:
        return None
    if len(head) < 20 or head[:4] != b"\x7fELF":
        return None
    order = "little" if head[5] == 1 else "big"
    return int.from_bytes(head[18:20], order)


def _machine_name(code) -> str:
    if code is None:
        return "non-ELF"
    return ELF_MACHINES.get(code, f"0x{code:02x}")


def _check_binaries(problems: list) -> tuple:
    # Compared against a binary known to run here, so the check survives a
    # rebuild of the host on a different architecture.
    native = _elf_machine(_hp("/bin/sh"))
    bindir = _hp(_CFG["homeDir"], ".hermes/bin")
    out = []
    try:
        names = sorted(p.name for p in bindir.iterdir() if p.is_file())
    except OSError as e:
        problems.append(f"{bindir} illeggibile: {e}")
        return out, _machine_name(native)
    for name in names:
        p = bindir / name
        try:
            st = p.stat()
        except OSError:
            continue
        row = {"name": name, "sizeBytes": st.st_size, "mtime": int(st.st_mtime * 1000),
               "executable": bool(st.st_mode & 0o111)}
        machine = _elf_machine(p)
        row["machine"] = _machine_name(machine)
        if not row["executable"]:
            row["status"] = "fail"
            row["problem"] = f"{name} non eseguibile"
            problems.append(f"{name} in ~/.hermes/bin non eseguibile")
        elif machine is None:
            row["status"] = "skip"
        elif native is not None and machine != native:
            row["status"] = "fail"
            row["problem"] = f"{name} e per {row['machine']}, serve {_machine_name(native)}"
            problems.append(f"{name} e per un'altra architettura "
                            f"({row['machine']} invece di {_machine_name(native)}), reinstallare")
        else:
            row["status"] = "ok"
        out.append(row)
    return out, _machine_name(native)


# ---------------------------------------------------------------- alerts

def _tail(path: Path, nbytes: int) -> str:
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - nbytes))
        data = f.read()
    if size > nbytes:
        data = data.split(b"\n", 1)[-1]
    return data.decode("utf-8", "replace")


def _read_alerts_config() -> tuple:
    path = _hp(_CFG["homeDir"], "alerts/alerts.toml")
    try:
        with path.open("rb") as f:
            doc = tomllib.load(f)
    except Exception as e:  # noqa: BLE001
        return {}, FALLBACK_TZ, f"{path}: {e}"
    return doc.get("alerts") or {}, doc.get("tz") or FALLBACK_TZ, None


def _read_alerts_log(tzname: str) -> tuple:
    path = _hp(_CFG["homeDir"], ".cache/alerts/alerts.log")
    try:
        tz = ZoneInfo(tzname)
    except Exception:  # noqa: BLE001
        tz = datetime.now().astimezone().tzinfo
    try:
        text = _tail(path, LOG_TAIL_BYTES)
    except OSError as e:
        return [], f"{path}: {e}"
    runs = []
    for line in text.splitlines():
        m = LOG_RE.match(line.strip())
        if not m:
            continue
        ts, name, rc, msg = m.groups()
        try:
            when = int(datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz).timestamp() * 1000)
        except ValueError:
            when = None
        runs.append({"ts": ts, "at": when, "name": name.strip(),
                     "rc": int(rc), "message": msg.strip()})
    return runs, None


def _collect_alerts() -> dict:
    conf, tzname, conf_error = _read_alerts_config()
    runs, log_error = _read_alerts_log(tzname)
    by_name: dict = {}
    for r in runs:
        by_name.setdefault(r["name"], []).append(r)
    day_ago = time.time() * 1000 - 86_400_000
    out = []
    for name, spec in sorted(conf.items()):
        mine = by_name.get(name, [])
        last = mine[-1] if mine else None
        enabled = bool(spec.get("enabled", True))
        recent = [r for r in mine if (r["at"] or 0) >= day_ago]
        row = {
            "name": name,
            "enabled": enabled,
            "schedule": spec.get("schedule"),
            "description": spec.get("description"),
            "command": spec.get("command"),
            "lastTs": last["ts"] if last else None,
            "lastAt": last["at"] if last else None,
            "lastRc": last["rc"] if last else None,
            "lastMessage": last["message"] if last else None,
            "lines24h": len(recent),
            "fails24h": sum(1 for r in recent if r["rc"] != 0),
        }
        if not enabled:
            row["status"] = "off"
        elif last is None:
            row["status"] = "unknown"
        elif last["rc"] != 0:
            row["status"] = "fail"
        else:
            row["status"] = "ok"
        out.append(row)
    failing = [a["name"] for a in out if a["status"] == "fail"]
    # Per alert instead of a plain tail: one chatty alert would otherwise push
    # every other alert out of the window.
    recent = [r for rs in by_name.values() for r in rs[-RUNS_PER_ALERT:]]
    recent.sort(key=lambda r: r["at"] or 0, reverse=True)
    return {
        "tz": tzname,
        "configured": out,
        "recent": recent,
        "runsPerAlert": RUNS_PER_ALERT,
        "failing": failing,
        "status": "fail" if failing else "ok",
        "error": conf_error or log_error,
    }


# ---------------------------------------------------------------- endpoint

def overview(req):
    problems: list = []
    mounts = _check_mounts(problems)
    binaries, native = _check_binaries(problems)
    alerts = _collect_alerts()
    return 200, {
        "serverNow": int(time.time() * 1000),
        "host": _CFG["hostLabel"],
        "health": {
            "status": "fail" if problems else "ok",
            "problems": problems,
            "nativeMachine": native,
            "mounts": mounts,
            "binaries": binaries,
            "binDir": f"{_CFG['homeDir']}/.hermes/bin",
        },
        "alerts": alerts,
    }
