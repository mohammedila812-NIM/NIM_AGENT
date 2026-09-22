import difflib
import fnmatch
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from src.security.snapshot import get_snapshot_manager

def resolve_target_path(raw_path: str) -> Path:
    clean_str = str(raw_path).strip().replace("\\", "/")
    # Safe User Home redirection: if LLM mistakenly targets Administrator, redirect to actual user home
    if clean_str.lower().startswith("c:/users/administrator"):
        remainder = clean_str[len("c:/users/administrator"):].lstrip("/")
        return (Path.home() / remainder).resolve()

    p = os.path.expanduser(clean_str)
    p_lower = p.lower()
    if p_lower.startswith("desktop/"):
        return (Path.home() / "Desktop" / p[8:]).resolve()
    elif p_lower.startswith("documents/"):
        return (Path.home() / "Documents" / p[10:]).resolve()
    elif p_lower.startswith("downloads/"):
        return (Path.home() / "Downloads" / p[10:]).resolve()
    return Path(p).resolve()

def format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

def categorize_file(path: Path) -> str:
    if path.is_dir():
        return "directory"
    ext = path.suffix.lower()
    if ext in [".xlsx", ".xls", ".csv", ".tsv"]:
        return "spreadsheet"
    elif ext in [".docx", ".doc", ".pdf", ".txt", ".md", ".rtf"]:
        return "document"
    elif ext in [".pptx", ".ppt"]:
        return "presentation"
    elif ext in [".py", ".js", ".ts", ".html", ".css", ".json", ".xml", ".yaml", ".yml", ".c", ".cpp", ".rs", ".go"]:
        return "code"
    elif ext in [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico"]:
        return "image"
    elif ext in [".zip", ".tar", ".gz", ".7z", ".rar"]:
        return "archive"
    elif ext in [".mp3", ".wav", ".flac", ".m4a"]:
        return "audio"
    elif ext in [".mp4", ".mov", ".avi", ".mkv"]:
        return "video"
    return "file"

class ReadFileTool(BaseTool):
    name = "read_file"
    description = "Read the text content of a file on the local filesystem. Supports text, code, JSON, CSV, and markdown files."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute or relative path to the file to read."},
            "max_lines": {"type": "integer", "description": "Maximum number of lines to read (default: 500).", "default": 500},
            "start_line": {"type": "integer", "description": "1-based starting line number (default: 1).", "default": 1}
        },
        "required": ["path"]
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = resolve_target_path(str(args.get("path")))
        if not file_path.exists():
            return ToolResult(success=False, data=None, error=f"File not found: {file_path}")
        if file_path.is_dir():
            return ToolResult(success=False, data=None, error=f"Target path is a directory, not a file: {file_path}")

        max_lines = int(args.get("max_lines", 500))
        start_line = max(1, int(args.get("start_line", 1)))

        try:
            selected_lines = []
            total_lines = 0
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                for idx, line in enumerate(f, start=1):
                    total_lines += 1
                    if start_line <= idx < start_line + max_lines:
                        selected_lines.append(line)

            content = "".join(selected_lines)
            return ToolResult(
                success=True,
                data={
                    "path": str(file_path),
                    "total_lines": total_lines,
                    "showing_range": f"{start_line}-{min(total_lines, start_line + len(selected_lines) - 1)}",
                    "content": content
                }
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to read file: {str(e)}")

class WriteFileTool(BaseTool):
    name = "write_file"
    description = "Write text content to a file. Automatically creates parent directories and takes a pre-action backup snapshot for safe undo."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute or relative path to the destination file."},
            "content": {"type": "string", "description": "Text content to write to the file."},
            "append": {"type": "boolean", "description": "If true, appends to the file instead of overwriting.", "default": False}
        },
        "required": ["path", "content"]
    }
    risk_level = ActionRiskLevel.DESTRUCTIVE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = resolve_target_path(str(args.get("path")))
        content = str(args.get("content", ""))
        append = bool(args.get("append", False))

        snapshot_mgr = get_snapshot_manager()
        snap_id = snapshot_mgr.snapshot_before_action(
            target_path=file_path,
            action_type="modify" if file_path.exists() else "create",
            task_id=context.task_id,
            description=f"Writing to {file_path.name}"
        )

        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            mode = "a" if append else "w"
            with open(file_path, mode, encoding="utf-8") as f:
                f.write(content)

            return ToolResult(
                success=True,
                data={
                    "path": str(file_path),
                    "bytes_written": len(content.encode("utf-8")),
                    "snapshot_id": snap_id,
                    "action": "appended" if append else "written"
                },
                snapshot_id=snap_id
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to write file: {str(e)}")

class MoveFileTool(BaseTool):
    name = "move_file"
    description = "Move or rename a file or directory. Auto-snapshots the item prior to moving."
    parameters = {
        "type": "object",
        "properties": {
            "source": {"type": "string", "description": "Source path of the file/directory."},
            "destination": {"type": "string", "description": "Destination path."}
        },
        "required": ["source", "destination"]
    }
    risk_level = ActionRiskLevel.DESTRUCTIVE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        src = resolve_target_path(str(args.get("source")))
        dst = resolve_target_path(str(args.get("destination")))

        if not src.exists():
            return ToolResult(success=False, data=None, error=f"Source does not exist: {src}")

        snapshot_mgr = get_snapshot_manager()
        snap_id = snapshot_mgr.snapshot_before_action(
            target_path=src,
            action_type="move",
            task_id=context.task_id,
            description=f"Moving {src.name} to {dst.name}"
        )

        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            return ToolResult(
                success=True,
                data={"source": str(src), "destination": str(dst), "snapshot_id": snap_id},
                snapshot_id=snap_id
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to move file: {str(e)}")

class DeleteFileTool(BaseTool):
    name = "delete_file"
    description = "Delete a file or directory. Automatically takes a full backup snapshot before deletion so it can be restored anytime."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to the file or directory to delete."}
        },
        "required": ["path"]
    }
    risk_level = ActionRiskLevel.DESTRUCTIVE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = resolve_target_path(str(args.get("path")))
        if not file_path.exists():
            return ToolResult(success=False, data=None, error=f"Path not found: {file_path}")

        snapshot_mgr = get_snapshot_manager()
        snap_id = snapshot_mgr.snapshot_before_action(
            target_path=file_path,
            action_type="delete",
            task_id=context.task_id,
            description=f"Deleting {file_path.name}"
        )

        try:
            if file_path.is_dir():
                shutil.rmtree(file_path)
            else:
                file_path.unlink()

            return ToolResult(
                success=True,
                data={"path": str(file_path), "snapshot_id": snap_id, "message": "Deleted (backup preserved)"},
                risk_level=ActionRiskLevel.DESTRUCTIVE,
                snapshot_id=snap_id
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to delete path: {str(e)}")

class ListDirectoryTool(BaseTool):
    name = "list_directory"
    description = "List files and subdirectories within a given folder path."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to list (defaults to current working directory).", "default": "."},
            "max_items": {"type": "integer", "description": "Maximum number of items to return (default: 100).", "default": 100}
        }
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        dir_path = resolve_target_path(str(args.get("path", ".")))
        if not dir_path.exists():
            return ToolResult(success=False, data=None, error=f"Directory not found: {dir_path}")
        if not dir_path.is_dir():
            return ToolResult(success=False, data=None, error=f"Path is not a directory: {dir_path}")

        max_items = int(args.get("max_items", 100))
        items = []
        total_size = 0
        file_count = 0
        dir_count = 0

        try:
            from datetime import datetime
            for entry in dir_path.iterdir():
                if len(items) >= max_items:
                    break
                try:
                    stat = entry.stat()
                    is_dir = entry.is_dir()
                    sz = stat.st_size if not is_dir else 0
                    if not is_dir:
                        total_size += sz
                        file_count += 1
                    else:
                        dir_count += 1

                    items.append({
                        "name": entry.name,
                        "is_directory": is_dir,
                        "category": categorize_file(entry),
                        "size_bytes": sz,
                        "size_human": format_size(sz) if not is_dir else "--",
                        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
                    })
                except Exception:
                    pass

            return ToolResult(
                success=True,
                data={
                    "directory": str(dir_path),
                    "total_entries": len(items),
                    "files_count": file_count,
                    "directories_count": dir_count,
                    "total_size_human": format_size(total_size),
                    "items": sorted(items, key=lambda x: (not x["is_directory"], x["name"].lower()))
                }
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to list directory: {str(e)}")

class SearchFilesTool(BaseTool):
    name = "search_files"
    description = "Search for files by name glob pattern or search for text content inside files in a directory with snippet previews."
    parameters = {
        "type": "object",
        "properties": {
            "directory": {"type": "string", "description": "Root directory to search within.", "default": "."},
            "pattern": {"type": "string", "description": "Filename pattern to match (e.g. '*.py', '*.docx', '*invoice*')."},
            "query": {"type": "string", "description": "Optional text string to search for inside files."},
            "max_results": {"type": "integer", "description": "Maximum matches to return (default: 25).", "default": 25}
        }
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        root_dir = resolve_target_path(str(args.get("directory", ".")))
        pattern = args.get("pattern", "*")
        query = args.get("query")
        max_results = int(args.get("max_results", 25))

        if not root_dir.exists() or not root_dir.is_dir():
            return ToolResult(success=False, data=None, error=f"Invalid directory: {root_dir}")

        matches = []
        try:
            from datetime import datetime
            for root, _, files in os.walk(root_dir):
                if len(matches) >= max_results:
                    break
                if ".git" in root or "node_modules" in root or ".nim_jarvis" in root or "__pycache__" in root:
                    continue
                for f in files:
                    if len(matches) >= max_results:
                        break
                    if fnmatch.fnmatch(f, pattern):
                        full_path = Path(root) / f
                        try:
                            stat = full_path.stat()
                            sz_human = format_size(stat.st_size)
                            mod_str = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
                            cat = categorize_file(full_path)

                            if query:
                                # Check file size < 5MB for text search
                                if stat.st_size < 5_000_000:
                                    matching_snippets = []
                                    with open(full_path, "r", encoding="utf-8", errors="ignore") as file_obj:
                                        for line_num, line in enumerate(file_obj, start=1):
                                            if query.lower() in line.lower():
                                                matching_snippets.append({
                                                    "line": line_num,
                                                    "content": line.strip()[:160]
                                                })
                                                if len(matching_snippets) >= 3:
                                                    break
                                    if matching_snippets:
                                        matches.append({
                                            "path": str(full_path),
                                            "name": f,
                                            "category": cat,
                                            "size": sz_human,
                                            "modified": mod_str,
                                            "snippets": matching_snippets
                                        })
                            else:
                                matches.append({
                                    "path": str(full_path),
                                    "name": f,
                                    "category": cat,
                                    "size": sz_human,
                                    "modified": mod_str
                                })
                        except Exception:
                            pass

            return ToolResult(success=True, data={"directory": str(root_dir), "matches": matches, "count": len(matches)})
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Search failed: {str(e)}")

class DiffFilesTool(BaseTool):
    name = "diff_files"
    description = "Compare two text files and generate a unified diff."
    parameters = {
        "type": "object",
        "properties": {
            "file_a": {"type": "string", "description": "Path to the first file."},
            "file_b": {"type": "string", "description": "Path to the second file."}
        },
        "required": ["file_a", "file_b"]
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        fa = resolve_target_path(str(args.get("file_a")))
        fb = resolve_target_path(str(args.get("file_b")))

        if not fa.exists() or not fb.exists():
            return ToolResult(success=False, data=None, error="One or both files do not exist.")

        try:
            with open(fa, "r", encoding="utf-8", errors="replace") as f1, open(fb, "r", encoding="utf-8", errors="replace") as f2:
                lines_a = f1.readlines()
                lines_b = f2.readlines()

            diff = list(difflib.unified_diff(lines_a, lines_b, fromfile=str(fa.name), tofile=str(fb.name)))
            return ToolResult(success=True, data={"diff": "".join(diff), "identical": len(diff) == 0})
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to diff files: {str(e)}")
