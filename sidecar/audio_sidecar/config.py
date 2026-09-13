"""Runtime settings, all from environment variables (no config files)."""

from __future__ import annotations

import os
from pathlib import Path

SAMPLE_RATE = 16_000

PORT = int(os.environ.get("SIDECAR_PORT", "8790"))

# "cpu" (default) or "mps" / "auto". CPU is the default on purpose: ECAPA runs in
# ~30 ms per 4 s clip on an M-series CPU, and another team crashed their server by
# running two MPS inferences at once. The global lock below prevents that too.
_DEVICE_ENV = os.environ.get("SIDECAR_DEVICE", "cpu").strip().lower()

# Keep CPU usage modest; this Mac runs other heavy sessions.
TORCH_THREADS = int(os.environ.get("SIDECAR_TORCH_THREADS", "4"))

CACHE_DIR = Path(os.environ.get("SIDECAR_CACHE_DIR", Path.home() / ".cache" / "audio_sidecar"))

EMBEDDING_SOURCE = os.environ.get("SIDECAR_EMBEDDING_MODEL", "speechbrain/spkrec-ecapa-voxceleb")
SIGLIP_SOURCE = os.environ.get("SIDECAR_SIGLIP_MODEL", "google/siglip2-base-patch16-224")

# Link-speakers default: merge two clusters while their average-linkage cosine
# distance is below this value (cosine similarity above 1 - value). On the Gemini-TTS
# fixture meetings 0.3 / 0.4 / 0.5 gave identical mappings; distinct voices' centroids
# reached 0.57 cos, same voice across chunks >= 0.74. See README.
LINK_DISTANCE_THRESHOLD = float(os.environ.get("SIDECAR_LINK_THRESHOLD", "0.4"))
# Diarize without a known speaker count: AHC cut (cosine distance) on 1.5 s window
# embeddings before outlier clusters are folded in. 0.6 over-split one Gemini voice into
# 2-4 clusters (their centroids 0.73-0.79 cos); 0.8 merged distinct voices (0.49-0.57 cos).
DIARIZE_DISTANCE_THRESHOLD = float(os.environ.get("SIDECAR_DIARIZE_THRESHOLD", "0.7"))


def resolve_device() -> str:
    import torch

    if _DEVICE_ENV == "auto":
        return "mps" if torch.backends.mps.is_available() else "cpu"
    if _DEVICE_ENV == "mps" and not torch.backends.mps.is_available():
        return "cpu"
    return _DEVICE_ENV or "cpu"
