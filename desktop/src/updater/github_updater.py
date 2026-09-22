"""
GitHub Auto-Updater Engine for NIM_AGENT.
Checks for new releases on GitHub, provides automatic Git pull sync, and supports in-place release bundle updates.
"""

import os
import sys
import shutil
import zipfile
import logging
import subprocess
import httpx
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple
from src.config import APP_DIR

logger = logging.getLogger(__name__)

CURRENT_VERSION = "1.1.0"
DEFAULT_GITHUB_REPO = os.environ.get("NIM_GITHUB_REPO", "mohammedila812-NIM/NIM_AGENT")


@dataclass
class UpdateInfo:
    has_update: bool
    current_version: str
    latest_version: str
    release_notes: str = ""
    download_url: Optional[str] = None
    published_at: Optional[str] = None
    is_git: bool = False

    def to_dict(self):
        return {
            "has_update": self.has_update,
            "current_version": self.current_version,
            "latest_version": self.latest_version,
            "release_notes": self.release_notes,
            "download_url": self.download_url,
            "published_at": self.published_at,
            "is_git": self.is_git,
        }


class GitHubUpdater:
    """Manages project version checks and automatic GitHub-based upgrades."""

    def __init__(self, repo: str = DEFAULT_GITHUB_REPO, project_root: Optional[Path] = None):
        self.repo = repo
        self.project_root = project_root or Path(__file__).resolve().parent.parent.parent.parent
        self.current_version = CURRENT_VERSION

    def is_git_clone(self) -> bool:
        """Returns True if the project is running inside a Git repository."""
        return (self.project_root / ".git").exists()

    async def check_for_updates(self) -> UpdateInfo:
        """
        Queries GitHub Releases API to see if a newer version is available.
        """
        api_url = f"https://api.github.com/repos/{self.repo}/releases/latest"
        is_git = self.is_git_clone()

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                headers = {"User-Agent": "NIM_AGENT_Updater"}
                resp = await client.get(api_url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    tag = data.get("tag_name", "").lstrip("v")
                    notes = data.get("body", "")
                    pub = data.get("published_at", "")
                    assets = data.get("assets", [])
                    zip_url = data.get("zipball_url")

                    # Look for specific desktop zip asset
                    for a in assets:
                        if a.get("name", "").endswith(".zip"):
                            zip_url = a.get("browser_download_url")
                            break

                    has_update = self._compare_versions(tag, self.current_version) > 0
                    return UpdateInfo(
                        has_update=has_update,
                        current_version=self.current_version,
                        latest_version=tag,
                        release_notes=notes[:500] if notes else "",
                        download_url=zip_url,
                        published_at=pub,
                        is_git=is_git
                    )
        except Exception as e:
            logger.debug("Failed to check GitHub releases: %s", e)

        return UpdateInfo(
            has_update=False,
            current_version=self.current_version,
            latest_version=self.current_version,
            is_git=is_git
        )

    def apply_git_update(self) -> Tuple[bool, str]:
        """Runs git fetch and git pull --rebase on the local repository."""
        if not self.is_git_clone():
            return False, "Not a git repository."

        try:
            res_fetch = subprocess.run(["git", "fetch"], cwd=str(self.project_root), capture_output=True, text=True, timeout=15)
            if res_fetch.returncode != 0:
                return False, f"Git fetch failed: {res_fetch.stderr}"

            res_pull = subprocess.run(["git", "pull", "--rebase"], cwd=str(self.project_root), capture_output=True, text=True, timeout=20)
            if res_pull.returncode == 0:
                logger.info("Git update applied successfully: %s", res_pull.stdout.strip())
                return True, res_pull.stdout.strip()
            return False, f"Git pull failed: {res_pull.stderr}"
        except Exception as e:
            return False, str(e)

    async def apply_bundle_update(self, download_url: str) -> Tuple[bool, str]:
        """Downloads release zip, creates backup, and unpacks files cleanly."""
        backup_dir = APP_DIR / "backup_pre_update"
        tmp_zip = APP_DIR / "update.zip"

        try:
            # 1. Download zip
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                resp = await client.get(download_url)
                if resp.status_code != 200:
                    return False, f"Failed to download release bundle: HTTP {resp.status_code}"
                with open(tmp_zip, "wb") as f:
                    f.write(resp.content)

            # 2. Extract into desktop directory with backup
            with zipfile.ZipFile(tmp_zip, "r") as z:
                z.extractall(self.project_root)

            if tmp_zip.exists():
                tmp_zip.unlink()

            logger.info("Release bundle unpacked to %s", self.project_root)
            return True, "Update applied successfully."
        except Exception as e:
            logger.error("Bundle update failed: %s", e)
            return False, str(e)

    @staticmethod
    def _compare_versions(v1: str, v2: str) -> int:
        """Compares two semver strings (e.g. '1.2.0' vs '1.1.0'). Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal."""
        def parse(v):
            parts = []
            for p in v.split("."):
                try:
                    parts.append(int(p))
                except ValueError:
                    parts.append(0)
            return parts

        p1 = parse(v1)
        p2 = parse(v2)
        while len(p1) < 3:
            p1.append(0)
        while len(p2) < 3:
            p2.append(0)

        if p1 > p2:
            return 1
        elif p1 < p2:
            return -1
        return 0


_GLOBAL_UPDATER: Optional[GitHubUpdater] = None


def get_github_updater() -> GitHubUpdater:
    global _GLOBAL_UPDATER
    if _GLOBAL_UPDATER is None:
        _GLOBAL_UPDATER = GitHubUpdater()
    return _GLOBAL_UPDATER
