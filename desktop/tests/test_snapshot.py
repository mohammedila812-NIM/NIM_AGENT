import shutil
import tempfile
from pathlib import Path
import pytest
from src.security.snapshot import SnapshotManager

def test_snapshot_modify_and_undo():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage_dir = Path(tmp_dir) / "snapshots"
        work_dir = Path(tmp_dir) / "work"
        work_dir.mkdir()

        mgr = SnapshotManager(storage_dir=storage_dir)

        test_file = work_dir / "sample.txt"
        test_file.write_text("Original content", encoding="utf-8")

        # Snapshot before modification
        snap_id = mgr.snapshot_before_action(test_file, action_type="modify")
        assert snap_id is not None

        # Overwrite file
        test_file.write_text("Modified content", encoding="utf-8")
        assert test_file.read_text(encoding="utf-8") == "Modified content"

        # Undo
        res = mgr.undo_last_action()
        assert res["success"] is True
        assert test_file.read_text(encoding="utf-8") == "Original content"

def test_snapshot_delete_and_undo():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage_dir = Path(tmp_dir) / "snapshots"
        work_dir = Path(tmp_dir) / "work"
        work_dir.mkdir()

        mgr = SnapshotManager(storage_dir=storage_dir)

        test_file = work_dir / "to_delete.txt"
        test_file.write_text("Don't lose me!", encoding="utf-8")

        # Snapshot before deletion
        snap_id = mgr.snapshot_before_action(test_file, action_type="delete")
        assert snap_id is not None

        # Delete file
        test_file.unlink()
        assert not test_file.exists()

        # Undo
        res = mgr.undo_last_action()
        assert res["success"] is True
        assert test_file.exists()
        assert test_file.read_text(encoding="utf-8") == "Don't lose me!"
