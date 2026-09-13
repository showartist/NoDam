"""Endpoint logic as plain functions (used by server.py and cli.py).

All times are integer milliseconds. Every model call goes through models.MODEL_LOCK.
"""

from __future__ import annotations

import math
import os
from collections import OrderedDict

import numpy as np

from . import config, models
from .audio import AudioError, Span, duration_ms, expand_to_min, load_audio, slice_ms
from .cluster import constrained_ahc, cosine_matrix, cluster_windows
from .schemas import DerRequest, DiarizeRequest, EmbedRequest, ImageSimRequest, LinkRequest

MIN_EMBED_MS = 400      # shorter segments are widened with neighbouring audio
MIN_CORE_MS = 150       # below this a segment carries too little of its own speech -> skipped
LINK_MERGE_GAP_MS = 300  # adjacent words of one speaker closer than this form one segment
LINK_MIN_SPEECH_MS = 1000
LINK_MAX_SPEECH_MS = 60_000  # centroid uses at most this much speech (longest segments first)
WIN_MS = 1500
HOP_MS = 750
FRAME_MS = 20


def _r(x: float, nd: int = 4) -> float:
    return float(round(float(x), nd))


# ================================================================= /health
def health() -> dict:
    return {"ok": True, "device": models.device(), "models": models.status()}


# ================================================================== /embed
def embed(req: EmbedRequest) -> dict:
    audio = load_audio(req.audio_path)
    total = duration_ms(audio)
    waves, where, skipped, padded = [], [], [], []
    for i, seg in enumerate(req.segments):
        s, e = max(0, seg.start_ms), min(total, seg.end_ms)
        if e - s <= 0:
            skipped.append({"index": i, "reason": "empty_or_out_of_range"})
            continue
        if e - s < MIN_CORE_MS:
            skipped.append({"index": i, "reason": f"shorter_than_{MIN_CORE_MS}ms"})
            continue
        span = Span(s, e)
        if span.dur < MIN_EMBED_MS:
            span = expand_to_min(span, MIN_EMBED_MS, total)
            padded.append(i)
        w = slice_ms(audio, span)
        if float(np.sqrt(np.mean(w**2))) < 1e-4:
            skipped.append({"index": i, "reason": "silent"})
            continue
        waves.append(w)
        where.append(i)
    E = models.embed_waveforms(waves)
    out: list[list[float] | None] = [None] * len(req.segments)
    for row, i in zip(E, where):
        out[i] = [_r(v, 6) for v in row]
    return {
        "dim": int(E.shape[1]) if len(E) else models.embedding_dim(),
        "model": config.EMBEDDING_SOURCE,
        "embeddings": out,
        "skipped": skipped,
        "padded": padded,
    }


# =========================================================== /link-speakers
def _speaker_key(v) -> str:
    return "null" if v is None else str(v)


def _speaker_segments(words, total_ms: int) -> "OrderedDict[str, dict]":
    """Merge consecutive words of one local speaker into segments, in first-appearance order."""
    by_spk: OrderedDict[str, dict] = OrderedDict()
    cur = None
    for w in sorted(words, key=lambda w: (w.start_ms, w.end_ms)):
        s, e = max(0, w.start_ms), min(total_ms, w.end_ms)
        if e <= s:
            continue
        key = _speaker_key(w.speaker)
        if cur is not None and cur["key"] == key and s - cur["end"] <= LINK_MERGE_GAP_MS:
            cur["end"] = max(cur["end"], e)
            continue
        cur = {"key": key, "start": s, "end": e}
        info = by_spk.setdefault(key, {"raw": w.speaker, "first_ms": s, "segments": []})
        info["segments"].append(cur)
    return by_spk


def link_speakers(req: LinkRequest) -> dict:
    threshold = config.LINK_DISTANCE_THRESHOLD if req.threshold is None else float(req.threshold)
    items = []  # one per (chunk, local speaker)
    for ci, ch in enumerate(req.chunks):
        audio = load_audio(ch.audio_path)
        total = duration_ms(audio)
        for key, info in _speaker_segments(ch.words, total).items():
            segs = [Span(s["start"], s["end"]) for s in info["segments"]]
            speech_ms = sum(s.dur for s in segs)
            # longest segments first, up to LINK_MAX_SPEECH_MS; prefer segments with enough own speech
            ranked = sorted(segs, key=lambda s: -s.dur)
            usable = [s for s in ranked if s.dur >= MIN_CORE_MS] or ranked[:1]
            chosen, acc = [], 0
            for s in usable:
                if acc >= LINK_MAX_SPEECH_MS:
                    break
                chosen.append(s)
                acc += s.dur
            waves = [slice_ms(audio, expand_to_min(s, MIN_EMBED_MS, total)) for s in chosen]
            E = models.embed_waveforms(waves)
            weights = np.array([max(s.dur, 1) for s in chosen], dtype=np.float64)
            c = (E * weights[:, None]).sum(0)
            c = c / max(np.linalg.norm(c), 1e-9)
            items.append({
                "chunk_index": ci,
                "local": info["raw"],
                "key": key,
                "first_ms": info["first_ms"],
                "first_global_ms": ch.offset_ms + info["first_ms"],
                "speech_ms": int(speech_ms),
                "segments_used": len(chosen),
                "centroid": c,
            })

    if not items:
        return {"mapping": [], "global_speakers": [], "pairwise": [], "threshold": threshold}

    E = np.stack([it["centroid"] for it in items])
    labels = constrained_ahc(E, [it["chunk_index"] for it in items], threshold, req.num_speakers)
    S = cosine_matrix(E)

    # G1..Gn in first-appearance order (chunk order, then time inside the chunk)
    order = sorted(range(len(items)), key=lambda i: (items[i]["chunk_index"], items[i]["first_ms"]))
    gname: dict[int, str] = {}
    for i in order:
        if labels[i] not in gname:
            gname[labels[i]] = f"G{len(gname) + 1}"

    lab = np.array(labels)
    cents = {}
    for c in set(labels):
        v = E[lab == c].sum(0)
        cents[c] = v / max(np.linalg.norm(v), 1e-9)
    sim_threshold = 1.0 - threshold

    mapping = []
    for i in order:
        it, c = items[i], labels[i]
        others_same = [j for j in range(len(items)) if labels[j] == c and j != i]
        if others_same:
            v = E[others_same].sum(0)
            own = float(E[i] @ (v / max(np.linalg.norm(v), 1e-9)))
        else:
            own = sim_threshold  # stayed alone: nothing came closer than the threshold
        other_sims = [float(E[i] @ cents[d]) for d in cents if d != c]
        other = max(other_sims) if other_sims else -1.0
        conf = min(1.0, max(0.0, 0.5 + (own - other)))
        low_speech = it["speech_ms"] < LINK_MIN_SPEECH_MS
        if low_speech:
            conf *= it["speech_ms"] / LINK_MIN_SPEECH_MS
        mapping.append({
            "chunk_index": it["chunk_index"],
            "local": it["local"],
            "global": gname[c],
            "confidence": _r(conf, 3),
            "low_confidence": bool(low_speech or conf < 0.6),
            "speech_ms": it["speech_ms"],
            "segments_used": it["segments_used"],
            "sim_own_cluster": None if not others_same else _r(own, 3),
            "sim_best_other_cluster": None if not other_sims else _r(other, 3),
        })

    ident = [f"{it['chunk_index']}:{it['key']}" for it in items]
    pairwise = [
        {"a": ident[a], "b": ident[b], "cos": _r(S[a, b], 4), "same_chunk": items[a]["chunk_index"] == items[b]["chunk_index"]}
        for a in range(len(items)) for b in range(a + 1, len(items))
    ]
    return {
        "mapping": mapping,
        "global_speakers": [gname[c] for c in sorted(gname, key=lambda c: int(gname[c][1:]))],
        "pairwise": pairwise,
        "threshold": threshold,
        "method": f"ecapa centroids + average-linkage AHC on cosine distance (threshold {threshold}) + cannot-link within chunk",
    }


# ================================================================ /diarize
def _windows(regions: list[tuple[int, int]], total: int) -> list[Span]:
    out = []
    for s, e in regions:
        if e - s <= WIN_MS:
            out.append(expand_to_min(Span(s, e), MIN_EMBED_MS, total))
            continue
        t = s
        while t + WIN_MS < e:
            out.append(Span(t, t + WIN_MS))
            t += HOP_MS
        out.append(Span(e - WIN_MS, e))
    return out


def diarize(req: DiarizeRequest) -> dict:
    audio = load_audio(req.audio_path)
    total = duration_ms(audio)
    with models.MODEL_LOCK:
        regions = models.speech_regions(audio)
        wins = _windows(regions, total)
        E = models.embed_waveforms([slice_ms(audio, w) for w in wins])
    if not wins:
        return {"segments": [], "method": "silero_vad: no speech", "num_speakers": 0}
    threshold = config.DIARIZE_DISTANCE_THRESHOLD if req.threshold is None else float(req.threshold)
    labels, info = cluster_windows(E, req.num_speakers, req.min_speakers, req.max_speakers, threshold)
    k = int(info["k"])

    # frame-level majority vote over overlapping windows (centre-weighted to break ties)
    n_frames = int(math.ceil(total / FRAME_MS)) + 1
    votes = np.zeros((n_frames, k), dtype=np.float32)
    for w, l in zip(wins, labels):
        f0, f1 = w.start_ms // FRAME_MS, max(w.start_ms // FRAME_MS + 1, int(math.ceil(w.end_ms / FRAME_MS)))
        n = f1 - f0
        weight = 1.0 + 0.1 * np.hanning(n + 2)[1:-1] if n > 1 else np.ones(1)
        votes[f0:f1, l] += weight[: max(0, min(n, n_frames - f0))]
    speech = np.zeros(n_frames, dtype=bool)
    for s, e in regions:
        speech[s // FRAME_MS : int(math.ceil(e / FRAME_MS))] = True
    frame_lab = np.where(speech & (votes.sum(1) > 0), votes.argmax(1), -1)

    segs = []
    f = 0
    while f < n_frames:
        if frame_lab[f] < 0:
            f += 1
            continue
        g = f
        while g + 1 < n_frames and frame_lab[g + 1] == frame_lab[f]:
            g += 1
        segs.append([f * FRAME_MS, min(total, (g + 1) * FRAME_MS), int(frame_lab[f])])
        f = g + 1
    segs = _absorb_short(segs, min_ms=250)

    name: dict[int, str] = {}
    out = []
    for s, e, l in segs:
        if l not in name:
            name[l] = f"S{len(name) + 1}"
        out.append({"start_ms": int(s), "end_ms": int(e), "speaker": name[l]})
    return {
        "segments": out,
        "num_speakers": len(name),
        "method": f"silero_vad + ecapa {WIN_MS}/{HOP_MS}ms windows + AHC({info.get('how')}) + kmeans refine + frame vote",
        "windows": len(wins),
        "speech_ms": int(sum(e - s for s, e in regions)),
    }


def _absorb_short(segs: list[list[int]], min_ms: int) -> list[list[int]]:
    """Relabel very short turns that touch a neighbour to that neighbour, then merge runs."""
    changed = True
    while changed:
        changed = False
        for i, (s, e, l) in enumerate(segs):
            if e - s >= min_ms:
                continue
            prev = segs[i - 1] if i > 0 and segs[i - 1][1] >= s else None
            nxt = segs[i + 1] if i + 1 < len(segs) and segs[i + 1][0] <= e else None
            cands = [c for c in (prev, nxt) if c is not None and c[2] != l]
            if cands:
                segs[i][2] = max(cands, key=lambda c: c[1] - c[0])[2]
                changed = True
        merged: list[list[int]] = []
        for s, e, l in segs:
            if merged and merged[-1][2] == l and merged[-1][1] >= s:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e, l])
        segs = merged
    return segs


# ==================================================================== /der
def _label(v) -> str:
    return "__none__" if v is None else str(v)


def der(req: DerRequest) -> dict:
    from pyannote.core import Annotation, Segment, Timeline
    from pyannote.metrics.diarization import DiarizationErrorRate, JaccardErrorRate

    def ann(rows, uri):
        a = Annotation(uri=uri)
        for i, r in enumerate(rows):
            if r.end_ms > r.start_ms:
                a[Segment(r.start_ms / 1000.0, r.end_ms / 1000.0), i] = _label(r.speaker)
        return a

    if not req.reference:
        raise ValueError("reference is empty")
    ref, hyp = ann(req.reference, "ref"), ann(req.hypothesis, "hyp")
    bounds = [r.start_ms for r in req.reference + req.hypothesis] + [r.end_ms for r in req.reference + req.hypothesis]
    uem = Timeline([Segment(min(bounds) / 1000.0, max(bounds) / 1000.0)])
    collar = req.collar_ms / 1000.0
    d = DiarizationErrorRate(collar=collar, skip_overlap=req.skip_overlap)(ref, hyp, uem=uem, detailed=True)
    jer = JaccardErrorRate(collar=collar, skip_overlap=req.skip_overlap)(ref, hyp, uem=uem)
    total = d["total"]
    out = {
        "der": _r(d["diarization error rate"]),
        "jer": _r(jer),
        "confusion": _r(d["confusion"] / total if total else 0.0),
        "missed_detection": _r(d["missed detection"] / total if total else 0.0),
        "false_alarm": _r(d["false alarm"] / total if total else 0.0),
        "confusion_ms": int(round(d["confusion"] * 1000)),
        "missed_detection_ms": int(round(d["missed detection"] * 1000)),
        "false_alarm_ms": int(round(d["false alarm"] * 1000)),
        "total_ms": int(round(total * 1000)),
        "collar_ms": req.collar_ms,
        "collar_note": "pyannote.metrics semantics: collar_ms is the total width, i.e. +/- collar_ms/2 around each reference boundary",
        "skip_overlap": req.skip_overlap,
        "num_ref_speakers": len(ref.labels()),
        "num_hyp_speakers": len(hyp.labels()),
    }
    if req.utterances:
        out["utterance_speaker_accuracy"] = utterance_accuracy(req.utterances, req.hypothesis)
    return out


def utterance_accuracy(utterances, hypothesis) -> dict:
    """Top-overlap hypothesis speaker per reference utterance, Hungarian hyp->ref mapping."""
    from scipy.optimize import linear_sum_assignment

    rows = []
    for u in utterances:
        overlap: dict[str, int] = {}
        for h in hypothesis:
            ov = min(u.end_ms, h.end_ms) - max(u.start_ms, h.start_ms)
            if ov > 0:
                overlap[_label(h.speaker)] = overlap.get(_label(h.speaker), 0) + ov
        top = max(overlap, key=overlap.get) if overlap else None
        dur = max(1, u.end_ms - u.start_ms)
        rows.append({"uid": u.uid, "ref": _label(u.speaker), "hyp": top,
                     "overlap_ratio": _r((overlap.get(top, 0) / dur) if top else 0.0, 3)})
    refs = sorted({r["ref"] for r in rows})
    hyps = sorted({r["hyp"] for r in rows if r["hyp"] is not None})
    mapping: dict[str, str] = {}
    if refs and hyps:
        C = np.zeros((len(hyps), len(refs)))
        for r in rows:
            if r["hyp"] is not None:
                C[hyps.index(r["hyp"]), refs.index(r["ref"])] += 1
        hi, ri = linear_sum_assignment(-C)
        mapping = {hyps[h]: refs[r] for h, r in zip(hi, ri)}
    correct = 0
    for r in rows:
        r["mapped"] = mapping.get(r["hyp"]) if r["hyp"] is not None else None
        r["correct"] = r["mapped"] == r["ref"]
        correct += r["correct"]
    return {
        "accuracy": _r(correct / len(rows) if rows else 0.0),
        "correct": int(correct),
        "total": len(rows),
        "mapping": mapping,
        "rows": rows,
    }


# ============================================================== /image-sim
def image_sim(req: ImageSimRequest) -> dict:
    paths = [req.image_path, *req.reference_paths]
    for p in paths:
        if not os.path.isabs(p) or not os.path.isfile(p):
            raise AudioError(f"image not found (absolute path required): {p}")
    if not req.reference_paths:
        return {"model": config.SIGLIP_SOURCE, "similarities": []}
    E = models.image_embeddings(paths)
    sims = (E[1:] @ E[0]).tolist()
    return {"model": config.SIGLIP_SOURCE, "similarities": [_r(s, 4) for s in sims]}
