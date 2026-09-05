import asyncio
import sys
import threading
from typing import Any, Optional
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.markdown import Markdown
from rich.prompt import Prompt
from rich.theme import Theme

from src.agent.loop import AgentOrchestrator
from src.bridge.server import get_bridge_server
from src.config import AgentConfig
from src.llm.providers import PROVIDER_PRESETS
from src.security.secrets import get_secret_store
from src.security.snapshot import get_snapshot_manager
from src.tools.registry import get_tool_registry

custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "danger": "bold red",
    "success": "bold green",
    "reasoning": "dim italic cyan",
    "tool": "bold magenta"
})

console = Console(theme=custom_theme)

async def run_cli():
    secret_store = get_secret_store()
    bridge_server = get_bridge_server()
    orchestrator = AgentOrchestrator()
    snapshot_mgr = get_snapshot_manager()
    tool_registry = get_tool_registry()

    # Start WebSocket Bridge in background
    try:
        await bridge_server.start()
    except Exception as e:
        console.print(f"[warning]Warning: Could not start Bridge Server on default port: {e}[/warning]")

    console.print(Panel.fit(
        "[bold cyan]⚡ NIM JARVIS Desktop v1.2.0 — Autonomous OS AI Partner[/bold cyan]\n"
        "[dim]Holographic GUI • Subagent Swarms • Accent-Tolerant Voice v3 • DPI Screen Grounding[/dim]\n\n"
        "Commands:\n"
        "  • Type any goal/task to execute (e.g. 'Spawn subagents to analyze the project codebase')\n"
        "  • [yellow]/gui[/yellow] — Launch the Holographic Cyberpunk Command Interface (Alt+Space to toggle)\n"
        "  • [yellow]/mic on|off|status[/yellow] — Toggle ambient neural listening with true barge-in\n"
        "  • [yellow]/key <provider> <apikey>[/yellow] — Save API key in secure OS Credential Store (e.g. /key gemini AIza...)\n"
        "  • [yellow]/provider <provider_id>[/yellow] — Switch active brain provider (e.g. /provider gemini, /provider nim-cloud)\n"
        "  • [yellow]/model <model_name>[/yellow] — Switch active model (e.g. /model models/gemini-flash-lite-latest)\n"
        "  • [yellow]/vision_provider <provider_id> <model>[/yellow] — Set dedicated vision LLM\n"
        "  • [yellow]/vision_status[/yellow] — Show current vision & perception configuration\n"
        "  • [yellow]/voice <text>[/yellow] — Speak text aloud in natural neural voice\n"
        "  • [yellow]/keys[/yellow] — List configured provider keys & active brain model\n"
        "  • [yellow]/undo[/yellow] — Revert last file modification/deletion\n"
        "  • [yellow]/bridge[/yellow] — View WebSocket browser bridge status & pairing token\n"
        "  • [yellow]/tools[/yellow] — View registered tools (vision, subagents, coords, OS, documents)\n"
        "  • [yellow]/exit[/yellow] — Quit",
        title="🤖 NIM JARVIS v1.2.0",
        border_style="cyan"
    ))

    # ── HITL Confirmation Gate ────────────────────────────────────────────────
    # Holds the pending confirmation state so the main input loop can route
    # a typed 'y' or 'n' directly to the waiting tool-approval callback instead
    # of spawning a new agent task.
    _hitl_pending: dict = {}   # keys: "event" (threading.Event), "answer" (str)

    async def cli_hitl_callback(tool_name: str, tool_args: dict) -> bool:
        console.print(f"\n[danger]⚠️ ACTION REQUIRES CONFIRMATION:[/danger] Tool '[bold]{tool_name}[/bold]'")
        console.print(f"Arguments: {tool_args}")
        console.print("[bold yellow]Approve execution? \\[y/n] (default: n):[/bold yellow] ", end="")

        # Register a blocking gate on the main input loop
        gate = threading.Event()
        _hitl_pending["event"] = gate
        _hitl_pending["answer"] = "n"   # default: deny

        # Wait (non-blocking for asyncio) until the main loop resolves the gate
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, gate.wait, 30.0)   # 30s timeout → auto-deny

        answer = _hitl_pending.pop("answer", "n")
        _hitl_pending.pop("event", None)
        return answer.lower() == "y"

    main_loop = asyncio.get_running_loop()
    active_hud: Optional[Any] = None

    from src.triggers import TriggerCoordinator

    def on_ambient_suggestion(source: str, title: str, actions: list):
        if active_hud:
            active_hud.show_proactive_suggestion(source, title, actions)
        action_names = " | ".join(f"[{a['label']}]" for a in actions[:2])
    trigger_coordinator = TriggerCoordinator(
        on_suggestion_callback=on_ambient_suggestion,
        on_scheduled_task_callback=lambda g: asyncio.create_task(execute_task_pipeline(g))
    )
    await trigger_coordinator.start_all()

    from src.voice.tts import VoiceEngine
    from src.voice.stt import get_stt_engine
    from src.voice.barge_in import BargeInController

    voice_engine = VoiceEngine()
    stt_engine = get_stt_engine()

    def on_voice_command_received(transcript: str):
        console.print(f"\n[bold cyan]🎙️ Spoken Command Recognized:[/bold cyan] {transcript}")
        main_loop.call_soon_threadsafe(lambda: asyncio.create_task(execute_task_pipeline(transcript)))

    def on_voice_amplitude(level: float):
        if active_hud:
            active_hud.set_amplitude(level)

    def on_voice_partial(partial_text: str):
        if partial_text:
            if active_hud:
                active_hud.update_thought(f"Hearing: {partial_text}")

    barge_in_controller = BargeInController(
        voice_engine=voice_engine,
        stt_engine=stt_engine,
        is_task_busy=lambda: orchestrator.is_busy or voice_engine.is_speaking,
        on_cancel_task=lambda: main_loop.call_soon_threadsafe(cancel_active_task),
        on_voice_command=on_voice_command_received,
        on_amplitude=on_voice_amplitude,
        on_partial_transcript=on_voice_partial,
    )

    def cancel_active_task():
        """Immediately aborts in-flight task, stops LLM generation, and halts voice TTS."""
        cancelled_task = orchestrator.cancel_current_task()
        was_speaking = voice_engine.is_speaking
        voice_engine.stop_speaking()
        if cancelled_task or was_speaking:
            console.print("\n[bold red]⛔ Task cancelled by operator (Escape / Barge-In).[/bold red]")
            if active_hud:
                active_hud.set_mode("idle")
                active_hud.append_log("⛔ Task cancelled by operator (Escape / Barge-In).")

    # Global keyboard listener for ESC key
    try:
        from pynput import keyboard as pynput_keyboard
        def on_key_press(key):
            if key == pynput_keyboard.Key.esc:
                main_loop.call_soon_threadsafe(cancel_active_task)
        esc_listener = pynput_keyboard.Listener(on_press=on_key_press)
        esc_listener.daemon = True
        esc_listener.start()
    except Exception as e:
        pass

    async def execute_task_pipeline(goal: str):
        if not goal or not goal.strip():
            return
        clean_goal = goal.strip()
        console.print(f"\n[bold cyan]⚡ Goal:[/bold cyan] {clean_goal}\n")
        if active_hud:
            active_hud.set_mode("thinking")
            active_hud.update_thought(f"Planning: {clean_goal}...")

        try:
            async for ev in orchestrator.execute_task(clean_goal, hitl_callback=cli_hitl_callback):
                ev_type = ev.get("event")
                if ev_type == "reasoning_chunk":
                    delta = ev.get("delta", "")
                    console.print(f"[reasoning]{delta}[/reasoning]", end="")
                    if active_hud:
                        active_hud.update_thought(f"Thinking: {delta.strip() or 'Reasoning...'}")
                elif ev_type == "tool_call_start":
                    tool_name = ev.get("tool", "")
                    console.print(f"\n[tool]⚡ Tool Call: {tool_name}[/tool] {ev.get('args')}")
                    if active_hud:
                        active_hud.set_mode("thinking")
                        active_hud.update_badges([tool_name])
                        active_hud.update_thought(f"Tool: {tool_name}")
                elif ev_type == "tool_call_result":
                    res_str = str(ev.get("result", ""))
                    preview = res_str[:300] + ("..." if len(res_str) > 300 else "")
                    console.print(f"[dim]↳ Observation: {preview}[/dim]")
                    if active_hud:
                        active_hud.update_thought(f"Observation: {res_str[:80]}...")
                elif ev_type == "task_completed":
                    final_ans = ev.get("final_answer", "")
                    console.print("\n" + "="*50)
                    console.print(Markdown(final_ans or "Task Completed."))
                    console.print("="*50)
                    if active_hud:
                        active_hud.set_mode("idle")
                        active_hud.update_thought(f"Completed: {(final_ans or 'Task Done')[:100]}")
                        active_hud.update_badges(["Completed", "Online"])
                elif ev_type == "task_failed":
                    final_ans = ev.get("final_answer", "")
                    err_detail = ev.get("error", "Task failed")
                    console.print("\n" + "="*50)
                    console.print(f"[danger]❌ {err_detail}[/danger]")
                    if final_ans:
                        console.print(Markdown(final_ans))
                    console.print("="*50)
                    if active_hud:
                        active_hud.set_mode("error")
                        active_hud.update_thought(f"Failed: {err_detail[:80]}")
                        active_hud.update_badges(["Failed", "Error"])
                elif ev_type == "task_cancelled":
                    console.print("\n[bold red]⛔ Task execution was cancelled.[/bold red]")
                    if active_hud:
                        active_hud.set_mode("idle")
                        active_hud.update_thought("Task cancelled.")
                        active_hud.update_badges(["Cancelled"])
                elif ev_type == "error":
                    err_msg = ev.get("message", "Unknown error")
                    console.print(f"\n[danger]Error: {err_msg}[/danger]")
                    if active_hud:
                        active_hud.set_mode("error")
                        active_hud.update_thought(f"Error: {err_msg}")
                        active_hud.update_badges(["Error"])
        except asyncio.CancelledError:
            console.print("\n[bold red]⛔ Task cancelled.[/bold red]")
        except Exception as e:
            console.print(f"\n[danger]Task Execution Error: {e}[/danger]")
            if active_hud:
                active_hud.set_mode("error")
                active_hud.update_thought(f"Error: {e}")

    def on_hud_submit(goal_text: str):
        asyncio.run_coroutine_threadsafe(execute_task_pipeline(goal_text), main_loop)

    while True:
        try:
            user_input = (await asyncio.to_thread(Prompt.ask, "\n[bold green]NIM JARVIS[/bold green] >")).strip()
            if not user_input:
                continue

            # ── HITL Confirmation Intercept ───────────────────────────────────
            # If a destructive tool is waiting for y/n approval, route this input
            # directly to the confirmation gate instead of spawning a new task.
            if "event" in _hitl_pending:
                gate: threading.Event = _hitl_pending["event"]
                if not gate.is_set():
                    ans = user_input.lower().strip()
                    _hitl_pending["answer"] = "y" if ans in ("y", "yes") else "n"
                    gate.set()
                    if ans in ("y", "yes"):
                        console.print("[success]✅ Action approved.[/success]")
                    else:
                        console.print("[warning]❌ Action denied — tool execution cancelled.[/warning]")
                    continue

            # Command Handling
            if user_input in ["/exit", "exit", "quit", ":q"]:
                console.print("[info]Shutting down NIM JARVIS... Goodbye![/info]")
                await bridge_server.stop()
                sys.exit(0)

            elif user_input.startswith("/key "):
                parts = user_input.split(" ", 2)
                if len(parts) == 3:
                    provider, key_val = parts[1].strip().lower(), parts[2].strip()
                    secret_store.set_key(provider, key_val)
                    preset = next((p for p in PROVIDER_PRESETS if p.id == provider), None)
                    if preset:
                        orchestrator.config.provider_id = preset.id
                        orchestrator.config.base_url = preset.base_url
                        orchestrator.config.model = preset.default_model
                        orchestrator.model_router.primary_provider_id = preset.id
                        orchestrator.model_router.primary_model = preset.default_model
                        console.print(f"[success]✓ API key for '{preset.label}' ({provider}) saved & activated as default provider.[/success]")
                        console.print(f"[info]Active model: [bold]{preset.default_model}[/bold][/info]")
                    else:
                        console.print(f"[success]✓ API key for '{provider}' saved to OS Credential Store.[/success]")
                else:
                    console.print("[warning]Usage: /key <provider_id> <api_key>[/warning]")
                continue

            elif user_input.startswith("/provider "):
                p_id = user_input.split(" ", 1)[1].strip().lower()
                preset = next((p for p in PROVIDER_PRESETS if p.id == p_id), None)
                if preset:
                    orchestrator.config.provider_id = preset.id
                    orchestrator.config.base_url = preset.base_url
                    orchestrator.config.model = preset.default_model
                    orchestrator.model_router.primary_provider_id = preset.id
                    orchestrator.model_router.primary_model = preset.default_model
                    console.print(f"[success]✓ Active provider switched to '[bold]{preset.label}[/bold]' ({preset.id}).[/success]")
                    console.print(f"[info]Default model set to: [bold]{preset.default_model}[/bold][/info]")
                else:
                    console.print(f"[warning]Unknown provider '{p_id}'. Available: {', '.join(p.id for p in PROVIDER_PRESETS)}[/warning]")
                continue

            elif user_input.startswith("/model "):
                m_name = user_input.split(" ", 1)[1].strip()
                orchestrator.config.model = m_name
                orchestrator.model_router.primary_model = m_name
                console.print(f"[success]✓ Active model set to '[bold]{m_name}[/bold]'.[/success]")
                continue

            elif user_input == "/keys":
                configured = secret_store.list_configured_providers()
                table = Table(title=f"Configured Providers (Active: {orchestrator.config.provider_id} / {orchestrator.config.model})")
                table.add_column("Provider ID", style="cyan")
                table.add_column("Label", style="white")
                table.add_column("Status", style="green")
                table.add_column("Default Model", style="yellow")
                for p in PROVIDER_PRESETS:
                    status = "✓ Configured" if p.id in configured else "[dim]Not configured[/dim]"
                    active_marker = " [bold green]★ ACTIVE[/bold green]" if p.id == orchestrator.config.provider_id else ""
                    table.add_row(p.id + active_marker, p.label, status, p.default_model)
                console.print(table)
                continue

            elif user_input == "/undo":
                res = snapshot_mgr.undo_last_action()
                if res.get("success"):
                    console.print(f"[success]✓ Undo successful: {res.get('message')}[/success]")
                else:
                    console.print(f"[warning]Undo failed: {res.get('message')}[/warning]")
                continue

            elif user_input.startswith("/bridge"):
                parts = user_input.split(" ", 2)
                if len(parts) == 3 and parts[1].lower() == "set":
                    new_token = parts[2].strip()
                    bridge_server.auth_token = new_token
                    secret_store.set_key("bridge_auth_token", new_token)
                    console.print(f"[success]✓ Bridge auth token updated to: [bold]{new_token}[/bold][/success]")
                else:
                    table = Table(title="Browser Bridge Status")
                    table.add_column("Property", style="cyan")
                    table.add_column("Value", style="yellow")
                    table.add_row("Server Endpoint", f"ws://{bridge_server.host}:{bridge_server.port}")
                    table.add_row("Browser Connected", "Yes (Ready)" if bridge_server.is_client_connected else "No (Waiting for extension)")
                    table.add_row("Pairing Auth Token", bridge_server.auth_token)
                    console.print(table)
                    console.print("[dim]Tip: You can set a custom token with: /bridge set <token>[/dim]")
                continue

            elif user_input in ("/gui", "/hud"):
                try:
                    import subprocess
                    from pathlib import Path
                    if getattr(sys, "frozen", False):
                        subprocess.Popen([sys.executable, "--gui"])
                    else:
                        main_py = Path(__file__).resolve().parent.parent / "main.py"
                        subprocess.Popen([sys.executable, str(main_py), "--gui"])
                    console.print("[success]✓ NIM JARVIS Holographic Command Interface GUI launched![/success]")
                    console.print("[dim]Cyberpunk glassmorphic UI active. Press Alt+Space to toggle.[/dim]")
                except Exception as ge:
                    console.print(f"[warning]Could not launch Holographic GUI: {ge}[/warning]")
                continue

            elif user_input.startswith("/mic"):
                parts = user_input.split(" ")
                subcmd = parts[1].strip().lower() if len(parts) > 1 else ("off" if barge_in_controller.is_listening else "on")
                if subcmd == "on":
                    barge_in_controller.enable_voice_listener()
                    console.print("[success]🎙️ Ambient Voice Listener & True Barge-In: [bold]ACTIVATED[/bold][/success]")
                    console.print("[dim]Speak naturally at any time (Neural Silero-VAD + faster-whisper).[/dim]")
                    if active_hud:
                        active_hud.set_mode("listening")
                elif subcmd == "off":
                    barge_in_controller.disable_voice_listener()
                    console.print("[info]🔇 Ambient Voice Listener: [bold]MUTED[/bold][/info]")
                    if active_hud:
                        active_hud.set_mode("idle")
                elif subcmd == "status":
                    status = barge_in_controller.get_status()
                    table = Table(title="Voice & Speech System Status")
                    table.add_column("Subsystem", style="cyan")
                    table.add_column("Property", style="yellow")
                    table.add_column("Value", style="green")
                    table.add_row("Listener", "Active", "Yes" if status.get("listener_active") else "No (Muted)")
                    table.add_row("TTS", "Persona / Voice", f"{status.get('voice')} ({voice_engine.voice})")
                    table.add_row("VAD", "Backend", str(status.get("vad", {}).get("backend")))
                    table.add_row("VAD", "Energy Threshold", str(status.get("vad", {}).get("energy_threshold")))
                    table.add_row("STT", "Backend", str(status.get("stt", {}).get("backend")))
                    table.add_row("STT", "Model", str(status.get("stt", {}).get("model")))
                    table.add_row("STT", "Avg Latency", f"{status.get('stt', {}).get('avg_latency_ms', 0)} ms")
                    table.add_row("STT", "Transcriptions", str(status.get("stt", {}).get("transcriptions", 0)))
                    console.print(table)
                elif subcmd == "model" and len(parts) > 2:
                    m_name = parts[2].strip()
                    console.print(f"[info]Loading Whisper model '[bold]{m_name}[/bold]'...[/info]")
                    ok = stt_engine.switch_model(m_name)
                    if ok:
                        console.print(f"[success]✓ Active Whisper STT model switched to: [bold]{m_name}[/bold][/success]")
                    else:
                        console.print(f"[warning]Failed to load '{m_name}'. Error: {stt_engine._load_error}[/warning]")
                else:
                    console.print("[dim]Usage: /mic on | /mic off | /mic status | /mic model <tiny.en|base.en|small.en>[/dim]")
                continue

            elif user_input.startswith("/persona ") or user_input.startswith("/voice_persona "):
                parts = user_input.split(" ", 1)
                p_name = parts[1].strip().lower()
                voice_engine.set_persona(p_name)
                console.print(f"[success]✓ Active neural voice persona set to: [bold]{p_name}[/bold][/success]")
                continue

            elif user_input == "/listen":
                console.print("[cyan]🎙️ Listening for speech command... Speak now:[/cyan]")
                if active_hud:
                    active_hud.set_mode("listening")
                transcript = await asyncio.to_thread(stt_engine.listen_once, 6.0, 12.0)
                if transcript:
                    console.print(f"[success]🗣️ Transcribed:[/success] {transcript}")
                    await execute_task_pipeline(transcript)
                else:
                    console.print("[warning]No intelligible speech detected.[/warning]")
                    if active_hud:
                        active_hud.set_mode("idle")
                continue

            elif user_input.startswith("/voice ") or user_input.startswith("/speak "):
                parts = user_input.split(" ", 1)
                if len(parts) == 2:
                    speech_text = parts[1].strip()
                    console.print(f"[info]🎙️ Speaking: '{speech_text}'...[/info]")
                    await voice_engine.speak(speech_text)
                continue

            elif user_input.startswith("/vision_provider "):
                # /vision_provider <provider_id> <model>
                # Example: /vision_provider nim-cloud nvidia/llama-3.2-90b-vision-instruct
                parts = user_input.split(" ", 2)
                if len(parts) >= 3:
                    v_provider_id = parts[1].strip()
                    v_model = parts[2].strip()
                    from src.llm.vision import get_vision_client
                    vc = get_vision_client(provider_id=v_provider_id, model=v_model, force_reinit=True)
                    status = vc.get_status()
                    console.print(f"[success]✓ Vision provider set:[/success] [bold]{v_provider_id}[/bold] → [cyan]{v_model}[/cyan]")
                    if not status["api_key_configured"]:
                        console.print(f"[warning]⚠️ No API key for '{v_provider_id}'. Run: /key {v_provider_id} <your_api_key>[/warning]")
                else:
                    console.print("[warning]Usage: /vision_provider <provider_id> <model>[/warning]")
                    console.print("[dim]Example: /vision_provider nim-cloud nvidia/llama-3.2-90b-vision-instruct[/dim]")
                continue

            elif user_input == "/vision_status":
                from src.llm.vision import get_vision_client
                vc = get_vision_client()
                status = vc.get_status()
                vtable = Table(title="👁️ Vision Provider Status")
                vtable.add_column("Setting", style="cyan")
                vtable.add_column("Value", style="white")
                vtable.add_row("Provider ID", status["provider"])
                vtable.add_row("Vision Model", status["model"])
                vtable.add_row("Base URL", status["base_url"])
                vtable.add_row("API Key Configured", "✅ Yes" if status["api_key_configured"] else "❌ No")
                console.print(vtable)
                if not status["api_key_configured"]:
                    console.print(f"[dim]Set vision key: /key {status['provider']} <your_api_key>[/dim]")
                continue

            elif user_input == "/tools":
                table = Table(title="Registered Tools")
                table.add_column("Name", style="magenta")
                table.add_column("Origin", style="cyan")
                table.add_column("Risk Level", style="yellow")
                table.add_column("Description", style="white")
                for t in tool_registry.list_tools():
                    table.add_row(t.name, t.origin, t.risk_level.value, t.description[:60] + "...")
                console.print(table)
                continue

            # Execute Task via ReAct Loop
            await execute_task_pipeline(user_input)

        except (KeyboardInterrupt, EOFError):
            console.print("\n[info]Shutting down NIM JARVIS... Goodbye![/info]")
            await trigger_coordinator.stop_all()
            await bridge_server.stop()
            break
        except Exception as e:
            console.print(f"\n[danger]Unexpected error: {e}[/danger]")

