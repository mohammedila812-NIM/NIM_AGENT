"""
NIM JARVIS Ambient Event Triggers & Watchers Package
"""

from .downloads_watcher import DownloadsWatcher, DownloadedFileEvent, FileCategory, categorize_downloaded_file
from .clipboard_listener import ClipboardListener, ClipboardAnalysisResult, ClipboardEntityType, classify_clipboard_content
from .coordinator import TriggerCoordinator

__all__ = [
    "DownloadsWatcher",
    "DownloadedFileEvent",
    "FileCategory",
    "categorize_downloaded_file",
    "ClipboardListener",
    "ClipboardAnalysisResult",
    "ClipboardEntityType",
    "classify_clipboard_content",
    "TriggerCoordinator"
]
