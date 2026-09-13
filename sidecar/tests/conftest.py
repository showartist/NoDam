"""Synthetic test audio, generated at test time (nothing binary is checked in).

Speech comes from macOS `say` with English voices that really differ on this Mac
(Samantha / Daniel / Karen). Note: the ko_KR voices other than Yuna silently fall
back to Yuna for Korean text, so they are useless for speaker tests.
"""

from __future__ import annotations

import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

SR = 16_000

SCRIPT = [
    ("Samantha", "Let's look at scene thirty four, the empty swimming pool at dawn."),
    ("Daniel", "I think the camera should stay wide and very still for the first shot."),
    ("Karen", "The tiles need to look old, so we will age them with a grey wash."),
    ("Samantha", "Good. Keep the light cold and let the reflections move on the wall."),
    ("Daniel", "Then I will use a slow dolly and a thirty five millimetre lens."),
    ("Karen", "I can have the props ready by Tuesday if the budget is approved."),
    ("Samantha", "Approved. Let's lock it and move on to the next scene."),
    ("Daniel", "One more thing, we need a safety crew near the deep end."),
]
GAP_MS = 450


def _say(voice: str, text: str, out: Path) -> np.ndarray:
    aiff = out.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(aiff), "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    aiff.unlink()
    return np.frombuffer(raw, dtype=np.int16)


def write_wav(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.astype(np.int16).tobytes())


def build(parts: list[tuple[str, np.ndarray]], lead_ms: int = 300) -> tuple[np.ndarray, list[dict]]:
    gap = np.zeros(int(SR * GAP_MS / 1000), dtype=np.int16)
    pcm = [np.zeros(int(SR * lead_ms / 1000), dtype=np.int16)]
    cursor = len(pcm[0])
    gold = []
    for i, (voice, clip) in enumerate(parts):
        gold.append({"uid": f"U{i + 1:02d}", "speaker": voice,
                     "start_ms": round(cursor * 1000 / SR), "end_ms": round((cursor + len(clip)) * 1000 / SR)})
        pcm += [clip, gap]
        cursor += len(clip) + len(gap)
    return np.concatenate(pcm), gold


@pytest.fixture(scope="session")
def conversation(tmp_path_factory):
    """{'path', 'gold', 'chunks': [(path, gold)...]} built from SCRIPT."""
    if not shutil.which("say") or not shutil.which("ffmpeg"):
        pytest.skip("needs macOS `say` and ffmpeg")
    d = tmp_path_factory.mktemp("conv")
    clips = [(v, _say(v, t, d / f"u{i}.wav")) for i, (v, t) in enumerate(SCRIPT)]
    pcm, gold = build(clips)
    full = d / "meeting.wav"
    write_wav(full, pcm)
    chunks = []
    for j, part in enumerate((clips[:4], clips[4:])):
        cpcm, cgold = build(part)
        p = d / f"chunk{j}.wav"
        write_wav(p, cpcm)
        chunks.append((str(p), cgold))
    return {"path": str(full), "gold": gold, "chunks": chunks, "dir": d}


@pytest.fixture(scope="session")
def tone_file(tmp_path_factory):
    """1 s of 220 Hz tone, 1 s of silence, 1 s of 440 Hz tone."""
    d = tmp_path_factory.mktemp("tone")
    t = np.arange(SR) / SR
    pcm = np.concatenate([0.3 * np.sin(2 * np.pi * 220 * t), np.zeros(SR), 0.3 * np.sin(2 * np.pi * 440 * t)])
    p = d / "tone.wav"
    write_wav(p, (pcm * 32767).astype(np.int16))
    return str(p)
