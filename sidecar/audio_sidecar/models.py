"""Lazily loaded models behind ONE global lock.

Every model load and every inference goes through MODEL_LOCK. Requests are therefore
served one at a time for the heavy part; that is deliberate (two concurrent MPS
inferences crashed another team's server, and this Mac has little free memory).
The lock is re-entrant so a service function can hold it across VAD + embedding.
"""

from __future__ import annotations

import os
import threading
from typing import Any

import numpy as np

from . import config

MODEL_LOCK = threading.RLock()

_state: dict[str, Any] = {"vad": None, "embedding": None, "siglip": None, "device": None}

# Small on purpose: on this Mac (torch 2.14 CPU, swap nearly full) ECAPA batches of 16-32
# 1.5 s windows took 45-60 s instead of <1 s; batches of 4 run at ~20 ms per window.
EMBED_BATCH = int(os.environ.get("SIDECAR_EMBED_BATCH", "4"))


def _torch():
    import torch

    # silero-vad sets torch threads to 1 when it runs; put our setting back every time.
    want = max(1, config.TORCH_THREADS)
    if torch.get_num_threads() != want:
        torch.set_num_threads(want)
    return torch


def device() -> str:
    if _state["device"] is None:
        _state["device"] = config.resolve_device()
    return _state["device"]


def status() -> dict[str, str]:
    return {k: ("loaded" if _state[k] is not None else "not_loaded") for k in ("vad", "embedding", "siglip")}


# ---------------------------------------------------------------- Silero VAD
def get_vad():
    with MODEL_LOCK:
        if _state["vad"] is None:
            _torch()
            from silero_vad import load_silero_vad

            _state["vad"] = load_silero_vad()  # bundled JIT model, no download
        return _state["vad"]


def speech_regions(audio: np.ndarray, *, threshold: float = 0.5, min_speech_ms: int = 250,
                   min_silence_ms: int = 150, pad_ms: int = 30) -> list[tuple[int, int]]:
    """Silero VAD speech regions in milliseconds."""
    torch = _torch()
    from silero_vad import get_speech_timestamps

    with MODEL_LOCK:
        model = get_vad()
        ts = get_speech_timestamps(
            torch.from_numpy(audio),
            model,
            threshold=threshold,
            sampling_rate=config.SAMPLE_RATE,
            min_speech_duration_ms=min_speech_ms,
            min_silence_duration_ms=min_silence_ms,
            speech_pad_ms=pad_ms,
            return_seconds=False,
        )
    sr = config.SAMPLE_RATE
    return [(int(round(t["start"] * 1000 / sr)), int(round(t["end"] * 1000 / sr))) for t in ts]


# ------------------------------------------------ speaker embedding (ECAPA)
def get_embedder():
    with MODEL_LOCK:
        if _state["embedding"] is None:
            _torch()
            from speechbrain.inference.speaker import EncoderClassifier
            from speechbrain.utils.fetching import LocalStrategy

            savedir = config.CACHE_DIR / config.EMBEDDING_SOURCE.replace("/", "--")
            os.makedirs(savedir, exist_ok=True)
            model = EncoderClassifier.from_hparams(
                source=config.EMBEDDING_SOURCE,
                savedir=str(savedir),
                run_opts={"device": device()},
                local_strategy=LocalStrategy.SYMLINK,
            )
            model.eval()
            _state["embedding"] = model
        return _state["embedding"]


def embedding_dim() -> int:
    return 192  # ECAPA spkrec-ecapa-voxceleb; service.embed reports the actual width when it has output


def embed_waveforms(waves: list[np.ndarray]) -> np.ndarray:
    """L2-normalised speaker embeddings, one row per waveform (16 kHz float32).

    Equal-length waveforms are batched; others go one by one so no padding ever
    leaks into the statistics pooling.
    """
    torch = _torch()
    if not waves:
        return np.zeros((0, embedding_dim()), dtype=np.float32)
    out: list[np.ndarray | None] = [None] * len(waves)
    by_len: dict[int, list[int]] = {}
    for i, w in enumerate(waves):
        by_len.setdefault(len(w), []).append(i)
    with MODEL_LOCK:
        model = get_embedder()
        dev = device()
        with torch.inference_mode():
            for _length, idxs in by_len.items():
                for b in range(0, len(idxs), EMBED_BATCH):
                    part = idxs[b : b + EMBED_BATCH]
                    batch = torch.from_numpy(np.stack([waves[i] for i in part]).astype(np.float32)).to(dev)
                    emb = model.encode_batch(batch).squeeze(1).float().cpu().numpy()
                    for j, i in enumerate(part):
                        out[i] = emb[j]
    arr = np.stack(out).astype(np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    return arr / np.maximum(norms, 1e-9)


# ------------------------------------------------------------- SigLIP 2
def get_siglip():
    with MODEL_LOCK:
        if _state["siglip"] is None:
            _torch()
            # SiglipImageProcessor = PIL backend. AutoImageProcessor in transformers 5 picks the
            # torchvision one, which we do not install. Only the vision tower is loaded (~93M params).
            from transformers import SiglipImageProcessor, SiglipVisionModel

            processor = SiglipImageProcessor.from_pretrained(config.SIGLIP_SOURCE)
            model = SiglipVisionModel.from_pretrained(config.SIGLIP_SOURCE).to(device()).eval()
            _state["siglip"] = (processor, model)
        return _state["siglip"]


def image_embeddings(paths: list[str]) -> np.ndarray:
    torch = _torch()
    from PIL import Image

    images = []
    for p in paths:
        with Image.open(p) as im:
            images.append(im.convert("RGB"))
    with MODEL_LOCK:
        processor, model = get_siglip()
        with torch.inference_mode():
            inputs = processor(images=images, return_tensors="pt").to(device())
            pooled = model(**inputs).pooler_output.float().cpu().numpy()
    return pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9)
