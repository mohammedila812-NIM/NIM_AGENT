import asyncio
import numpy as np
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.voice.tts import VoiceEngine
from src.voice.vad import VADEngine
from src.voice.stt import SpeechToTextEngine, WhisperSTTEngine, TranscriptResult, get_stt_engine
from src.voice.barge_in import BargeInController
from src.tools.voice_tools import (
    SpeakTextTool,
    ListenVoiceTool,
    ToggleVoiceInputTool,
    SetVoicePersonaTool,
    get_voice_tools,
)
from src.tools.base import ToolContext


@pytest.mark.asyncio
async def test_voice_engine_tts_and_barge_in():
    engine = VoiceEngine(voice_name="jarvis")
    assert engine.voice_name == "jarvis"
    assert "GuyNeural" in engine.voice

    engine.set_persona("friday")
    assert engine.voice_name == "friday"
    assert "AriaNeural" in engine.voice

    # Mock synthesis and audio playback so this test does not require network access.
    with patch("src.voice.tts.edge_tts.Communicate") as mock_communicate, \
            patch.object(engine, "_play_audio_file", return_value=True):
        mock_communicate.return_value.save = AsyncMock(return_value=None)
        res = await engine.speak("Testing NIM JARVIS voice.")
        assert res is True

    # Test barge-in stop
    engine.stop_speaking()
    assert engine.is_speaking is False


def test_vad_engine_energy_and_calibration():
    vad = VADEngine(energy_threshold=0.02)

    # Generate synthetic 30ms 16kHz silence (int16 zero bytes)
    silence_pcm = np.zeros(480, dtype=np.int16).tobytes()
    energy_silence = vad.compute_frame_energy(silence_pcm)
    assert energy_silence == 0.0

    # Generate synthetic 30ms 16kHz sine tone (loud speech)
    t = np.linspace(0, 0.03, 480, endpoint=False)
    tone = (np.sin(2 * np.pi * 440 * t) * 16000).astype(np.int16).tobytes()
    energy_tone = vad.compute_frame_energy(tone)
    assert energy_tone > 0.1

    # Calibrate noise floor
    vad.calibrate_noise_floor([0.005, 0.006, 0.004])
    assert vad.energy_threshold >= 0.02

    status = vad.get_status()
    assert "backend" in status
    assert "running" in status


def test_whisper_stt_and_result_dataclass():
    res = TranscriptResult(text="open chrome browser", confidence=0.98, backend="whisper:tiny.en")
    assert bool(res) is True
    assert res.text == "open chrome browser"
    assert res.backend == "whisper:tiny.en"

    empty_res = TranscriptResult(text="")
    assert bool(empty_res) is False

    engine = WhisperSTTEngine(model_name="tiny.en")
    dummy_pcm = np.zeros(16000, dtype=np.int16).tobytes()
    wav_data = engine.pcm_to_wav(dummy_pcm, sample_rate=16000)
    assert wav_data[:4] == b"RIFF"
    assert b"WAVE" in wav_data[:16]

    status = engine.get_status()
    assert status["model"] == "tiny.en"
    assert "avg_latency_ms" in status


def test_stt_legacy_shim():
    stt = SpeechToTextEngine()
    dummy_pcm = np.zeros(16000, dtype=np.int16).tobytes()
    wav_data = stt.pcm_to_wav(dummy_pcm, sample_rate=16000)
    assert wav_data[:4] == b"RIFF"


@pytest.mark.asyncio
async def test_barge_in_controller_coordination():
    cancelled = False
    command_received = ""

    def mock_cancel():
        nonlocal cancelled
        cancelled = True

    def mock_command(cmd: str):
        nonlocal command_received
        command_received = cmd

    tts = VoiceEngine()
    tts._is_speaking = True  # Simulate active speaking

    barge_in = BargeInController(
        voice_engine=tts,
        is_task_busy=lambda: True,
        on_cancel_task=mock_cancel,
        on_voice_command=mock_command
    )

    # When speech starts during active TTS, TTS must halt and task must be cancelled
    barge_in._on_speech_start()
    assert tts.is_speaking is False
    assert cancelled is True

    # When speech ends with captured audio, it routes transcript
    with patch.object(barge_in.stt_engine, "transcribe_pcm", return_value=TranscriptResult(text="Open VS Code")):
        barge_in._on_speech_end(b"12345" * 1000)
        # Give worker thread a moment
        await asyncio.sleep(0.05)
        assert command_received == "Open VS Code"

    status = barge_in.get_status()
    assert "listener_active" in status
    assert "vad" in status
    assert "stt" in status


@pytest.mark.asyncio
async def test_voice_tools_execution():
    tools = get_voice_tools()
    assert len(tools) == 4

    context = ToolContext(task_id="test_voice_task")

    # 1. Speak Text Tool
    speak_tool = SpeakTextTool()
    res1 = await speak_tool.execute({"text": "Hello world", "voice": "friday"}, context)
    assert res1.success is True
    assert res1.data["voice"] == "friday"

    # 2. Toggle Voice Input Tool
    toggle_tool = ToggleVoiceInputTool()
    res2 = await toggle_tool.execute({"enabled": True}, context)
    assert res2.success is True
    assert res2.data["enabled"] is True

    # 3. Set Voice Persona Tool
    persona_tool = SetVoicePersonaTool()
    res3 = await persona_tool.execute({"persona": "friday"}, context)
    assert res3.success is True
    assert res3.data["persona"] == "friday"

    # 4. Listen Voice Tool (mock)
    listen_tool = ListenVoiceTool()
    with patch("src.tools.voice_tools._global_stt_engine.listen_once", return_value="Organize downloads"):
        res4 = await listen_tool.execute({"timeout": 2.0}, context)
        assert res4.success is True
        assert res4.data["transcript"] == "Organize downloads"

