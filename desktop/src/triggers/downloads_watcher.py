import logging
import os
import threading
import time
import zipfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

class FileCategory(str, Enum):
    SPREADSHEET = "spreadsheet"
    DOCUMENT = "document"
    ARCHIVE = "archive"
    IMAGE = "image"
    CODE = "code"
    INSTALLER = "installer"
    MEDIA = "media"
    OTHER = "other"

@dataclass
class DownloadedFileEvent:
    path: Path
    filename: str
    category: FileCategory
    size_mb: float
    summary: str
    suggested_actions: List[Dict[str, str]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

INCOMPLETE_EXTENSIONS = {
    ".crdownload", ".tmp", ".part", ".downloading", ".opdownload", ".partial"
}

def categorize_downloaded_file(path: Path) -> DownloadedFileEvent:
    """
    Analyzes a newly downloaded file and prepares proactive recommendations.
    """
    ext = path.suffix.lower()
    try:
        size_bytes = path.stat().st_size
        size_mb = round(size_bytes / (1024 * 1024), 2)
    except Exception:
        size_mb = 0.0

    filename = path.name

    # 1. Spreadsheets
    if ext in [".xlsx", ".xls", ".csv", ".tsv"]:
        return DownloadedFileEvent(
            path=path,
            filename=filename,
            category=FileCategory.SPREADSHEET,
            size_mb=size_mb,
            summary=f"Spreadsheet ({ext}, {size_mb} MB)",
            suggested_actions=[
                {"label": "📊 Audit Formulas & Stats", "goal": f"Analyze spreadsheet '{path}' and audit formulas, error cells, and statistics"},
                {"label": "📁 Move to Desktop", "goal": f"Move '{path}' to Desktop"}
            ],
            metadata={"extension": ext}
        )

    # 2. Documents
    elif ext in [".pdf", ".docx", ".doc", ".txt", ".md", ".rtf"]:
        return DownloadedFileEvent(
            path=path,
            filename=filename,
            category=FileCategory.DOCUMENT,
            size_mb=size_mb,
            summary=f"Document ({ext}, {size_mb} MB)",
            suggested_actions=[
                {"label": "📄 Summarize Document", "goal": f"Read and provide an executive summary of '{path}'"},
                {"label": "📁 Move to Documents", "goal": f"Move '{path}' to Documents folder"}
            ],
            metadata={"extension": ext}
        )

    # 3. Archives
    elif ext in [".zip", ".rar", ".7z", ".tar", ".gz"]:
        archive_info = {"extension": ext}
        if ext == ".zip":
            try:
                with zipfile.ZipFile(path, "r") as zf:
                    names = zf.namelist()
                    archive_info["total_files"] = len(names)
                    archive_info["sample_files"] = names[:5]
            except Exception:
                pass

        total_files_str = f", {archive_info.get('total_files')} files" if "total_files" in archive_info else ""
        return DownloadedFileEvent(
            path=path,
            filename=filename,
            category=FileCategory.ARCHIVE,
            size_mb=size_mb,
            summary=f"Archive ({ext}, {size_mb} MB{total_files_str})",
            suggested_actions=[
                {"label": "📦 Extract Archive", "goal": f"Extract archive '{path}' into a new folder with the same name"},
                {"label": "🔍 Inspect Contents", "goal": f"Inspect the contents of archive '{path}' and list files"}
            ],
            metadata=archive_info
        )

    # 4. Images
    elif ext in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"]:
        return DownloadedFileEvent(
            path=path,
            filename=filename,
            category=FileCategory.IMAGE,
            size_mb=size_mb,
            summary=f"Image ({ext}, {size_mb} MB)",
            suggested_actions=[
                {"label": "👁️ OCR / Inspect Image", "goal": f"Extract text from image '{path}' and describe its contents"}
            ],
            metadata={"extension": ext}
        )

    # 5. Code & Scripts
    elif ext in [".py", ".js", ".ts", ".html", ".css", ".json", ".sql", ".sh", ".ps1"]:
        return DownloadedFileEvent(
            path=path,
            filename=filename,
            category=FileCategory.CODE,
            size_mb=size_mb,
            summary=f"Source Code ({ext}, {size_mb} MB)",
            suggested_actions=[
                {"label": "🔍 Review Code", "goal": f"Read and review code file '{path}'"}
            ],
            metadata={"extension": ext}
        )

    # 6. Installers
    elif ext in [".exe", ".msi", ".dmg", ".pkg", ".iso"]:
        return DownloadedFileEvent(
            path=path,
            filename=filename,
            category=FileCategory.INSTALLER,
            size_mb=size_mb,
            summary=f"Installer Package ({ext}, {size_mb} MB)",
            suggested_actions=[
                {"label": "🛡️ Verify & Hash", "goal": f"Calculate SHA256 checksum and check info for installer '{path}'"}
            ],
            metadata={"extension": ext}
        )

    # 7. Other
    return DownloadedFileEvent(
        path=path,
        filename=filename,
        category=FileCategory.OTHER,
        size_mb=size_mb,
        summary=f"File: {filename} ({size_mb} MB)",
        suggested_actions=[
            {"label": "📂 Inspect File", "goal": f"Inspect and examine file: {path}"}
        ],
        metadata={"extension": ext}
    )

class DownloadsWatcher:
    """
    Monitors the user's Downloads directory for completed file downloads.
    Automatically filters transient downloading states and emits rich actionable events.
    """

    def __init__(
        self,
        watch_dir: Optional[Path] = None,
        on_download_callback: Optional[Callable[[DownloadedFileEvent], None]] = None,
        poll_interval: float = 1.0
    ):
        self.watch_dir = watch_dir or (Path.home() / "Downloads")
        self.on_download_callback = on_download_callback
        self.poll_interval = poll_interval
        self._known_files: Set[str] = set()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Starts monitoring the Downloads directory."""
        if self._running:
            return
        if not self.watch_dir.exists():
            try:
                self.watch_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

        # Index existing files so we only trigger on NEW downloads
        try:
            if self.watch_dir.exists():
                self._known_files = {f.name for f in self.watch_dir.iterdir() if f.is_file()}
        except Exception:
            self._known_files = set()

        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="JARVIS-DownloadsWatcher")
        self._thread.start()
        logger.info("Downloads folder watcher started on: %s", self.watch_dir)

    def stop(self):
        """Stops the Downloads watcher."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        logger.info("Downloads folder watcher stopped.")

    def _wait_until_file_stable(self, path: Path, max_wait: float = 4.0) -> bool:
        """Ensures the browser has finished writing and released file locks."""
        start = time.time()
        last_size = -1
        while time.time() - start < max_wait:
            if not path.exists():
                return False
            try:
                cur_size = path.stat().st_size
                if cur_size == last_size and cur_size > 0:
                    # Size is stable, try to open for reading to confirm lock is released
                    with open(path, "rb") as _:
                        return True
                last_size = cur_size
            except (PermissionError, OSError):
                pass
            time.sleep(0.4)
        return path.exists()

    def _run_loop(self):
        while self._running:
            time.sleep(self.poll_interval)
            if not self.watch_dir.exists():
                continue

            try:
                current_files = {f.name for f in self.watch_dir.iterdir() if f.is_file()}
                new_filenames = current_files - self._known_files

                for fname in new_filenames:
                    file_path = self.watch_dir / fname
                    ext = file_path.suffix.lower()

                    # Skip in-progress downloads
                    if ext in INCOMPLETE_EXTENSIONS:
                        continue

                    # Wait for download stability
                    if self._wait_until_file_stable(file_path):
                        self._known_files.add(fname)
                        event = categorize_downloaded_file(file_path)
                        if self.on_download_callback:
                            try:
                                self.on_download_callback(event)
                            except Exception as cb_err:
                                logger.warning("Error in downloads callback: %s", cb_err)

            except Exception as e:
                logger.debug("Downloads watcher error: %s", e)
