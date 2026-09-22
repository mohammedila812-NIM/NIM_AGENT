"""
NIM_AGENT Auto-Updater package.
"""

from .github_updater import GitHubUpdater, get_github_updater, UpdateInfo

__all__ = ["GitHubUpdater", "get_github_updater", "UpdateInfo"]
