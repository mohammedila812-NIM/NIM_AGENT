import pytest
from src.updater.github_updater import GitHubUpdater, UpdateInfo

def test_version_comparison():
    assert GitHubUpdater._compare_versions("1.2.0", "1.1.0") == 1
    assert GitHubUpdater._compare_versions("1.1.0", "1.1.0") == 0
    assert GitHubUpdater._compare_versions("1.0.9", "1.1.0") == -1
    assert GitHubUpdater._compare_versions("2.0.0", "1.9.9") == 1

def test_updater_is_git_clone():
    updater = GitHubUpdater()
    # In this workspace, git is present or checked cleanly
    assert isinstance(updater.is_git_clone(), bool)
