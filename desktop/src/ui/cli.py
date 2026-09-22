"""
NIM AGENT — Authentic Kilo CLI Terminal Interface
Replicates the visual identity of Kilo CLI / OpenCode:
- Pixel ASCII Banner in Gold (#e5c07b)
- Solid Accent Card with vertical left indicator (▌)
- Clean prompt line with dim ghost placeholder
- Dynamic autocomplete for slash commands
- Streamed execution cards with latency & token cost
- /gui command with verified subprocess background launcher
- /skills, /reset, /sys, /undo commands
"""

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional

from prompt_toolkit import PromptSession
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.history import InMemoryHistory
from prompt_toolkit.styles import Style

from rich.align import Align
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text
from rich.theme import Theme
from rich.prompt import Prompt

from src.agent.loop import AgentOrchestrator
from src.bridge.server import get_bridge_server
from src.llm.providers import PROVIDER_PRESETS, get_provider_preset
from src.security.secrets import get_secret_store
from src.security.snapshot import get_snapshot_manager
from src.tools.registry import get_tool_registry
from src.skills.manager import get_skill_manager

VERSION = "1.1.0"

# ─────────────────────── Theme & Colours ─────────────────────────────────────
YELLOW  = "#e5c07b"
DIM_YEL = "#8a7040"
GREEN   = "#98c379"
RED     = "#e06c75"
CYAN    = "#61afef"
PURPLE  = "#c678dd"
GREY    = "#5c6370"
WHITE   = "#abb2bf"

nim_theme = Theme({
    "info":       CYAN,
    "warning":    YELLOW,
    "danger":     f"bold {RED}",
    "success":    f"bold {GREEN}",
    "reasoning":  f"dim italic {CYAN}",
    "tool":       f"bold {PURPLE}",
})

console = Console(theme=nim_theme)

pt_style = Style.from_dict({
    "prompt":      "#61afef bold",
    "placeholder": "#5c6370 italic",
    "text":        "#abb2bf",
})

SLASH_COMMANDS = [
    "/gui", "/skills", "/reset", "/new", "/help", "/clear", "/exit",
    "/key", "/provider", "/model", "/keys", "/tools", "/sys", "/log",
    "/undo", "/bridge"
]

completer = WordCompleter(SLASH_COMMANDS, ignore_case=True)
history = InMemoryHistory()

# ─────────────────────── Pixel Banner ────────────────────────────────────────
_BANNER = [
    r"███╗   ██╗██╗███╗   ███╗     █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
    r"████╗  ██║██║████╗ ████║    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
    r"██╔██╗ ██║██║██╔████╔██║    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
    r"██║╚██╗██║██║██║╚██╔╝██║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
    r"██║ ╚████║██║██║ ╚═╝ ██║    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
    r"╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
]


def _render_banner() -> Text:
    t = Text(justify="center")
    for i, line in enumerate(_BANNER):
        t.append(line + "\n", style=f"bold {YELLOW}" if i < 5 else DIM_YEL)
    return t


def _render_kilo_card(provider: str, model: str, state: str = "idle") -> Panel:
    """Exact recreation of the Kilo CLI accent card."""
    w = min(80, (console.width or 80) - 2)
    tbl = Table(box=None, padding=(0, 1), show_header=False, width=w)
    tbl.add_column(style=f"bold {WHITE}", width=2)
    tbl.add_column()
    tbl.add_row("▌", Text('Ask anything... "open excel and summarize Q3"', style=f"bold {WHITE}"))
    tbl.add_row("▌", Text(f"Desktop  ·  {provider}: {model}  ·  {state}", style=GREY))
    return Panel(tbl, style="on #16181d", border_style="#2a303c", padding=(0, 1))


def _splash(provider: str, model: str) -> None:
    console.print()
    console.print(Align(_render_banner(), align="center"))
    console.print()
    console.print(Align(_render_kilo_card(provider, model), align="center"))
    console.print()
    pairs = [("ctrl+c", "cancel"), ("esc", "stop"), ("/gui", "holographic GUI"), ("/skills", "skills"), ("/help", "commands")]
    ht = Text(justify="center")
    for i, (k, v) in enumerate(pairs):
        if i:
            ht.append("   ")
        ht.append(k, style=f"bold {WHITE}")
        ht.append(f" {v}", style=GREY)
    console.print(Align(ht, align="center"))
    console.print()
    console.print(Align(_bullet("Tip", "Type a goal or press Tab for commands. /help for all actions."), align="center"))
    console.print()


def _bullet(label: str, body: str, color: str = "#e5c07b") -> Text:
    t = Text()
    t.append("● ", style=f"bold {color}")
    t.append(label + " ", style=f"bold {color}")
    t.append(body, style=WHITE)
    return t


def _tool_start_card(step_n: int, tn: str, args: dict) -> None:
    a = str(args)
    a = a[:120] + "..." if len(a) > 120 else a
    t = Text()
    t.append(f"● [Step {step_n}] ", style=f"bold {YELLOW}")
    t.append(tn, style=f"bold {PURPLE}")
    t.append(f"  {a}", style=f"dim {WHITE}")
    console.print(t)


def _tool_result_card(tn: str, ok: bool, preview: str, ms: float) -> None:
    ic = "✓" if ok else "✗"
    cc = GREEN if ok else RED
    t = Text()
    t.append(f"  {ic} ", style=f"bold {cc}")
    t.append(tn, style=cc)
    t.append(f"  {ms:.0f}ms", style=f"dim {GREY}")
    t.append("\n    -> ", style=GREY)
    t.append(preview[:220], style=f"dim {WHITE}")
    console.print(t)


def _task_done_card(answer: str, tokens: int, cost: float, lat: float, artifacts: list) -> None:
    console.print()
    console.print(Rule(style=YELLOW))
    console.print(Markdown(answer or "Task completed."))
    console.print(Rule(style=YELLOW))
    tbl = Table(box=None, show_header=False, padding=(0, 2))
    tbl.add_column(style=GREY)
    tbl.add_column(style=WHITE)
    tbl.add_row("Tokens", str(tokens))
    tbl.add_row("Cost",   f"${cost:.4f}")
    tbl.add_row("Time",   f"{lat:.2f}s")
    if artifacts:
        tbl.add_row("Artifacts", ", ".join(os.path.basename(a) for a in artifacts))
    console.print(tbl)
    console.print()


def _approval_panel(tool_name: str, tool_args: dict, risk: str) -> None:
    rc = RED if risk in ("CRITICAL", "DESTRUCTIVE") else YELLOW
    lines = Text()
    lines.append("  Tool   ", style=GREY)
    lines.append(f"{tool_name}\n", style=f"bold {YELLOW}")
    lines.append("  Risk   ", style=GREY)
    lines.append(f"{risk}\n", style=f"bold {rc}")
    lines.append("  Args   ", style=GREY)
    ap = str(tool_args)
    lines.append((ap[:200] + "..." if len(ap) > 200 else ap) + "\n", style=WHITE)
    lines.append("\n")
    lines.append("  [y] ", style=f"bold {GREEN}")
    lines.append("Approve once   ", style=WHITE)
    lines.append("[a] ", style=f"bold {YELLOW}")
    lines.append("Always in task   ", style=WHITE)
    lines.append("[n] ", style=f"bold {RED}")
    lines.append("Deny and pivot", style=WHITE)
    console.print(Panel(lines, title=" ACTION REQUIRES OPERATOR APPROVAL", border_style=rc, padding=(0, 2)))


async def _ask_approval(tool_name: str, tool_args: dict, risk: str = "DESTRUCTIVE") -> str:
    _approval_panel(tool_name, tool_args, risk)
    raw = await asyncio.to_thread(
        Prompt.ask, "  Decision", choices=["y", "a", "n"], default="n"
    )
    return raw.lower()


def _cmd_skills() -> None:
    mgr = get_skill_manager()
    mgr.reload_skills()
    skills = mgr.list_skills()
    tbl = Table(title="Loaded Skills (Extensible Capabilities)", border_style=YELLOW)
    tbl.add_column("Skill", style=f"bold {CYAN}", no_wrap=True)
    tbl.add_column("Description", style=WHITE)
    tbl.add_column("Triggers", style=GREEN)
    tbl.add_column("Scripts", style=PURPLE)
    for s in skills:
        tbl.add_row(
            s["name"],
            s["description"],
            ", ".join(s["triggers"]) if s["triggers"] else "all",
            ", ".join(s["scripts"]) if s["scripts"] else "none"
        )
    console.print(tbl)
    console.print(Text("  To create a skill, add a folder with SKILL.md in desktop/skills/", style=f"dim {GREY}"))


def _cmd_sys() -> None:
    try:
        import psutil
        cpu  = psutil.cpu_percent(interval=0.3)
        ram  = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        tbl = Table(title="System Telemetry (User Space)", border_style=YELLOW, show_header=False)
        tbl.add_column(style=f"bold {CYAN}", no_wrap=True)
        tbl.add_column(style=WHITE)
        tbl.add_row("User",     os.environ.get("USERNAME", "user"))
        tbl.add_row("CPU Load", f"{cpu:.1f}%")
        tbl.add_row("RAM",      f"{ram.used/1e9:.1f} / {ram.total/1e9:.1f} GB ({ram.percent:.0f}%)")
        tbl.add_row("Disk",     f"{disk.used/1e9:.1f} / {disk.total/1e9:.1f} GB ({disk.percent:.0f}%)")
        console.print(tbl)
    except Exception as e:
        console.print(Text(f"Telemetry error: {e}", style=RED))


async def run_cli():
    secret_store  = get_secret_store()
    bridge_server = get_bridge_server()
    orchestrator  = AgentOrchestrator()
    snapshot_mgr  = get_snapshot_manager()
    tool_registry = get_tool_registry()

    try:
        await bridge_server.start()
    except Exception:
        pass

    _splash(orchestrator.config.provider_id, orchestrator.config.model)

    async def cli_hitl_callback(tool_name: str, tool_args: dict) -> str:
        return await _ask_approval(tool_name, tool_args, risk="DESTRUCTIVE")

    session: PromptSession = PromptSession(history=history, completer=completer, style=pt_style)

    async def execute_task_pipeline(goal: str):
        if not goal or not goal.strip():
            return
        cg = goal.strip()
        console.print()
        g = Text()
        g.append("  Goal  ", style=f"bold {YELLOW}")
        g.append(cg, style=f"bold {WHITE}")
        console.print(g)
        console.print(Rule(style=GREY))

        step_n: int = 0
        t_start     = time.monotonic()
        tc_times: dict = {}
        artifacts: list = []

        try:
            async for ev in orchestrator.execute_task(cg, hitl_callback=cli_hitl_callback):
                etype = ev.get("event")

                if etype == "skill_activated":
                    console.print(_bullet("Skill Activated", ev.get("skill", ""), CYAN))

                elif etype == "reasoning_chunk":
                    delta = ev.get("delta", "")
                    console.print(delta, end="", style=f"dim italic {CYAN}")

                elif etype == "tool_call_start":
                    step_n += 1
                    tn = ev.get("tool", "")
                    tc_times[tn] = time.monotonic()
                    _tool_start_card(step_n, tn, ev.get("args", {}))

                elif etype == "tool_call_result":
                    tn  = ev.get("tool", "")
                    res = str(ev.get("result", ""))
                    ms  = (time.monotonic() - tc_times.get(tn, t_start)) * 1000
                    _tool_result_card(tn, ev.get("success", True), res, ms)

                elif etype == "artifact_presentation":
                    p = os.path.basename(ev.get("path", ""))
                    a = ev.get("app", "")
                    console.print(_bullet("Presenting", f"Opened {p} in {a.upper()} for visual review", GREEN))

                elif etype == "verification_reflection_start":
                    console.print(_bullet("Verification", "Critiquing output quality and visual layout...", YELLOW))

                elif etype == "tool_call_denied":
                    console.print(Text(f"  Action denied by operator -- pivoting {ev.get('tool', '')}", style=f"bold {RED}"))

                elif etype == "task_completed":
                    artifacts = ev.get("artifacts", [])
                    _task_done_card(
                        answer=ev.get("final_answer", ""),
                        tokens=ev.get("tokens", 0),
                        cost=ev.get("cost_usd", 0.0),
                        lat=time.monotonic() - t_start,
                        artifacts=artifacts
                    )

                elif etype == "task_cancelled":
                    console.print(Text("  Task cancelled.", style=f"bold {RED}"))

                elif etype == "error":
                    console.print(Text(f"  Error: {ev.get('message', '')}", style=f"bold {RED}"))

        except asyncio.CancelledError:
            console.print(Text("  Task cancelled.", style=f"bold {RED}"))
        except Exception as e:
            console.print(Text(f"  Error: {e}", style=f"bold {RED}"))

    while True:
        try:
            raw = await session.prompt_async(
                FormattedText([("class:prompt", "❯ ")]),
                placeholder="Ask anything or use /help for commands...",
            )
            ui = raw.strip()
            if not ui:
                continue

            if ui in ["/exit", "exit", "quit", ":q"]:
                console.print(Text("Shutting down NIM AGENT... Goodbye!", style=GREY))
                await bridge_server.stop()
                sys.exit(0)

            elif ui == "/clear":
                console.clear()
                _splash(orchestrator.config.provider_id, orchestrator.config.model)

            elif ui == "/gui":
                console.print(_bullet("GUI", "Launching Holographic WebGL GUI window in background...", CYAN))
                gui_path = Path(__file__).resolve().parent.parent / "gui.py"
                subprocess.Popen(
                    [sys.executable, str(gui_path)],
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
                )

            elif ui in ["/reset", "/new"]:
                orchestrator.reset_session()
                console.print(_bullet("Session", "Active session scratchpad cleared for fresh context.", GREEN))

            elif ui == "/skills":
                _cmd_skills()

            elif ui == "/sys":
                _cmd_sys()

            elif ui == "/help":
                rows = [
                    ("/gui",                     "Launch the Ultron Holographic WebGL GUI window"),
                    ("/skills",                  "List all extensible skills and rules"),
                    ("/reset",                   "Clear multi-turn session memory for a fresh start"),
                    ("/sys",                     "Live system telemetry (CPU, RAM, Disk)"),
                    ("/keys",                    "List configured AI providers and keys"),
                    ("/key <provider> <key>",    "Set provider API key"),
                    ("/provider <id>",           "Switch active provider (e.g. nim-cloud, gemini)"),
                    ("/model <name>",            "Switch model name"),
                    ("/tools",                   "List all registered OS tools"),
                    ("/undo",                    "Revert last file change"),
                    ("/clear",                   "Clear terminal screen"),
                    ("/exit",                    "Exit NIM AGENT"),
                ]
                tbl = Table(box=None, show_header=False, padding=(0, 2))
                tbl.add_column(style=f"bold {YELLOW}", no_wrap=True)
                tbl.add_column(style=WHITE)
                for cmd, desc in rows:
                    tbl.add_row(cmd, desc)
                console.print(Panel(tbl, title="All Commands", border_style=YELLOW, padding=(0, 1)))

            elif ui.startswith("/key "):
                parts = ui.split(" ", 2)
                if len(parts) == 3:
                    p_in, k = parts[1].strip().lower(), parts[2].strip()
                    preset = get_provider_preset(p_in)
                    prov   = preset.id if preset else p_in
                    secret_store.set_key(prov, k)
                    if preset:
                        orchestrator.config.provider_id = preset.id
                        orchestrator.config.base_url    = preset.base_url
                        orchestrator.config.model       = preset.default_model
                        orchestrator.model_router.primary_provider_id = preset.id
                        orchestrator.model_router.primary_model = preset.default_model
                        console.print(_bullet("OK", f"Key saved for {preset.label}. Model: {preset.default_model}", GREEN))
                    else:
                        console.print(_bullet("OK", f"Key saved for {prov}", GREEN))
                else:
                    console.print(Text("Usage: /key <provider_id> <api_key>", style=YELLOW))

            elif ui.startswith("/provider "):
                p_id = ui.split(" ", 1)[1].strip().lower()
                preset = get_provider_preset(p_id)
                if preset:
                    orchestrator.config.provider_id = preset.id
                    orchestrator.config.base_url    = preset.base_url
                    orchestrator.config.model       = preset.default_model
                    orchestrator.model_router.primary_provider_id = preset.id
                    orchestrator.model_router.primary_model = preset.default_model
                    console.print(_bullet("OK", f"Switched to {preset.label} (Model: {preset.default_model})", GREEN))
                else:
                    avail = ", ".join(p.id for p in PROVIDER_PRESETS)
                    console.print(Text(f"Unknown provider. Available: {avail}", style=YELLOW))

            elif ui.startswith("/model "):
                m = ui.split(" ", 1)[1].strip()
                orchestrator.config.model = m
                orchestrator.model_router.primary_model = m
                console.print(_bullet("OK", f"Model set to {m}", GREEN))

            elif ui == "/keys":
                configured = secret_store.list_configured_providers()
                tbl = Table(
                    title=f"Providers (Active: {orchestrator.config.provider_id} / {orchestrator.config.model})",
                    border_style=YELLOW,
                )
                tbl.add_column("ID",    style=CYAN, no_wrap=True)
                tbl.add_column("Label", style=WHITE)
                tbl.add_column("Key",   style=GREEN)
                tbl.add_column("Default Model", style=YELLOW)
                for p in PROVIDER_PRESETS:
                    status = "set" if p.id in configured else "--"
                    marker = " *" if p.id == orchestrator.config.provider_id else ""
                    tbl.add_row(p.id + marker, p.label, status, p.default_model)
                console.print(tbl)

            elif ui == "/tools":
                tbl = Table(title=f"Registered Tools ({len(tool_registry.list_tools())})", border_style=YELLOW)
                tbl.add_column("Name", style=PURPLE, no_wrap=True)
                tbl.add_column("Origin", style=CYAN)
                tbl.add_column("Risk", style=YELLOW)
                tbl.add_column("Description", style=WHITE)
                for t in sorted(tool_registry.list_tools(), key=lambda x: x.name):
                    desc = t.description[:60] + ("..." if len(t.description) > 60 else "")
                    tbl.add_row(t.name, t.origin, t.risk_level.value, desc)
                console.print(tbl)

            elif ui == "/undo":
                res = snapshot_mgr.undo_last_action()
                if res.get("success"):
                    console.print(_bullet("OK", res.get("message", "Undo successful"), GREEN))
                else:
                    console.print(_bullet("--", res.get("message", "Nothing to undo"), RED))

            else:
                await execute_task_pipeline(ui)

        except (KeyboardInterrupt, EOFError):
            console.print(Text("\nShutting down NIM AGENT... Goodbye!", style=GREY))
            await bridge_server.stop()
            break
        except Exception as e:
            console.print(Text(f"Error: {e}", style=f"bold {RED}"))
