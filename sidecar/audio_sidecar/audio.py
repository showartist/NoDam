"""Audio loading. Everything is decoded by ffmpeg to 16 kHz mono float32.

Using ffmpeg (not torchaudio/torchcodec) keeps us independent of the torchaudio I/O
backend churn and reads anything the Node app accepts (m4a, mp3, webm, wav ...).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

import numpy as np

from .config import SAMPLE_RATE


class AudioError(ValueError):
    pass


def load_audio(path: str, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    if not path or not os.path.isabs(path):
        raise AudioError(f"audio_path must be an absolute path: {path!r}")
    if not os.path.isfile(path):
        raise AudioError(f"audio file not found: {path}")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AudioError("ffmpeg not found on PATH")
    proc = subprocess.run(
        [ffmpeg, "-nostdin", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sample_rate), "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise AudioError(f"ffmpeg failed to decode {path}: {proc.stderr.decode(errors='replace')[:400]}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    if audio.size == 0:
        raise AudioError(f"decoded audio is empty: {path}")
    return audio


def ms_to_sample(ms: float, sample_rate: int = SAMPLE_RATE) -> int:
    return int(round(ms * sample_rate / 1000.0))


def duration_ms(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> int:
    return int(round(len(audio) * 1000.0 / sample_rate))


@dataclass
class Span:
    start_ms: int
    end_ms: int

    @property
    def dur(self) -> int:
        return self.end_ms - self.start_ms


def expand_to_min(span: Span, min_ms: int, total_ms: int) -> Span:
    """Grow a span symmetrically (using real neighbouring audio) to at least min_ms."""
    if span.dur >= min_ms:
        return span
    missing = min_ms - span.dur
    start = span.start_ms - missing // 2
    end = span.end_ms + (missing - missing // 2)
    if start < 0:
        end = min(total_ms, end - start)
        start = 0
    if end > total_ms:
        start = max(0, start - (end - total_ms))
        end = total_ms
    return Span(start, end)


def slice_ms(audio: np.ndarray, span: Span, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    return audio[ms_to_sample(span.start_ms, sample_rate) : ms_to_sample(span.end_ms, sample_rate)]
