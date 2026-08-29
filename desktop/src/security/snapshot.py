import json
import logging
import os
import shutil
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional
from src.config import SNAPSHOTS_DIR, DEFAULT_SNAPSHOT_RETENTION_HOURS

logger = logging.getLogger(__name__)

@dataclass
class SnapshotEntry:
    snapshot_id: str
    original_path: str
    backup_path: str
    action_type: str  # "modify", "delete", "move", "create"
    timestamp: float
    task_id: Optional[str] = None
    description: Optional[str] = None
    is_directory: bool = False
    reverted: bool = False

class SnapshotManager:
    """
    Atomic snapshot and undo layer.
    Ensures any file modification, move, or deletion can be reversed immediately.
    """

    def __init__(self, storage_dir: Path = SNAPSHOTS_DIR):
        self.storage_dir = storage_dir
        self.index_file = self.storage_dir / "index.json"
        self._entries: List[SnapshotEntry] = []
        self._load_index()

    def _load_index(self):
        if self.index_file.exists():
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._entries = [SnapshotEntry(**item) for item in data]
            except Exception as e:
                logger.error("Failed to load snapshot index: %s", e)
                self._entries = []

    def _save_index(self):
        try:
            self.storage_dir.mkdir(parents=True, exist_ok=True)
            temp_file = self.storage_dir / f"index_tmp_{uuid.uuid4().hex[:6]}.json"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump([asdict(e) for e in self._entries], f, indent=2)
            os.replace(temp_file, self.index_file)
        except Exception as e:
            logger.error("Failed to save snapshot index atomically: %s", e)

    def snapshot_before_action(
        self,
        target_path: str | Path,
        action_type: str,
        task_id: Optional[str] = None,
        description: Optional[str] = None
    ) -> Optional[str]:
        """
        Creates an atomic backup of target_path before action_type occurs.
        Returns snapshot_id if created, or None if target didn't exist (e.g. creating brand new file).
        """
        path = Path(target_path).resolve()
        snapshot_id = f"snap_{int(time.time())}_{uuid.uuid4().hex[:8]}"

        if not path.exists():
            # For new file creation, record it so undo can remove the newly created file
            entry = SnapshotEntry(
                snapshot_id=snapshot_id,
                original_path=str(path),
                backup_path="",
                action_type="create",
                timestamp=time.time(),
                task_id=task_id,
                description=description or f"Created {path.name}",
                is_directory=False,
                reverted=False
            )
            self._entries.append(entry)
            self._save_index()
            return snapshot_id

        backup_subfolder = self.storage_dir / snapshot_id
        backup_subfolder.mkdir(parents=True, exist_ok=True)
        backup_file = backup_subfolder / path.name

        try:
            if path.is_dir():
                shutil.copytree(path, backup_file)
                is_dir = True
            else:
                shutil.copy2(path, backup_file)
                is_dir = False

            entry = SnapshotEntry(
                snapshot_id=snapshot_id,
                original_path=str(path),
                backup_path=str(backup_file),
                action_type=action_type,
                timestamp=time.time(),
                task_id=task_id,
                description=description or f"{action_type.capitalize()} on {path.name}",
                is_directory=is_dir,
                reverted=False
            )
            self._entries.append(entry)
            self._save_index()
            logger.info("Created snapshot %s for %s (%s)", snapshot_id, path, action_type)
            return snapshot_id

        except Exception as e:
            logger.error("Failed to create snapshot for %s: %s", path, e)
            return None

    def undo_last_action(self) -> Dict[str, object]:
        """Reverses the most recent un-reverted action."""
        for entry in reversed(self._entries):
            if not entry.reverted:
                return self.restore_snapshot(entry.snapshot_id)

        return {"success": False, "message": "No actions available in undo history."}

    def restore_snapshot(self, snapshot_id: str) -> Dict[str, object]:
        """Restores a specific snapshot by ID."""
        entry = next((e for e in self._entries if e.snapshot_id == snapshot_id), None)
        if not entry:
            return {"success": False, "message": f"Snapshot ID '{snapshot_id}' not found."}

        target_path = Path(entry.original_path)

        try:
            if entry.action_type == "create":
                # File was newly created, undo means deleting it
                if target_path.exists():
                    if target_path.is_dir():
                        shutil.rmtree(target_path)
                    else:
                        target_path.unlink()
                entry.reverted = True
                self._save_index()
                return {
                    "success": True,
                    "message": f"Removed newly created file {target_path}",
                    "snapshot_id": snapshot_id
                }

            backup_path = Path(entry.backup_path)
            if not backup_path.exists():
                return {
                    "success": False,
                    "message": f"Backup data at {backup_path} is missing."
                }

            # Ensure parent directory exists
            target_path.parent.mkdir(parents=True, exist_ok=True)

            if entry.is_directory:
                if target_path.exists():
                    shutil.rmtree(target_path)
                shutil.copytree(backup_path, target_path)
            else:
                if target_path.exists():
                    target_path.unlink()
                shutil.copy2(backup_path, target_path)

            entry.reverted = True
            self._save_index()
            logger.info("Successfully restored snapshot %s to %s", snapshot_id, target_path)

            return {
                "success": True,
                "message": f"Restored {target_path} to state prior to {entry.action_type}",
                "snapshot_id": snapshot_id,
                "original_path": str(target_path)
            }

        except Exception as e:
            logger.error("Failed to restore snapshot %s: %s", snapshot_id, e)
            return {"success": False, "message": f"Error restoring snapshot: {str(e)}"}

    def list_snapshots(self, limit: int = 20) -> List[Dict[str, object]]:
        """List recent snapshots in reverse chronological order."""
        return [asdict(e) for e in reversed(self._entries[-limit:])]

    def prune_old_snapshots(self, retention_hours: int = DEFAULT_SNAPSHOT_RETENTION_HOURS):
        """Prunes snapshots older than retention_hours."""
        cutoff = time.time() - (retention_hours * 3600)
        remaining = []
        for entry in self._entries:
            if entry.timestamp < cutoff:
                # Remove disk backup
                if entry.backup_path:
                    backup_folder = Path(entry.backup_path).parent
                    if backup_folder.exists() and backup_folder.is_dir():
                        shutil.rmtree(backup_folder, ignore_errors=True)
            else:
                remaining.append(entry)

        self._entries = remaining
        self._save_index()

_global_snapshot_mgr: Optional[SnapshotManager] = None

def get_snapshot_manager() -> SnapshotManager:
    global _global_snapshot_mgr
    if _global_snapshot_mgr is None:
        _global_snapshot_mgr = SnapshotManager()
    return _global_snapshot_mgr
