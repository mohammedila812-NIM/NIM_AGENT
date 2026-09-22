---
name: file_management
description: Safe, confirmed file and folder operations inside the current user's own directories (Desktop, Documents, Downloads, Pictures, and their subfolders) — organizing messy folders, moving/renaming/deleting files, categorizing by type, finding files, and backing things up before any destructive action. Use this whenever the user asks to organize, clean up, sort, tidy, move, rename, delete, back up, or find files/folders, or names a specific folder (Desktop, Downloads, etc.) that needs attention.
---
# Safe File Management Rules

## Scope & Safety (non-negotiable)
- Before touching anything, resolve the target path to its absolute, canonical form and confirm it is *inside* one of the user's allowed roots (`~/Desktop`, `~/Documents`, `~/Downloads`, `~/Pictures`, or another folder the user explicitly named under their own home directory). If a resolved path (including through a symlink) falls outside the allowed root, refuse and explain why.
- Never touch system or other-user directories: `C:\Windows`, `C:\Program Files`, `C:\Users\<anyone-else>`, `/System`, `/usr`, `/etc`, `/Applications`, or NIM_AGENT's own install/log directory.
- Never touch hidden/system marker files (`desktop.ini`, `.DS_Store`, dotfiles) unless the user explicitly names them.
- Detect the OS first (Windows vs. macOS/Linux) and use the matching path syntax and shell commands — don't hardcode backslashes or forward slashes.

## Preview Before Acting
- For any operation touching more than one file, and for *any* delete regardless of count, first build a dry-run plan: every source path → destination/action, in a table.
- Show the plan and wait for explicit confirmation ("yes", "go ahead", "confirm"). A vague "ok" given in response to something else doesn't count as confirmation.
- For >100 files in one operation, batch it and report progress rather than running one silent giant sweep.

## Backups Over Deletion
- Default to moving unwanted files to a dated backup folder (e.g. `~/Desktop/.nim_agent_backup/2026-09-18_1430/`) or the OS Trash/Recycle Bin, not permanent deletion.
- Only permanently delete when the user explicitly says so ("permanently delete", "don't keep a backup") — and confirm once more before doing it.
- Never overwrite a file silently on a name collision: append a numeric suffix (`report (2).pdf`) or ask which should win.

## Directory Organization
- Default extension → folder mapping (adjust if the user specifies their own scheme):
  - `Images/`: .jpg .jpeg .png .gif .svg .webp .heic
  - `Documents/`: .pdf .doc .docx .txt .md .rtf
  - `Spreadsheets/`: .xlsx .xls .csv
  - `Presentations/`: .ppt .pptx
  - `Archives/`: .zip .rar .7z .tar .gz
  - `Videos/`: .mp4 .mov .mkv
  - `Audio/`: .mp3 .wav .m4a
  - `Code/`: .py .js .ts .java .cpp .go .rs (etc.)
  - `Other/`: anything unrecognized
- Group, don't nest excessively — one level of categorization unless the folder is huge.

## Reporting
- After completion, report the full list of what moved from where to where, total space affected, and exactly where the backup lives so the user can undo the change themselves.