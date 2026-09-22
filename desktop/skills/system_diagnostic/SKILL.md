---
name: system_diagnostic
description: Inspect CPU, memory, disk, GPU, network, and process health using safe, non-elevated, read-only user-space commands, and turn the numbers into a clear, actionable status report. Use this whenever the user asks about system health, performance, "why is my computer slow", resource usage, specs, telemetry, or wants a diagnostic/status report.
---
# System Diagnostic & Telemetry Guidelines

## Strict Scope
- User-space, read-only telemetry only: `psutil`, `Get-Process` / `Get-CimInstance` (prefer these over the deprecated `wmic` on modern Windows), `top` / `vm_stat` / `iostat` on macOS, `/proc` on Linux.
- Never run elevated commands, edit the registry, kill processes, change power plans, or alter startup items as part of a "diagnostic" — any remediation is a separate action that needs its own explicit confirmation.

## Core Metrics
- **CPU**: utilization %, core count, top 3 processes by CPU.
- **Memory**: used vs. total RAM, % consumed, top 3 processes by RAM.
- **Storage**: free vs. total per active partition; flag a boot/system partition under 15GB free.
- **GPU**: utilization/VRAM if a reachable API exists; otherwise report "not available" rather than guessing.
- **Network**: active interfaces and link state. Don't look up or report the public IP unless the user specifically asks for it.
- **Battery**: charge % and health, if the device is a laptop.

## Privacy
- Never display another process's full command line or environment variables — these can contain tokens, passwords, or file paths the user doesn't intend to share. Report process name, PID, and resource usage only.

## Frequency
- One fresh snapshot per request by default. Only poll repeatedly if the user asks to "watch" or "monitor," at a sane interval (5–10s), and let them stop it.

## Actionability
- Flag concrete thresholds: RAM >85%, disk free <15GB, CPU sustained >90%.
- Pair every warning with one concrete, safe next step tied to what's actually causing it (e.g. "Chrome is using 4.2GB across 12 tabs — closing unused tabs would free most of that" rather than just "RAM is high").

## Output Format
- Lead with a compact status table, then a short plain-language summary of what's fine and what needs attention — don't bury the one thing that matters at the bottom of a wall of numbers.