"""Read real host stats from a mounted /proc and root filesystem.

All functions tolerate a missing mount — they return None rather than raising,
so the frontend can render a skeleton instead of fake numbers.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from threading import Lock


class CPUSampler:
    """Returns delta-based CPU usage between successive calls.

    First call returns None (no baseline). Subsequent calls return a float 0..100.
    """

    def __init__(self, proc_path: str = "/host/proc"):
        self.proc_path = Path(proc_path)
        self._last: tuple[int, int] | None = None
        self._lock = Lock()

    def sample(self) -> float | None:
        stat = self.proc_path / "stat"
        try:
            with stat.open() as f:
                line = f.readline()
        except (FileNotFoundError, PermissionError):
            return None
        parts = line.split()
        if parts[0] != "cpu" or len(parts) < 5:
            return None
        nums = [int(x) for x in parts[1:8]]
        idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
        total = sum(nums)
        with self._lock:
            prev = self._last
            self._last = (idle, total)
        if prev is None:
            return None
        d_idle = idle - prev[0]
        d_total = total - prev[1]
        if d_total <= 0:
            return None
        return max(0.0, min(100.0, (1.0 - d_idle / d_total) * 100.0))


def read_mem(proc_path: str = "/host/proc") -> dict | None:
    meminfo = Path(proc_path) / "meminfo"
    try:
        lines = meminfo.read_text().splitlines()
    except (FileNotFoundError, PermissionError):
        return None
    info: dict[str, int] = {}
    for l in lines:
        k, _, v = l.partition(":")
        v = v.strip().split()
        if v:
            info[k.strip()] = int(v[0]) * 1024
    total = info.get("MemTotal")
    avail = info.get("MemAvailable") or info.get("MemFree")
    if not total:
        return None
    used = total - (avail or 0)
    return {
        "totalBytes": total,
        "usedBytes": used,
        "availableBytes": avail,
        "pct": round(used / total * 100, 1),
        "usedGb": round(used / 1e9, 2),
        "totalGb": round(total / 1e9, 2),
    }


def read_disk(root_path: str = "/host/root") -> dict | None:
    try:
        s = os.statvfs(root_path)
    except (FileNotFoundError, PermissionError, OSError):
        return None
    total = s.f_blocks * s.f_frsize
    free = s.f_bavail * s.f_frsize
    used = total - free
    if total <= 0:
        return None
    return {
        "totalBytes": total,
        "usedBytes": used,
        "freeBytes": free,
        "pct": round(used / total * 100, 1),
    }


def read_disks(disks_cfg: list[dict] | None) -> list[dict]:
    """Read multiple disks. disks_cfg = [{label, path}]. Skips missing mounts."""
    if not disks_cfg:
        return []
    out: list[dict] = []
    for entry in disks_cfg:
        path = entry.get("path")
        label = entry.get("label") or path or "?"
        if not path:
            continue
        d = read_disk(path)
        if d is None:
            continue
        d["label"] = label
        d["id"] = entry.get("id") or label.lower().replace(" ", "-")
        out.append(d)
    return out


def read_temps(sys_path: str = "/host/sys") -> dict | None:
    """Read temps from /sys/class/hwmon. Returns {sensors: [...], cpuC: float|None}.

    Picks the first CPU-like sensor (k10temp, coretemp, cpu_thermal, zenpower)
    as cpuC. All sensors are returned in `sensors` for display.
    """
    base = Path(sys_path) / "class" / "hwmon"
    if not base.exists():
        return None
    cpu_names = {"k10temp", "coretemp", "cpu_thermal", "zenpower", "it87"}
    sensors: list[dict] = []
    cpu_c: float | None = None
    try:
        for hwmon in sorted(base.iterdir()):
            try:
                name = (hwmon / "name").read_text().strip()
            except (FileNotFoundError, PermissionError):
                continue
            for f in sorted(hwmon.glob("temp*_input")):
                try:
                    raw = int(f.read_text().strip())
                except (FileNotFoundError, PermissionError, ValueError):
                    continue
                celsius = round(raw / 1000.0, 1)
                label_file = f.with_name(f.name.replace("_input", "_label"))
                try:
                    label = label_file.read_text().strip()
                except (FileNotFoundError, PermissionError):
                    label = name
                sensors.append({"name": name, "label": label, "celsius": celsius})
                if cpu_c is None and name in cpu_names:
                    cpu_c = celsius
    except (FileNotFoundError, PermissionError):
        return None
    if not sensors:
        return None
    return {"cpuC": cpu_c, "sensors": sensors}


def read_uptime(proc_path: str = "/host/proc") -> float | None:
    try:
        raw = (Path(proc_path) / "uptime").read_text().split()[0]
        return float(raw)
    except (FileNotFoundError, PermissionError, ValueError):
        return None


def read_cpuinfo(proc_path: str = "/host/proc") -> dict | None:
    cpuinfo = Path(proc_path) / "cpuinfo"
    try:
        text = cpuinfo.read_text()
    except (FileNotFoundError, PermissionError):
        return None
    cores = 0
    ghz = None
    for line in text.splitlines():
        if line.startswith("processor"):
            cores += 1
        elif line.startswith("cpu MHz") and ghz is None:
            try:
                ghz = round(float(line.split(":", 1)[1]) / 1000, 1)
            except (ValueError, IndexError):
                pass
    return {"cores": cores or os.cpu_count(), "ghz": ghz}


class NetSampler:
    """Sum rx/tx bytes across all non-loopback, non-virtual ifaces, delta per second."""

    SKIP_PREFIXES = ("lo", "docker", "br-", "veth", "tap", "virbr", "cni", "cali")

    def __init__(self, proc_path: str = "/host/proc"):
        self.proc_path = Path(proc_path)
        self._last: tuple[float, int, int] | None = None
        self._lock = Lock()

    def sample(self) -> dict | None:
        netdev = self.proc_path / "net" / "dev"
        try:
            lines = netdev.read_text().splitlines()
        except (FileNotFoundError, PermissionError):
            return None
        rx = tx = 0
        for l in lines[2:]:
            name, _, rest = l.partition(":")
            name = name.strip()
            if not name or name.startswith(self.SKIP_PREFIXES):
                continue
            parts = rest.split()
            if len(parts) >= 9:
                rx += int(parts[0])
                tx += int(parts[8])
        now = time.monotonic()
        with self._lock:
            prev = self._last
            self._last = (now, rx, tx)
        if prev is None:
            return {"downMBs": 0.0, "upMBs": 0.0}
        dt = max(0.001, now - prev[0])
        return {
            "downMBs": round(max(0, (rx - prev[1]) / dt) / 1e6, 2),
            "upMBs": round(max(0, (tx - prev[2]) / dt) / 1e6, 2),
        }
