"""Run the copied assessment APIs and local recording routes without an Expo build."""
import os
from pathlib import Path


def _use_alira_voice() -> None:
    """Speak every assessment line in Alira's one ElevenLabs voice, however this app is started.

    Recorded lines (frontend/public/audio/prepared) play without a key; any other line is spoken
    live with ELEVENLABS_API_KEY, read from the companion's .env.local when not already set.
    Values already in the environment win. See ../ALIRA_VOICE.md.
    """
    os.environ.setdefault("INSTRUCTION_TTS_PROVIDER", "elevenlabs")
    os.environ.setdefault("ELEVENLABS_VOICE_SCOPE", "all")
    if os.environ.get("ELEVENLABS_API_KEY"):
        return
    for name in (".env", ".env.local"):
        try:
            lines = (Path(__file__).resolve().parent.parent / name).read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            key, _, value = line.partition("=")
            if key.strip() == "ELEVENLABS_API_KEY" and value.strip():
                os.environ["ELEVENLABS_API_KEY"] = value.strip().strip('"').strip("'")


_use_alira_voice()

from backend.server import app  # noqa: E402
from backend.local_assessment_recordings import router as recordings_router  # noqa: E402
from backend.testing_reach_voice import router as reach_voice_router  # noqa: E402
from backend.testing_mouth_voice import router as mouth_voice_router  # noqa: E402

app.include_router(recordings_router)
app.include_router(reach_voice_router)
app.include_router(mouth_voice_router)
