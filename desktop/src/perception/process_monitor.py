import datetime
import logging
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import psutil
from src.agent.memory import get_memory_store
from src.security.snapshot import get_snapshot_manager

logger = logging.getLogger(__name__)

# List of critical OS processes that must never be terminated
PROTECTED_SYSTEM_PROCESSES = [
    "system",
    "registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "winlogon.exe",
    "dwm.exe",
    "explorer.exe",
    "taskhostw.exe",
]

@dataclass
class ProcessSummaryItem:
    pid: int
    name: str
    ram_mb: float
    cpu_percent: float
    threads_count: int
    status: str
    window_title: Optional[str] = None
    is_anomaly: bool = False
    anomaly_note: Optional[str] = None
    cmdline_preview: Optional[str] = None

@dataclass
class ProcessCheckpoint:
    checkpoint_id: str
    pid: int
    name: str
    exe_path: str
    cmdline: List[str]
    cwd: Optional[str] = None
    created_at: float = field(default_factory=time.time)

class ProcessMonitor:
    """
    Intelligent Adaptive Process & App Resource Monitor.
    Tracks memory & CPU usage, learns per-app baseline metrics in SQLite,
    detects resource anomalies, and performs safe undoable process terminations.
    """

    def __init__(self):
        self.memory_store = get_memory_store()
        self.snapshot_manager = get_snapshot_manager()
        self._checkpoints: Dict[str, ProcessCheckpoint] = {}

    # -------------------------------------------------------------------------
    # 1. Process Listing & Anomaly Calculation
    # -------------------------------------------------------------------------

    def list_processes(
        self,
        sort_by: str = "ram",
        filter_name: Optional[str] = None,
        limit: int = 20,
        record_baselines: bool = True
    ) -> List[ProcessSummaryItem]:
        """
        Lists running processes sorted by RAM, CPU, or name with baseline anomaly evaluation.
        """
        items: List[ProcessSummaryItem] = []
        clean_filter = filter_name.strip().lower() if filter_name else None

        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'num_threads', 'status', 'cmdline']):
            try:
                info = proc.info
                name = info.get('name') or "unknown"
                pid = info.get('pid')

                if clean_filter and clean_filter not in name.lower():
                    continue

                mem_info = info.get('memory_info')
                ram_mb = round(mem_info.rss / (1024 * 1024), 2) if mem_info else 0.0
                cpu = info.get('cpu_percent') or 0.0
                threads = info.get('num_threads') or 0
                status = info.get('status') or "running"
                cmd = " ".join(info.get('cmdline') or [])[:120]

                # Anomaly Evaluation against learned baseline
                is_anomaly = False
                anomaly_note = None
                baseline = self.memory_store.get_process_baseline(name)

                if baseline and baseline.get("sample_count", 0) >= 3:
                    avg_ram = baseline.get("avg_ram_mb", 1.0)
                    if ram_mb > (avg_ram * 2.5) and ram_mb > 300.0:
                        is_anomaly = True
                        ratio = round(ram_mb / avg_ram, 1)
                        anomaly_note = f"⚠️ High RAM: {ram_mb} MB ({ratio}x your typical baseline of {round(avg_ram, 1)} MB)"

                # Record observation for baseline learning
                if record_baselines and ram_mb > 5.0 and pid > 4:
                    self.memory_store.record_process_metric(name, ram_mb=ram_mb, cpu_percent=cpu)

                items.append(ProcessSummaryItem(
                    pid=pid,
                    name=name,
                    ram_mb=ram_mb,
                    cpu_percent=cpu,
                    threads_count=threads,
                    status=status,
                    is_anomaly=is_anomaly,
                    anomaly_note=anomaly_note,
                    cmdline_preview=cmd
                ))

            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        # Sort results
        if sort_by == "cpu":
            items.sort(key=lambda x: x.cpu_percent, reverse=True)
        elif sort_by == "name":
            items.sort(key=lambda x: x.name.lower())
        else:
            # Default sort by RAM
            items.sort(key=lambda x: x.ram_mb, reverse=True)

        return items[:limit]

    # -------------------------------------------------------------------------
    # 2. Deep Process Inspection
    # -------------------------------------------------------------------------

    def get_process_details(self, pid_or_name: Union[int, str]) -> Dict[str, Any]:
        """
        Deep diagnostic dive into a specific process: open file handles,
        network sockets/ports, memory breakdown, thread count, and cmdline.
        """
        proc = self._resolve_process(pid_or_name)
        if not proc:
            return {"success": False, "error": f"Process matching '{pid_or_name}' not found."}

        try:
            with proc.oneshot():
                pid = proc.pid
                name = proc.name()
                exe = proc.exe() if hasattr(proc, "exe") else ""
                cmdline = proc.cmdline()
                cwd = proc.cwd() if hasattr(proc, "cwd") else ""
                status = proc.status()
                cpu_percent = proc.cpu_percent(interval=0.05)
                mem = proc.memory_info()
                created_dt = datetime.datetime.fromtimestamp(proc.create_time()).strftime("%Y-%m-%d %H:%M:%S")

                # Network connections
                connections = []
                try:
                    conn_iter = proc.net_connections(kind="inet") if hasattr(proc, "net_connections") else proc.connections(kind="inet")
                    for conn in conn_iter[:15]:
                        laddr = f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else ""
                        raddr = f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else ""
                        connections.append({
                            "type": "TCP" if conn.type == 1 else "UDP",
                            "local_address": laddr,
                            "remote_address": raddr,
                            "status": conn.status
                        })
                except Exception:
                    pass

                # Open file handles
                open_files = []
                try:
                    for f in proc.open_files()[:20]:
                        open_files.append(f.path)
                except Exception:
                    pass

                # Learned Baseline comparison
                baseline = self.memory_store.get_process_baseline(name)
                ram_mb = round(mem.rss / (1024 * 1024), 2)
                vms_mb = round(mem.vms / (1024 * 1024), 2)

                return {
                    "success": True,
                    "pid": pid,
                    "name": name,
                    "executable_path": exe,
                    "cmdline": cmdline,
                    "cwd": cwd,
                    "status": status,
                    "created_at": created_dt,
                    "cpu_percent": cpu_percent,
                    "memory": {
                        "rss_ram_mb": ram_mb,
                        "virtual_memory_mb": vms_mb,
                        "baseline_avg_mb": round(baseline.get("avg_ram_mb", ram_mb), 2) if baseline else None,
                        "sample_count": baseline.get("sample_count", 0) if baseline else 0
                    },
                    "num_threads": proc.num_threads(),
                    "active_connections_count": len(connections),
                    "connections": connections,
                    "open_files_count": len(open_files),
                    "open_files_sample": open_files[:10]
                }

        except Exception as e:
            return {"success": False, "error": f"Failed to inspect process {pid_or_name}: {str(e)}"}

    # -------------------------------------------------------------------------
    # 3. Safe Kill with State Checkpointing
    # -------------------------------------------------------------------------

    def checkpoint_process(self, proc: psutil.Process) -> ProcessCheckpoint:
        """Saves process launch arguments and metadata before termination."""
        try:
            name = proc.name()
            exe = proc.exe() if hasattr(proc, "exe") else ""
            cmd = proc.cmdline() if hasattr(proc, "cmdline") else [exe]
            cwd = proc.cwd() if hasattr(proc, "cwd") else None
            ckpt_id = f"ckpt_{proc.pid}_{name}_{int(time.time())}"
            ckpt = ProcessCheckpoint(
                checkpoint_id=ckpt_id,
                pid=proc.pid,
                name=name,
                exe_path=exe,
                cmdline=cmd,
                cwd=cwd
            )
            self._checkpoints[ckpt_id] = ckpt
            self._checkpoints[name.lower()] = ckpt
            return ckpt
        except Exception as e:
            logger.debug("Failed to checkpoint process: %s", e)
            return ProcessCheckpoint(
                checkpoint_id=f"ckpt_fallback_{proc.pid}",
                pid=proc.pid,
                name=proc.name(),
                exe_path="",
                cmdline=[]
            )

    def kill_process(self, pid_or_name: Union[int, str], force: bool = False) -> Dict[str, Any]:
        """
        Checkpoints and terminates a process gracefully (or force terminates).
        """
        proc = self._resolve_process(pid_or_name)
        if not proc:
            return {"success": False, "error": f"Process matching '{pid_or_name}' not found."}

        name = proc.name()
        pid = proc.pid

        # Guard against system processes
        if name.lower() in PROTECTED_SYSTEM_PROCESSES:
            return {
                "success": False,
                "error": f"Security violation: Process '{name}' (PID: {pid}) is a protected Windows system component and cannot be killed."
            }

        # 1. Checkpoint state for undo/restart
        ckpt = self.checkpoint_process(proc)

        # 2. Terminate
        try:
            if force:
                proc.kill()
                msg = f"Force-killed process '{name}' (PID: {pid}). Checkpoint saved: {ckpt.checkpoint_id}"
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=2.0)
                except psutil.TimeoutExpired:
                    proc.kill()
                msg = f"Gracefully terminated process '{name}' (PID: {pid}). Checkpoint saved: {ckpt.checkpoint_id}"

            return {
                "success": True,
                "pid": pid,
                "name": name,
                "checkpoint_id": ckpt.checkpoint_id,
                "can_restart": bool(ckpt.exe_path or ckpt.cmdline),
                "message": msg
            }

        except Exception as e:
            return {"success": False, "error": f"Failed to terminate process '{name}' (PID: {pid}): {str(e)}"}

    def restart_process(self, checkpoint_id_or_name: str) -> Dict[str, Any]:
        """
        Restarts a previously terminated process using its saved checkpoint metadata.
        """
        clean_key = checkpoint_id_or_name.strip().lower()
        ckpt = self._checkpoints.get(checkpoint_id_or_name) or self._checkpoints.get(clean_key)

        if not ckpt or (not ckpt.exe_path and not ckpt.cmdline):
            return {
                "success": False,
                "error": f"No valid checkpoint found for '{checkpoint_id_or_name}'. Process cannot be auto-restarted."
            }

        try:
            cmd = ckpt.cmdline if ckpt.cmdline else [ckpt.exe_path]
            proc = subprocess.Popen(
                cmd,
                cwd=ckpt.cwd if (ckpt.cwd and os.path.exists(ckpt.cwd)) else None,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            )
            return {
                "success": True,
                "restarted_name": ckpt.name,
                "new_pid": proc.pid,
                "cmdline": cmd,
                "message": f"Successfully restarted '{ckpt.name}' (New PID: {proc.pid})"
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to restart '{ckpt.name}': {str(e)}"}

    # -------------------------------------------------------------------------
    # Helper: Resolve Process by PID or Name
    # -------------------------------------------------------------------------

    def _resolve_process(self, pid_or_name: Union[int, str]) -> Optional[psutil.Process]:
        if isinstance(pid_or_name, int) or (isinstance(pid_or_name, str) and pid_or_name.isdigit()):
            try:
                return psutil.Process(int(pid_or_name))
            except Exception:
                return None

        clean_name = str(pid_or_name).strip().lower()
        # Search by exact name, then substring
        for p in psutil.process_iter(['pid', 'name']):
            try:
                if p.info['name'].lower() == clean_name or p.info['name'].lower() == f"{clean_name}.exe":
                    return p
            except Exception:
                continue

        for p in psutil.process_iter(['pid', 'name']):
            try:
                if clean_name in p.info['name'].lower():
                    return p
            except Exception:
                continue

        return None
