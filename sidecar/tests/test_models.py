"""Tests that load the real models (ECAPA, Silero VAD, SigLIP 2) on synthetic audio/images."""

import os
from pathlib import Path

import numpy as np
import pytest

from audio_sidecar import service
from audio_sidecar.schemas import DerRequest, DiarizeRequest, EmbedRequest, ImageSimRequest, LinkRequest


def test_embed_separates_voices_and_reports_short(conversation):
    g = conversation["gold"]
    segs = [{"start_ms": u["start_ms"], "end_ms": u["end_ms"]} for u in g]
    segs += [{"start_ms": g[0]["start_ms"] + 500, "end_ms": g[0]["start_ms"] + 800},  # 300 ms -> padded
             {"start_ms": 10, "end_ms": 60},  # 50 ms -> skipped
             {"start_ms": 10_000_000, "end_ms": 10_000_500}]  # out of range -> skipped
    out = service.embed(EmbedRequest(audio_path=conversation["path"], segments=segs))
    assert out["dim"] == 192
    n = len(g)
    assert out["padded"] == [n]
    assert {s["index"] for s in out["skipped"]} == {n + 1, n + 2}
    assert out["embeddings"][n + 1] is None
    E = np.array(out["embeddings"][:n])
    assert np.allclose(np.linalg.norm(E, axis=1), 1.0, atol=1e-3)
    S = E @ E.T
    same = [S[i, j] for i in range(n) for j in range(i + 1, n) if g[i]["speaker"] == g[j]["speaker"]]
    diff = [S[i, j] for i in range(n) for j in range(i + 1, n) if g[i]["speaker"] != g[j]["speaker"]]
    assert min(same) > max(diff), (min(same), max(diff))


def _words(gold, labels):
    # one pseudo "word" per sentence is enough for linking
    return [{"start_ms": u["start_ms"], "end_ms": u["end_ms"], "speaker": labels[u["speaker"]]} for u in gold]


def test_link_speakers_across_chunks(conversation):
    (p0, g0), (p1, g1) = conversation["chunks"]
    req = LinkRequest(chunks=[
        {"audio_path": p0, "offset_ms": 0, "words": _words(g0, {"Samantha": 0, "Daniel": 1, "Karen": 2})},
        {"audio_path": p1, "offset_ms": 20_000, "words": _words(g1, {"Daniel": "x", "Karen": "y", "Samantha": None})},
    ])
    out = service.link_speakers(req)
    m = {(r["chunk_index"], r["local"]): r["global"] for r in out["mapping"]}
    assert out["global_speakers"] == ["G1", "G2", "G3"]
    assert m[(0, 0)] == "G1" and m[(0, 1)] == "G2" and m[(0, 2)] == "G3"
    assert m[(1, None)] == "G1" and m[(1, "x")] == "G2" and m[(1, "y")] == "G3"
    assert all(0 <= r["confidence"] <= 1 for r in out["mapping"])
    assert len(out["pairwise"]) == 15
    # cannot-link: even a threshold that merges everything keeps one chunk's 3 speakers apart
    loose = service.link_speakers(req.model_copy(update={"threshold": 5.0}))
    assert len(loose["global_speakers"]) == 3


def test_link_marks_short_speaker_low_confidence(conversation):
    (p0, g0), _ = conversation["chunks"]
    words = _words(g0, {"Samantha": 0, "Daniel": 1, "Karen": 2})
    k = next(w for w in words if w["speaker"] == 2)
    for w in [w for w in words if w["speaker"] == 2 and w is not k]:
        words.remove(w)
    k["end_ms"] = k["start_ms"] + 600
    out = service.link_speakers(LinkRequest(chunks=[{"audio_path": p0, "words": words}]))
    row = next(r for r in out["mapping"] if r["local"] == 2)
    assert row["low_confidence"] is True and row["speech_ms"] == 600


def test_diarize_three_voices(conversation):
    out = service.diarize(DiarizeRequest(audio_path=conversation["path"], num_speakers=3))
    assert out["num_speakers"] == 3
    ref = [{"start_ms": u["start_ms"], "end_ms": u["end_ms"], "speaker": u["speaker"]} for u in conversation["gold"]]
    utts = [{"uid": u["uid"], **r} for u, r in zip(conversation["gold"], ref)]
    score = service.der(DerRequest(reference=ref, hypothesis=out["segments"], utterances=utts))
    assert score["der"] < 0.15, score
    assert score["utterance_speaker_accuracy"]["accuracy"] == 1.0


def test_vad_ignores_silence(tone_file):
    out = service.diarize(DiarizeRequest(audio_path=tone_file))
    assert all(s["end_ms"] - s["start_ms"] < 3000 for s in out["segments"])


def _siglip_cached() -> bool:
    hub = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"
    return (hub / "models--google--siglip2-base-patch16-224").exists()


@pytest.mark.skipif(not _siglip_cached(), reason="SigLIP 2 not in the HF cache (1.5 GB download); run once manually")
def test_image_sim(tmp_path):
    from PIL import Image, ImageDraw

    def draw(name, color, shape):
        im = Image.new("RGB", (224, 224), "white")
        d = ImageDraw.Draw(im)
        (d.rectangle if shape == "rect" else d.ellipse)([40, 40, 184, 184], fill=color)
        p = tmp_path / name
        im.save(p)
        return str(p)

    a = draw("a.png", (200, 30, 30), "rect")
    b = draw("b.png", (210, 40, 40), "rect")
    c = draw("c.png", (30, 60, 200), "ellipse")
    out = service.image_sim(ImageSimRequest(image_path=a, reference_paths=[b, c]))
    assert out["model"] == "google/siglip2-base-patch16-224"
    assert out["similarities"][0] > out["similarities"][1]
